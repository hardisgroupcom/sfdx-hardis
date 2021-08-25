import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as fetch from "node-fetch";
import * as path from "path";
import { uxLog } from ".";
import { prompts } from "./prompts";

export const filesFolderRoot = path.join(".", "scripts", "files");

// Export data from files folder
export async function exportFiles(filesPath: string, conn: any, commandThis: any) {
  const dtl = await getFilesWorkspaceDetail(filesPath);
  uxLog(commandThis, c.cyan(`Exporting files from ${c.green(dtl.full_label)} ...`));
  uxLog(commandThis, c.italic(c.grey(dtl.description)));

  // Make sure export folder for files is existing
  const exportedFilesFolder = path.join(filesPath, "export");
  await fs.ensureDir(exportedFilesFolder);

  // Initialize stats variables
  let totalParentRecords = 0;
  let parentRecordsWithFiles = 0;
  let filesDownloaded = 0;
  let filesErrors = 0;
  let filesIgnoredType = 0;
  let filesIgnoredExisting = 0;

  // Build fetch options for HTTP calls to retrieve document files
  const fetchOptions = {
    method: "GET",
    headers: {
      Authorization: "Bearer " + conn.accessToken,
      "Content-Type": "blob",
    },
  };

  // Query parent records using SOQL defined in export.json file
  uxLog(this, c.grey("Query: " + c.italic(dtl.soqlQuery)));
  const parentRecords: any = await conn.query(dtl.soqlQuery);

  for (const parentRecord of parentRecords.records) {
    totalParentRecords++;
    // Create output folder for parent record
    const parentRecordFolderForFiles = path.join(exportedFilesFolder, parentRecord[dtl.outputFolderNameField] || parentRecord.Id);
    await fs.ensureDir(parentRecordFolderForFiles);

    // List all documents related to the parent record
    const contentDocumentSoql = `SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId='${parentRecord.Id}'`;
    uxLog(this, c.grey("Query: " + c.italic(contentDocumentSoql)));
    const contentDocumentLinks: any = await conn.query(contentDocumentSoql);

    if (contentDocumentLinks.records.length > 0) {
      parentRecordsWithFiles++;
      // Retrieve documents content
      const contentDocIdIn = contentDocumentLinks.records.map((contentDocumentLink) => `'${contentDocumentLink.ContentDocumentId}'`).join(",");
      const contentVersionSoql = `SELECT ContentDocumentId,Description,FileExtension,FileType,PathOnClient,Title,VersionData FROM ContentVersion WHERE ContentDocumentId IN (${contentDocIdIn}) AND IsLatest = true`;
      uxLog(this, c.grey("Query: " + c.italic(contentVersionSoql)));
      const contentVersions: any = await conn.query(contentVersionSoql);

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
        fetch(fetchUrl, fetchOptions)
          .then((result: any) => {
            // Donwload success
            result.body.pipe(fs.createWriteStream(outputFile));
            uxLog(this, c.green(`Success - ${outputFile.replace(exportedFilesFolder, "")}`));
            filesDownloaded++;
          })
          .catch((err: any) => {
            // Download failure
            uxLog(this, c.red(`Error   - ${outputFile.replace(exportedFilesFolder, "")} - ${err}`));
            filesErrors++;
          });
      }
    }
  }
  uxLog(this, c.cyan(`Total parent records found: ${c.bold(totalParentRecords)}`));
  uxLog(this, c.cyan(`Total parent records with files: ${c.bold(parentRecordsWithFiles)}`));
  uxLog(this, c.cyan(`Total files downloaded: ${c.bold(filesDownloaded)}`));
  uxLog(this, c.cyan(`Total file download errors: ${c.bold(filesErrors)}`));
  uxLog(this, c.cyan(`Total file skipped because of type constraint: ${c.bold(filesIgnoredType)}`));
  uxLog(this, c.cyan(`Total file skipped because previously downloaded: ${c.bold(filesIgnoredExisting)}`));
  return { totalParentRecords, parentRecordsWithFiles, filesDownloaded, filesErrors, filesIgnoredType, filesIgnoredExisting };
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
