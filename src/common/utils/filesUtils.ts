import { SfdxError } from "@salesforce/core";
import PromisePool = require("@supercharge/promise-pool/dist");
import * as c from "chalk";
import * as fs from "fs-extra";
import * as fetch from "node-fetch";
import * as path from "path";
import { uxLog } from ".";
import { prompts } from "./prompts";

export const filesFolderRoot = path.join(".", "scripts", "files");

// Initialize stats variables
let totalSoqlRequests = 0;
let totalParentRecords = 0;
let parentRecordsWithFiles = 0;
let recordsIgnored = 0;
let filesDownloaded = 0;
let filesErrors = 0;
let filesIgnoredType = 0;
let filesIgnoredExisting = 0;
let apiLimit = 0;
let apiUsedBefore = 0;

function initStats() {
  // Initialize stats variables
  totalSoqlRequests = 0;
  totalParentRecords = 0;
  parentRecordsWithFiles = 0;
  recordsIgnored = 0;
  filesDownloaded = 0;
  filesErrors = 0;
  filesIgnoredType = 0;
  filesIgnoredExisting = 0;
  apiLimit = null;
  apiUsedBefore = null;
}

// Export data from files folder
export async function exportFiles(filesPath: string, conn: any, commandThis: any) {
  initStats();
  const dtl = await getFilesWorkspaceDetail(filesPath);
  uxLog(commandThis, c.cyan(`Exporting files from ${c.green(dtl.full_label)} ...`));
  uxLog(commandThis, c.italic(c.grey(dtl.description)));

  // Make sure export folder for files is existing
  const exportedFilesFolder = path.join(filesPath, "export");
  await fs.ensureDir(exportedFilesFolder);

  // Build fetch options for HTTP calls to retrieve document files
  const fetchOptions = {
    method: "GET",
    headers: {
      Authorization: "Bearer " + conn.accessToken,
      "Content-Type": "blob",
    },
  };

  // Query parent records using SOQL defined in export.json file
  const records = [];
  uxLog(this, c.grey("Bulk query: " + c.italic(dtl.soqlQuery)));
  totalSoqlRequests++;
  await new Promise((resolve) => {
    conn.bulk
      .query(dtl.soqlQuery)
      .on("record", async (record) => {
        const parentRecordFolderForFiles = path.join(exportedFilesFolder, record[dtl.outputFolderNameField] || record.Id);
        if (dtl.overwriteParentRecords !== true && fs.existsSync(parentRecordFolderForFiles)) {
          uxLog(this, c.grey(`Skipped record - ${record[dtl.outputFolderNameField] || record.Id} - Already existing`));
          recordsIgnored++;
          return;
        }
        records.push(record);
      })
      .on("error", (err) => {
        uxLog(this, "Bulk query error:" + err);
      })
      .on("end", () => {
        resolve(true);
      });
  });

  await PromisePool.withConcurrency(10)
    .for(records)
    .process(async (record) => {
      await processRecord(record, exportedFilesFolder, dtl, conn, fetchOptions);
    });

  // Display stats
  const apiCallsRemaining = (conn?.limitInfo?.apiUsage?.limit || 0) - (conn?.limitInfo?.apiUsage?.used || 0);
  uxLog(this, c.cyan(`API limit: ${c.bold(conn?.limitInfo?.apiUsage?.limit)}`));
  uxLog(this, c.cyan(`API used before process: ${c.bold(apiUsedBefore)}`));
  uxLog(this, c.cyan(`API used after process: ${c.bold(conn?.limitInfo?.apiUsage?.used)}`));
  uxLog(this, c.cyan(`API calls remaining for today: ${c.bold(apiCallsRemaining)}`));
  uxLog(this, c.cyan(`Total SOQL requests: ${c.bold(totalSoqlRequests)}`));
  uxLog(this, c.cyan(`Total parent records found: ${c.bold(totalParentRecords)}`));
  uxLog(this, c.cyan(`Total parent records with files: ${c.bold(parentRecordsWithFiles)}`));
  uxLog(this, c.cyan(`Total parent records ignored because already existing: ${c.bold(recordsIgnored)}`));
  uxLog(this, c.cyan(`Total files downloaded: ${c.bold(filesDownloaded)}`));
  uxLog(this, c.cyan(`Total file download errors: ${c.bold(filesErrors)}`));
  uxLog(this, c.cyan(`Total file skipped because of type constraint: ${c.bold(filesIgnoredType)}`));
  uxLog(this, c.cyan(`Total file skipped because previously downloaded: ${c.bold(filesIgnoredExisting)}`));

  return {
    totalParentRecords,
    parentRecordsWithFiles,
    filesDownloaded,
    filesErrors,
    recordsIgnored,
    filesIgnoredType,
    filesIgnoredExisting,
    apiLimit,
    apiUsedBefore,
    apiUsedAfter: conn.limitInfo.apiUsage.used,
    apiCallsRemaining,
  };
}

async function processRecord(parentRecord: any, exportedFilesFolder, dtl, conn, fetchOptions) {
  totalParentRecords++;
  // Create output folder for parent record
  const parentRecordFolderForFiles = path.join(exportedFilesFolder, parentRecord[dtl.outputFolderNameField] || parentRecord.Id);
  await fs.ensureDir(parentRecordFolderForFiles);

  // List all documents related to the parent record
  const contentDocumentSoql = `SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId='${parentRecord.Id}'`;
  uxLog(this, c.grey("Query: " + c.italic(contentDocumentSoql)));
  const contentDocumentLinks: any = await conn.query(contentDocumentSoql);
  totalSoqlRequests++;

  // Get initial API Limit
  if (apiUsedBefore == null) {
    apiUsedBefore = conn?.limitInfo?.apiUsage?.used ? conn.limitInfo.apiUsage.used - 1 : apiUsedBefore;
  }

  if (contentDocumentLinks.records.length > 0) {
    parentRecordsWithFiles++;
    // Retrieve documents content
    const contentDocIdIn = contentDocumentLinks.records.map((contentDocumentLink) => `'${contentDocumentLink.ContentDocumentId}'`).join(",");
    const contentVersionSoql = `SELECT ContentDocumentId,Description,FileExtension,FileType,PathOnClient,Title,VersionData FROM ContentVersion WHERE ContentDocumentId IN (${contentDocIdIn}) AND IsLatest = true`;
    uxLog(this, c.grey("Query: " + c.italic(contentVersionSoql)));
    const contentVersions: any = await conn.query(contentVersionSoql);
    totalSoqlRequests++;

    // Fetch files in output folder
    for (const contentVersion of contentVersions.records) {
      const outputFile = path.join(parentRecordFolderForFiles, contentVersion.Title);
      // Check file extension
      if (dtl.fileTypes !== "all" && !dtl.fileTypes.includes(contentVersion.FileType)) {
        uxLog(this, c.grey(`Skipped - ${outputFile.replace(exportedFilesFolder, "")} - File type ignored`));
        filesIgnoredType++;
        continue;
      }
      // Check file overwrite
      if (dtl.overwriteFiles !== true && fs.existsSync(outputFile)) {
        uxLog(this, c.yellow(`Skipped - ${outputFile.replace(exportedFilesFolder, "")} - File already existing`));
        filesIgnoredExisting++;
        continue;
      }
      // Download file locally
      const fetchUrl = conn.instanceUrl + contentVersion.VersionData;
      try {
        const fetchRes = await fetch(fetchUrl, fetchOptions);
        fetchRes.body.pipe(fs.createWriteStream(outputFile));
        uxLog(this, c.green(`Success - ${outputFile.replace(exportedFilesFolder, "")}`));
        filesDownloaded++;
      } catch (err) {
        // Download failure
        uxLog(this, c.red(`Error   - ${outputFile.replace(exportedFilesFolder, "")} - ${err}`));
        filesErrors++;
      }
    }
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

export async function getFilesWorkspaceDetail(dataWorkspace: string) {
  const exportFile = path.join(dataWorkspace, "export.json");
  if (!fs.existsSync(exportFile)) {
    uxLog(this, c.yellow(`Your File export folder ${c.bold(dataWorkspace)} must contain an ${c.bold("export.json")} configuration file`));
    return null;
  }
  const exportFileJson = JSON.parse(await fs.readFile(exportFile, "utf8"));
  const folderName = dataWorkspace.replace(/\\/g, "/").match(/([^/]*)\/*$/)[1];
  const hardisLabel = exportFileJson.sfdxHardisLabel || folderName;
  const hardisDescription = exportFileJson.sfdxHardisDescription || dataWorkspace;
  const soqlQuery = exportFileJson.soqlQuery || "";
  const fileTypes = exportFileJson.fileTypes || "all";
  const outputFolderNameField = exportFileJson.outputFolderNameField || "Name";
  const overwriteParentRecords = exportFileJson.overwriteParentRecords || true;
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
