import { Connection, SfdxError } from "@salesforce/core";
import PromisePool = require("@supercharge/promise-pool/dist");
import * as c from "chalk";
import * as fs from "fs-extra";
import * as fetch from "node-fetch";
import * as path from "path";
import { isCI, uxLog } from ".";
import { prompts } from "./prompts";

export const filesFolderRoot = path.join(".", "scripts", "files");

export class FilesExporter {
  private filesPath: string;
  private conn: Connection;
  private pollTimeout: number;
  private recordsChunkSize: number;
  private commandThis: any;

  private fetchOptions: any;
  private dtl: any; // export config
  private exportedFilesFolder: string;
  private recordsChunk: any[] = [];
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

  constructor(filesPath: string, conn: Connection, options: { pollTimeout?: number; recordsChunkSize?: number }, commandThis: any) {
    this.filesPath = filesPath;
    this.conn = conn;
    this.pollTimeout = options?.pollTimeout || 300000;
    this.recordsChunkSize = options?.recordsChunkSize || 5000;
    this.commandThis = commandThis;
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
    this.dtl = await getFilesWorkspaceDetail(this.filesPath);
    uxLog(this.commandThis, c.cyan(`Exporting files from ${c.green(this.dtl.full_label)} ...`));
    uxLog(this.commandThis, c.italic(c.grey(this.dtl.description)));
    // Make sure export folder for files is existing
    this.exportedFilesFolder = path.join(this.filesPath, "export");
    await fs.ensureDir(this.exportedFilesFolder);

    await this.calculateApiConsumption();
    await this.processParentRecords();
    return await this.buildResult();
  }

  // Calculate API consumption
  private async calculateApiConsumption() {
    const countSoqlQuery = this.dtl.soqlQuery.replace(/SELECT (.*) FROM/gi, "SELECT COUNT() FROM");
    uxLog(this, c.grey("Query: " + c.italic(countSoqlQuery)));
    const countSoqlQueryRes = await this.conn.query(countSoqlQuery);
    const estimatedApiCalls = countSoqlQueryRes.totalSize * 2;
    this.apiUsedBefore = (this.conn as any)?.limitInfo?.apiUsage?.used ? (this.conn as any).limitInfo.apiUsage.used - 1 : this.apiUsedBefore;
    this.apiLimit = (this.conn as any)?.limitInfo?.apiUsage?.limit;
    // Check if there are enough API calls available
    if (this.apiLimit - this.apiUsedBefore < estimatedApiCalls + 1000) {
      throw new SfdxError(
        `You don't have enough API calls available (${c.bold(this.apiLimit - this.apiUsedBefore)}) to perform this export that could consume ${c.bold(
          estimatedApiCalls
        )} API calls`
      );
    }
    // Request user confirmation
    if (!isCI) {
      const warningMessage = c.yellow(
        `This export of files could consume up to ${c.bold(estimatedApiCalls)} API calls on the ${
          this.apiLimit
        } remaining API calls. Do you want to proceed ?`
      );
      const promptRes = await prompts({ type: "confirm", message: warningMessage });
      if (promptRes.value !== true) {
        throw new SfdxError("Command cancelled by user");
      }
    }
  }

  private async processParentRecords() {
    // Query parent records using SOQL defined in export.json file
    uxLog(this, c.grey("Bulk query: " + c.italic(this.dtl.soqlQuery)));
    this.totalSoqlRequests++;
    this.conn.bulk.pollTimeout = this.pollTimeout || 600000; // Increase timeout in case we are on a bad internet connection or if the bulk api batch is queued
    await new Promise((resolve) => {
      this.conn.bulk
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
          resolve(true);
        });
    });

    // Process last chunk
    const lastRecordsToProcess = [...this.recordsChunk];
    this.recordsChunk = [];
    await this.processRecordsChunk(lastRecordsToProcess);
  }

  private async addToRecordsChunk(record: any) {
    this.recordsChunk.push(record);
    // If chunk size is reached , process the chunk of records
    if (this.recordsChunk.length === this.recordsChunkSize) {
      const recordsToProcess = [...this.recordsChunk];
      this.recordsChunk = [];
      await this.processRecordsChunk(recordsToProcess);
    }
  }

  private async processRecordsChunk(records: any[]) {
    this.recordChunksNumber++;
    uxLog(this, c.cyan("Processing parent records chunk #" + this.recordChunksNumber));
    // Request all ContentDocumentLink related to all records of the chunk
    const linkedEntityIdIn = records.map((record: any) => `'${record.Id}'`).join(",");
    const linkedEntityInQuery = `SELECT ContentDocumentId,LinkedEntityId FROM ContentDocumentLink WHERE LinkedEntityId IN (${linkedEntityIdIn})`;
    uxLog(this, c.grey("Query: " + c.italic(linkedEntityInQuery)));
    const contentDocumentLinks = await this.conn.query(linkedEntityInQuery);
    this.totalSoqlRequests++;

    // Retrieve all ContentVersion related to ContentDocumentLink
    const contentDocIdIn = contentDocumentLinks.records.map((contentDocumentLink: any) => `'${contentDocumentLink.ContentDocumentId}'`).join(",");
    const contentVersionSoql = `SELECT ContentDocumentId,Description,FileExtension,FileType,PathOnClient,Title,VersionData FROM ContentVersion WHERE ContentDocumentId IN (${contentDocIdIn}) AND IsLatest = true`;
    uxLog(this, c.grey("Query: " + c.italic(contentVersionSoql)));
    const contentVersions = await this.conn.query(contentVersionSoql);
    this.totalSoqlRequests++;

    // Download files
    await PromisePool.withConcurrency(10)
      .for(contentVersions.records)
      .process(async (contentVersion: any) => {
        try {
          await this.downloadContentVersionFile(contentVersion, records, contentDocumentLinks.records);
        } catch (e) {
          this.filesErrors++;
          uxLog(this, c.red("Download file error: " + contentVersion.Title + "\n" + e));
        }
      });
  }

  private async downloadContentVersionFile(contentVersion, records, contentDocumentLinks) {
    // Retrieve initial record to build output files folder name
    const contentDocumentLink = contentDocumentLinks.filter(
      (contentDocumentLink) => contentDocumentLink.ContentDocumentId === contentVersion.ContentDocumentId
    )[0];
    const parentRecord = records.filter((record) => record.Id === contentDocumentLink.LinkedEntityId)[0];
    // Build record output files folder
    const parentRecordFolderForFiles = path.resolve(
      path.join(this.exportedFilesFolder, parentRecord[this.dtl.outputFolderNameField] || parentRecord.Id)
    );
    const outputFile = path.join(parentRecordFolderForFiles, contentVersion.Title);
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
    const fetchUrl = this.conn.instanceUrl + contentVersion.VersionData;
    try {
      const fetchRes = await fetch(fetchUrl, this.fetchOptions);
      fetchRes.body.pipe(fs.createWriteStream(outputFile));
      uxLog(this, c.green(`Success - ${outputFile.replace(this.exportedFilesFolder, "")}`));
      this.filesDownloaded++;
    } catch (err) {
      // Download failure
      uxLog(this, c.red(`Error   - ${outputFile.replace(this.exportedFilesFolder, "")} - ${err}`));
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
  const overwriteParentRecords = exportFileJson.overwriteParentRecords === false ? false : exportFileJson.overwriteParentRecords || true;
  const overwriteFiles = exportFileJson.overwriteFiles || false;
  return {
    full_label: `[${folderName}]${folderName != hardisLabel ? `: ${hardisLabel}` : ""}`,
    label: hardisLabel,
    description: hardisDescription,
    soqlQuery: soqlQuery,
    fileTypes: fileTypes,
    outputFolderNameField: outputFolderNameField,
    overwriteParentRecords: overwriteParentRecords,
    overwriteFiles: overwriteFiles,
  };
}
