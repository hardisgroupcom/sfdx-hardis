// External Libraries and Node.js Modules
import * as fs from "fs-extra";
import path = require("path");
import * as c from "chalk";
import * as fetch from "@adobe/node-fetch-retry";
import * as split from "split";
import PromisePool = require("@supercharge/promise-pool/dist");

// Salesforce Specific and Other Specific Libraries
import { Connection, SfdxError } from "@salesforce/core";
import * as Papa from "papaparse";
import * as ExcelJS from "exceljs";

// Project Specific Utilities
import { getCurrentGitBranch, isCI, uxLog } from ".";
import { bulkQuery, soqlQuery } from "./apiUtils";
import { prompts } from "./prompts";
import { CONSTANTS, getReportDirectory } from "../../config";
import { WebSocketClient } from "../websocketClient";

export const filesFolderRoot = path.join(".", "scripts", "files");

export class FilesExporter {
  private filesPath: string;
  private conn: Connection;
  private pollTimeout: number;
  private recordsChunkSize: number;
  private startChunkNumber: number;
  private commandThis: any;

  private fetchOptions: any;
  private dtl: any = null; // export config
  private exportedFilesFolder: string;
  private recordsChunk: any[] = [];
  private chunksNumber = 1;

  private recordsChunkQueue: any[] = [];
  private recordsChunkQueueRunning = false;
  private queueInterval: any;
  private bulkApiRecordsEnded = false;

  private recordChunksNumber = 0;

  private totalSoqlRequests = 0;
  private totalParentRecords = 0;
  private parentRecordsWithFiles = 0;
  private recordsIgnored = 0;
  private filesDownloaded = 0;
  private filesErrors = 0;
  private filesIgnoredType = 0;
  private filesIgnoredExisting = 0;
  private apiUsedBefore = null;
  private apiLimit = null;

  constructor(
    filesPath: string,
    conn: Connection,
    options: { pollTimeout?: number; recordsChunkSize?: number; exportConfig?: any; startChunkNumber?: number },
    commandThis: any,
  ) {
    this.filesPath = filesPath;
    this.conn = conn;
    this.pollTimeout = options?.pollTimeout || 300000;
    this.recordsChunkSize = options?.recordsChunkSize || 1000;
    this.startChunkNumber = options?.startChunkNumber || 0;
    this.commandThis = commandThis;
    if (options.exportConfig) {
      this.dtl = options.exportConfig;
    }
    // Build fetch options for HTTP calls to retrieve document files
    this.fetchOptions = {
      method: "GET",
      headers: {
        Authorization: "Bearer " + this.conn.accessToken,
        "Content-Type": "blob",
      },
    };
  }

  async processExport() {
    // Get config
    if (this.dtl === null) {
      this.dtl = await getFilesWorkspaceDetail(this.filesPath);
    }
    uxLog(this.commandThis, c.cyan(`Exporting files from ${c.green(this.dtl.full_label)} ...`));
    uxLog(this.commandThis, c.italic(c.grey(this.dtl.description)));
    // Make sure export folder for files is existing
    this.exportedFilesFolder = path.join(this.filesPath, "export");
    await fs.ensureDir(this.exportedFilesFolder);

    await this.calculateApiConsumption();
    this.startQueue();
    await this.processParentRecords();
    await this.queueCompleted();
    return await this.buildResult();
  }

  // Calculate API consumption
  private async calculateApiConsumption() {
    const countSoqlQuery = this.dtl.soqlQuery.replace(/SELECT (.*) FROM/gi, "SELECT COUNT() FROM");
    this.totalSoqlRequests++;
    const countSoqlQueryRes = await soqlQuery(countSoqlQuery, this.conn);
    this.chunksNumber = Math.round(countSoqlQueryRes.totalSize / this.recordsChunkSize);
    const estimatedApiCalls = Math.round(this.chunksNumber * 2) + 1;
    this.apiUsedBefore = (this.conn as any)?.limitInfo?.apiUsage?.used ? (this.conn as any).limitInfo.apiUsage.used - 1 : this.apiUsedBefore;
    this.apiLimit = (this.conn as any)?.limitInfo?.apiUsage?.limit;
    // Check if there are enough API calls available
    if (this.apiLimit - this.apiUsedBefore < estimatedApiCalls + 1000) {
      throw new SfdxError(
        `You don't have enough API calls available (${c.bold(this.apiLimit - this.apiUsedBefore)}) to perform this export that could consume ${c.bold(
          estimatedApiCalls,
        )} API calls`,
      );
    }
    // Request user confirmation
    if (!isCI) {
      const warningMessage = c.cyanBright(
        `This export of files could run on ${c.bold(c.yellow(countSoqlQueryRes.totalSize))} records, in ${c.bold(
          c.yellow(this.chunksNumber),
        )} chunks, and consume up to ${c.bold(c.yellow(estimatedApiCalls))} API calls on the ${c.bold(
          c.yellow(this.apiLimit - this.apiUsedBefore),
        )} remaining API calls. Do you want to proceed ?`,
      );
      const promptRes = await prompts({ type: "confirm", message: warningMessage });
      if (promptRes.value !== true) {
        throw new SfdxError("Command cancelled by user");
      }
      if (this.startChunkNumber === 0) {
        uxLog(this, c.yellow(c.italic("Use --startchunknumber command line argument if you do not want to start from first chunk")));
      }
    }
  }

  // Run chunks one by one, and don't wait to have all the records fetched to start it
  private startQueue() {
    this.queueInterval = setInterval(async () => {
      if (this.recordsChunkQueueRunning === false && this.recordsChunkQueue.length > 0) {
        this.recordsChunkQueueRunning = true;
        const recordChunk = this.recordsChunkQueue.shift();
        await this.processRecordsChunk(recordChunk);
        this.recordsChunkQueueRunning = false;
        // Manage last chunk
      } else if (this.bulkApiRecordsEnded === true && this.recordsChunkQueue.length === 0 && this.recordsChunk.length > 0) {
        const recordsToProcess = [...this.recordsChunk];
        this.recordsChunk = [];
        this.recordsChunkQueue.push(recordsToProcess);
      }
    }, 1000);
  }

  // Wait for the queue to be completed
  private async queueCompleted() {
    await new Promise((resolve) => {
      const completeCheckInterval = setInterval(async () => {
        if (
          this.bulkApiRecordsEnded === true &&
          this.recordsChunkQueueRunning === false &&
          this.recordsChunkQueue.length === 0 &&
          this.recordsChunk.length === 0
        ) {
          clearInterval(completeCheckInterval);
          resolve(true);
        }
        if (globalThis.sfdxHardisFatalError === true) {
          uxLog(this, c.red("Fatal error while processing chunks queue"));
          process.exit(1);
        }
      }, 1000);
    });
    clearInterval(this.queueInterval);
    this.queueInterval = null;
  }

  private async processParentRecords() {
    // Query parent records using SOQL defined in export.json file
    uxLog(this, c.grey("Bulk query: " + c.italic(this.dtl.soqlQuery)));
    this.totalSoqlRequests++;
    this.conn.bulk.pollTimeout = this.pollTimeout || 600000; // Increase timeout in case we are on a bad internet connection or if the bulk api batch is queued
    await this.conn.bulk
      .query(this.dtl.soqlQuery)
      .on("record", async (record) => {
        this.totalParentRecords++;
        const parentRecordFolderForFiles = path.resolve(path.join(this.exportedFilesFolder, record[this.dtl.outputFolderNameField] || record.Id));
        if (this.dtl.overwriteParentRecords !== true && fs.existsSync(parentRecordFolderForFiles)) {
          uxLog(this, c.grey(`Skipped record - ${record[this.dtl.outputFolderNameField] || record.Id} - Record files already downloaded`));
          this.recordsIgnored++;
          return;
        }
        await this.addToRecordsChunk(record);
      })
      .on("error", (err) => {
        throw new SfdxError(c.red("Bulk query error:" + err));
      })
      .on("end", () => {
        this.bulkApiRecordsEnded = true;
      });
  }

  private async addToRecordsChunk(record: any) {
    this.recordsChunk.push(record);
    // If chunk size is reached , process the chunk of records
    if (this.recordsChunk.length === this.recordsChunkSize) {
      const recordsToProcess = [...this.recordsChunk];
      this.recordsChunk = [];
      this.recordsChunkQueue.push(recordsToProcess);
    }
  }

  private async processRecordsChunk(records: any[]) {
    this.recordChunksNumber++;
    if (this.recordChunksNumber < this.startChunkNumber) {
      uxLog(this, c.cyan(`Skip parent records chunk #${this.recordChunksNumber} because it is lesser than ${this.startChunkNumber}`));
      return;
    }
    uxLog(this, c.cyan(`Processing parent records chunk #${this.recordChunksNumber} on ${this.chunksNumber} (${records.length} records) ...`));
    // Request all ContentDocumentLink related to all records of the chunk
    const linkedEntityIdIn = records.map((record: any) => `'${record.Id}'`).join(",");
    const linkedEntityInQuery = `SELECT ContentDocumentId,LinkedEntityId FROM ContentDocumentLink WHERE LinkedEntityId IN (${linkedEntityIdIn})`;
    this.totalSoqlRequests++;
    const contentDocumentLinks = await bulkQuery(linkedEntityInQuery, this.conn);
    if (contentDocumentLinks.records.length === 0) {
      uxLog(this, c.grey("No ContentDocumentLinks found for the parent records in this chunk"));
      return;
    }

    // Retrieve all ContentVersion related to ContentDocumentLink
    const contentDocIdIn = contentDocumentLinks.records.map((contentDocumentLink: any) => `'${contentDocumentLink.ContentDocumentId}'`).join(",");
    const contentVersionSoql = `SELECT Id,ContentDocumentId,Description,FileExtension,FileType,PathOnClient,Title FROM ContentVersion WHERE ContentDocumentId IN (${contentDocIdIn}) AND IsLatest = true`;
    this.totalSoqlRequests++;
    const contentVersions = await bulkQuery(contentVersionSoql, this.conn);

    // ContentDocument object can be linked to multiple other objects even with same type (for example: same attachment can be linked to multiple EmailMessage objects).
    // Because of this when we fetch ContentVersion for ContentDocument it can return less results than there is ContentDocumentLink objects to link.
    // To fix this we create a list of ContentVersion and ContentDocumentLink pairs.
    // This way we have multiple pairs and we will download ContentVersion objects for each linked object.
    const versionsAndLinks = [];
    contentVersions.records.forEach((contentVersion) => {
      contentDocumentLinks.records.forEach((contentDocumentLink) => {
        if (contentDocumentLink.ContentDocumentId === contentVersion.ContentDocumentId) {
          versionsAndLinks.push({
            contentVersion: contentVersion,
            contentDocumentLink: contentDocumentLink,
          });
        }
      });
    });

    // Download files
    await PromisePool.withConcurrency(5)
      .for(versionsAndLinks)
      .process(async (versionAndLink: any) => {
        try {
          await this.downloadContentVersionFile(versionAndLink.contentVersion, records, versionAndLink.contentDocumentLink);
        } catch (e) {
          this.filesErrors++;
          uxLog(this, c.red("Download file error: " + versionAndLink.contentVersion.Title + "\n" + e));
        }
      });
  }

  private async downloadContentVersionFile(contentVersion, records, contentDocumentLink) {
    // Retrieve initial record to build output files folder name
    const parentRecord = records.filter((record) => record.Id === contentDocumentLink.LinkedEntityId)[0];
    // Build record output files folder (if folder name contains slashes or antislashes, replace them by spaces)
    const parentFolderName = (parentRecord[this.dtl.outputFolderNameField] || parentRecord.Id).replace(/[/\\?%*:|"<>]/g, "-");
    const parentRecordFolderForFiles = path.resolve(path.join(this.exportedFilesFolder, parentFolderName));
    // Define name of the file
    let outputFile =
      // Id
      this.dtl?.outputFileNameFormat === "id"
        ? path.join(parentRecordFolderForFiles, contentVersion.Id)
        : // Title + Id
        this.dtl?.outputFileNameFormat === "title_id"
          ? path.join(parentRecordFolderForFiles, `${contentVersion.Title.replace(/[/\\?%*:|"<>]/g, "-")}_${contentVersion.Id}`)
          : // Id + Title
          this.dtl?.outputFileNameFormat === "id_title"
            ? path.join(parentRecordFolderForFiles, `${contentVersion.Id}_${contentVersion.Title.replace(/[/\\?%*:|"<>]/g, "-")}`)
            : // Title
            path.join(parentRecordFolderForFiles, contentVersion.Title.replace(/[/\\?%*:|"<>]/g, "-"));
    // Add file extension if missing in file title, and replace .snote by .html
    if (contentVersion.FileExtension && path.extname(outputFile) !== contentVersion.FileExtension) {
      outputFile = outputFile + "." + (contentVersion.FileExtension !== "snote" ? contentVersion.FileExtension : "html");
    }
    // Check file extension
    if (this.dtl.fileTypes !== "all" && !this.dtl.fileTypes.includes(contentVersion.FileType)) {
      uxLog(this, c.grey(`Skipped - ${outputFile.replace(this.exportedFilesFolder, "")} - File type ignored`));
      this.filesIgnoredType++;
      return;
    }
    // Check file overwrite
    if (this.dtl.overwriteFiles !== true && fs.existsSync(outputFile)) {
      uxLog(this, c.yellow(`Skipped - ${outputFile.replace(this.exportedFilesFolder, "")} - File already existing`));
      this.filesIgnoredExisting++;
      return;
    }
    // Create directory if not existing
    await fs.ensureDir(parentRecordFolderForFiles);
    // Download file locally
    const fetchUrl = `${this.conn.instanceUrl}/services/data/v${CONSTANTS.API_VERSION}/sobjects/ContentVersion/${contentVersion.Id}/VersionData`;
    try {
      const fetchRes = await fetch(fetchUrl, this.fetchOptions);
      if (fetchRes.ok !== true) {
        throw new SfdxError(`Fetch error - ${fetchUrl} - + ${JSON.stringify(fetchRes.body)}`);
      }
      // Wait for file to be written
      const stream = fs.createWriteStream(outputFile);
      fetchRes.body.pipe(stream);
      /*
      await new Promise(resolve => {
        stream.on('finish', function() {
          resolve(true);
        });
      }) */
      uxLog(this, c.green(`Success - ${path.relative(process.cwd(), outputFile)}`));
      this.filesDownloaded++;
    } catch (err) {
      // Download failure
      uxLog(this, c.red(`Error   - ${path.relative(process.cwd(), outputFile)} - ${err}`));
      this.filesErrors++;
    }
  }

  // Build stats & result
  private async buildResult() {
    const connAny = this.conn as any;
    const apiCallsRemaining = connAny?.limitInfo?.apiUsage?.used
      ? (connAny?.limitInfo?.apiUsage?.limit || 0) - (connAny?.limitInfo?.apiUsage?.used || 0)
      : null;
    uxLog(this, c.cyan(`API limit: ${c.bold(connAny?.limitInfo?.apiUsage?.limit || null)}`));
    uxLog(this, c.cyan(`API used before process: ${c.bold(this.apiUsedBefore)}`));
    uxLog(this, c.cyan(`API used after process: ${c.bold(connAny?.limitInfo?.apiUsage?.used || null)}`));
    uxLog(this, c.cyan(`API calls remaining for today: ${c.bold(apiCallsRemaining)}`));
    uxLog(this, c.cyan(`Total SOQL requests: ${c.bold(this.totalSoqlRequests)}`));
    uxLog(this, c.cyan(`Total parent records found: ${c.bold(this.totalParentRecords)}`));
    uxLog(this, c.cyan(`Total parent records with files: ${c.bold(this.parentRecordsWithFiles)}`));
    uxLog(this, c.cyan(`Total parent records ignored because already existing: ${c.bold(this.recordsIgnored)}`));
    uxLog(this, c.cyan(`Total files downloaded: ${c.bold(this.filesDownloaded)}`));
    uxLog(this, c.cyan(`Total file download errors: ${c.bold(this.filesErrors)}`));
    uxLog(this, c.cyan(`Total file skipped because of type constraint: ${c.bold(this.filesIgnoredType)}`));
    uxLog(this, c.cyan(`Total file skipped because previously downloaded: ${c.bold(this.filesIgnoredExisting)}`));

    return {
      totalParentRecords: this.totalParentRecords,
      parentRecordsWithFiles: this.parentRecordsWithFiles,
      filesDownloaded: this.filesDownloaded,
      filesErrors: this.filesErrors,
      recordsIgnored: this.recordsIgnored,
      filesIgnoredType: this.filesIgnoredType,
      filesIgnoredExisting: this.filesIgnoredExisting,
      apiLimit: connAny?.limitInfo?.apiUsage?.limit || null,
      apiUsedBefore: this.apiUsedBefore,
      apiUsedAfter: connAny?.limitInfo?.apiUsage?.used || null,
      apiCallsRemaining,
    };
  }
}

export async function selectFilesWorkspace(opts = { selectFilesLabel: "Please select a files folder to export" }) {
  if (!fs.existsSync(filesFolderRoot)) {
    throw new SfdxError("There is no files root folder 'scripts/files' in your workspace. Create it and define a files export configuration");
  }

  const filesFolders = fs
    .readdirSync(filesFolderRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.join(".", "scripts", "files", dirent.name));
  if (filesFolders.length === 0) {
    throw new SfdxError("There is no file exports folder in your workspace");
  }
  const choices: any = [];
  for (const filesFolder of filesFolders) {
    const dtl = await getFilesWorkspaceDetail(filesFolder);
    if (dtl !== null) {
      choices.push({
        title: dtl.full_label,
        description: dtl.description,
        value: filesFolder,
      });
    }
  }
  const filesDirResult = await prompts({
    type: "select",
    name: "value",
    message: c.cyanBright(opts.selectFilesLabel),
    choices: choices,
  });
  return filesDirResult.value;
}

export async function getFilesWorkspaceDetail(filesWorkspace: string) {
  const exportFile = path.join(filesWorkspace, "export.json");
  if (!fs.existsSync(exportFile)) {
    uxLog(this, c.yellow(`Your File export folder ${c.bold(filesWorkspace)} must contain an ${c.bold("export.json")} configuration file`));
    return null;
  }
  const exportFileJson = JSON.parse(await fs.readFile(exportFile, "utf8"));
  const folderName = filesWorkspace.replace(/\\/g, "/").match(/([^/]*)\/*$/)[1];
  const hardisLabel = exportFileJson.sfdxHardisLabel || folderName;
  const hardisDescription = exportFileJson.sfdxHardisDescription || filesWorkspace;
  const soqlQuery = exportFileJson.soqlQuery || "";
  const fileTypes = exportFileJson.fileTypes || "all";
  const outputFolderNameField = exportFileJson.outputFolderNameField || "Name";
  const outputFileNameFormat = exportFileJson.outputFileNameFormat || "title";
  const overwriteParentRecords = exportFileJson.overwriteParentRecords === false ? false : exportFileJson.overwriteParentRecords || true;
  const overwriteFiles = exportFileJson.overwriteFiles || false;
  return {
    full_label: `[${folderName}]${folderName != hardisLabel ? `: ${hardisLabel}` : ""}`,
    label: hardisLabel,
    description: hardisDescription,
    soqlQuery: soqlQuery,
    fileTypes: fileTypes,
    outputFolderNameField: outputFolderNameField,
    outputFileNameFormat: outputFileNameFormat,
    overwriteParentRecords: overwriteParentRecords,
    overwriteFiles: overwriteFiles,
  };
}

export async function promptFilesExportConfiguration(filesExportConfig: any, override = false) {
  const questions = [];
  if (override === false) {
    questions.push(
      ...[
        {
          type: "text",
          name: "filesExportPath",
          message: c.cyanBright('Please input the files export config folder name (PascalCase format). Ex: "OpportunitiesPDF"'),
        },
        {
          type: "text",
          name: "sfdxHardisLabel",
          message: c.cyanBright("Please input a label for the files export configuration"),
          initial: filesExportConfig.sfdxHardisLabel,
        },
        {
          type: "text",
          name: "sfdxHardisDescription",
          message: c.cyanBright("Please input a description of the files export configuration"),
          initial: filesExportConfig.sfdxHardisDescription,
        },
      ],
    );
  }
  questions.push(
    ...[
      {
        type: "text",
        name: "soqlQuery",
        message: "Please input the main SOQL Query to fetch the parent records of files (ContentVersions). Ex: SELECT Id,Name from Opportunity",
        initial: filesExportConfig.soqlQuery,
      },
      {
        type: "text",
        name: "outputFolderNameField",
        message: "Please input the field to use to build the name of the folder containing downloaded files",
        initial: filesExportConfig.outputFolderNameField,
      },
      {
        type: "select",
        name: "outputFileNameFormat",
        choices: [
          { value: "title", title: "title" },
          { value: "title_id", title: "title_id" },
          { value: "id_title", title: "id_title" },
          { value: "id", title: "id" },
        ],
        message: "Please select the format of output files names",
        initial: filesExportConfig.outputFileNameFormat,
      },
      {
        type: "confirm",
        name: "overwriteParentRecords",
        message: "Do you want to try to download files attached to a parent records whose folder is already existing in local folders ?",
        initial: filesExportConfig.overwriteParentRecords,
      },
      {
        type: "confirm",
        name: "overwriteFiles",
        message: "Do you want to overwrite file that has already been previously downloaded ?",
        initial: filesExportConfig.overwriteFiles,
      },
    ],
  );

  const resp = await prompts(questions);
  const filesConfig = Object.assign(filesExportConfig, {
    filesExportPath: resp.filesExportPath,
    sfdxHardisLabel: resp.sfdxHardisLabel || filesExportConfig.sfdxHardisLabel,
    sfdxHardisDescription: resp.sfdxHardisDescription || filesExportConfig.sfdxHardisDescription,
    soqlQuery: resp.soqlQuery,
    outputFolderNameField: resp.outputFolderNameField,
    outputFileNameFormat: resp.outputFileNameFormat,
    overwriteParentRecords: resp.overwriteParentRecords,
    overwriteFiles: resp.overwriteFiles,
  });
  return filesConfig;
}

export async function countLinesInFile(file: string) {
  let readError;
  let lineCount = 0;
  return await new Promise((resolve) => {
    fs.createReadStream(file)
      .pipe(split())
      .on("data", () => {
        lineCount++;
      })
      .on("end", () => {
        if (readError) {
          return;
        }
        resolve(lineCount - 1);
      })
      .on("error", (error) => {
        readError = true;
        resolve(error);
      });
  });
}

/**
 * @description This function generates a report path for a given file name prefix.
 * It retrieves the report directory and the current branch name.
 * If the branch name is not available in the environment variable CI_COMMIT_REF_NAME, it tries to get the current git branch.
 * If both are not available, it uses the string "Missing CI_COMMIT_REF_NAME variable".
 * It then joins the report directory, file name prefix, and branch name to form the full path of the report.
 *
 * @param {string} fileNamePrefix - The prefix for the file name.
 * @returns {Promise<string>} - A Promise that resolves to the full path of the report.
 */
export async function generateReportPath(fileNamePrefix: string, outputFile: string): Promise<string> {
  if (outputFile == null) {
    const reportDir = await getReportDirectory();
    const branchName = process.env.CI_COMMIT_REF_NAME || (await getCurrentGitBranch({ formatted: true })) || "Missing CI_COMMIT_REF_NAME variable";
    return path.join(reportDir, `${fileNamePrefix}-${branchName.split("/").pop()}.csv`);
  } else {
    await fs.ensureDir(path.dirname(outputFile));
    return outputFile;
  }
}

/**
 * @description This function generates a CSV file from the provided data and writes it to the specified output path.
 * If the operation is successful, it logs a message and requests to open the file.
 * If an error occurs during the operation, it logs the error message and stack trace.
 *
 * @param {any[]} data - The data to be written to the CSV file.
 * @param {string} outputPath - The path where the CSV file will be written.
 * @returns {Promise<void>} - A Promise that resolves when the operation is complete.
 */
export async function generateCsvFile(data: any[], outputPath: string): Promise<any> {
  const result: any = {};
  try {
    const csvContent = Papa.unparse(data);
    await fs.writeFile(outputPath, csvContent, "utf8");
    uxLog(this, c.italic(c.cyan(`Please see detailed CSV log in ${c.bold(outputPath)}`)));
    result.csvFile = outputPath;
    WebSocketClient.requestOpenFile(outputPath);
    if (data.length > 0) {
      try {
        // Generate mirror XSLX file
        const xlsDirName = path.join(path.dirname(outputPath), "xls");
        const xslFileName = path.basename(outputPath).replace(".csv", ".xlsx");
        const xslxFile = path.join(xlsDirName, xslFileName);
        await fs.ensureDir(xlsDirName);
        await csvToXls(outputPath, xslxFile);
        uxLog(this, c.italic(c.cyan(`Please see detailed XSLX log in ${c.bold(xslxFile)}`)));
        result.xlsxFile = xslxFile;
      } catch (e2) {
        uxLog(this, c.yellow("Error while generating XSLX log file:\n" + e2.message + "\n" + e2.stack));
      }
    }
    else {
      uxLog(this, c.grey(`No XLS file generated as ${outputPath} is empty`));
    }
  } catch (e) {
    uxLog(this, c.yellow("Error while generating CSV log file:\n" + e.message + "\n" + e.stack));
  }
  return result;
}

async function csvToXls(csvFile: string, xslxFile: string) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = await workbook.csv.readFile(csvFile);
  // Set filters
  worksheet.autoFilter = "A1:Z1";
  // Adjust column size (only if the file is not too big, to avoid performances issues)
  if (worksheet.rowCount < 5000) {
    worksheet.columns.forEach((column) => {
      const lengths = column.values.map((v) => v.toString().length);
      const maxLength = Math.max(...lengths.filter((v) => typeof v === "number"));
      column.width = maxLength;
    });
  }
  await workbook.xlsx.writeFile(xslxFile);
}
