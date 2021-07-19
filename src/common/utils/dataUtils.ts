import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { execCommand, uxLog } from ".";
import { getConfig } from "../../config";
import { prompts } from "./prompts";

export const dataFolderRoot = path.join(".", "scripts", "data");

// Import data from sfdmu folder
export async function importData(sfdmuPath: string, commandThis: any, options: any = {}) {
  const dtl = await getDataWorkspaceDetail(sfdmuPath);
  uxLog(commandThis, c.cyan(`Importing data from ${c.green(dtl.full_label)} ...`));
  uxLog(commandThis, c.italic(c.grey(dtl.description)));
  const targetUsername = options.targetUsername || commandThis.org.getConnection().username;
  await fs.ensureDir(path.join(sfdmuPath, "logs"));
  const config = await getConfig("branch");
  const dataImportCommand =
    "sfdx sfdmu:run" +
    ` --sourceusername csvfile` +
    ` --targetusername ${targetUsername}` +
    ` -p '${sfdmuPath}'` +
    " --noprompt" +
    (config.sfdmuCanModify ? ` --canmodify ${config.sfdmuCanModify}` : "");
  await execCommand(dataImportCommand, commandThis, {
    fail: true,
    output: true,
  });
}

// Export data from sfdmu folder
export async function exportData(sfdmuPath: string, commandThis: any, options: any = {}) {
  const dtl = await getDataWorkspaceDetail(sfdmuPath);
  uxLog(commandThis, c.cyan(`Exporting data from ${c.green(dtl.full_label)} ...`));
  uxLog(commandThis, c.italic(c.grey(dtl.description)));
  const sourceUsername = options.sourceUsername || commandThis.org.getConnection().username;
  await fs.ensureDir(path.join(sfdmuPath, "logs"));
  const dataImportCommand = `sfdx sfdmu:run --sourceusername ${sourceUsername} --targetusername csvfile -p '${sfdmuPath}' --noprompt`;
  await execCommand(dataImportCommand, commandThis, {
    fail: true,
    output: true,
  });
}

export async function selectDataWorkspace() {
  if (!fs.existsSync(dataFolderRoot)) {
    throw new SfdxError(
      "There is no sfdmu root folder 'scripts/data' in your workspace. Create it and define sfdmu exports using sfdmu: https://help.sfdmu.com/"
    );
  }

  const sfdmuFolders = fs
    .readdirSync(dataFolderRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.resolve(path.join(".", "scripts", "data", dirent.name)));
  if (sfdmuFolders.length === 0) {
    throw new SfdxError("There is no sfdmu folder in your workspace. Create them using sfdmu: https://help.sfdmu.com/");
  }
  const choices: any = [];
  for (const sfdmuFolder of sfdmuFolders) {
    const dtl = await getDataWorkspaceDetail(sfdmuFolder);
    choices.push({
      title: dtl.full_label,
      description: dtl.description,
      value: sfdmuFolder,
    });
  }
  const sfdmuDirResult = await prompts({
    type: "select",
    name: "value",
    message: c.cyanBright("Please select a data workspace to export"),
    choices: choices,
  });
  return sfdmuDirResult.value;
}

export async function getDataWorkspaceDetail(dataWorkspace: string) {
  const exportFile = path.join(dataWorkspace, "export.json");
  if (!fs.existsSync(exportFile)) {
    throw new SfdxError(c.red(`Your SFDMU folder ${c.bold(dataWorkspace)} must contain an ${c.bold("export.json")} configuration file`));
  }
  const exportFileJson = JSON.parse(await fs.readFile(exportFile, "utf8"));
  const folderName = dataWorkspace.replace(/\\/g, "/").match(/([^/]*)\/*$/)[1];
  const hardisLabel = exportFileJson.sfdxHardisLabel || folderName;
  const hardisDescription = exportFileJson.sfdxHardisDescription || dataWorkspace;
  return {
    full_label: `[${folderName}]${folderName != hardisLabel ? `: ${hardisLabel}` : ""}`,
    label: hardisLabel,
    description: hardisDescription,
  };
}
