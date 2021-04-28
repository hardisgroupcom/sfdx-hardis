import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { execCommand, uxLog } from ".";
import { prompts } from "./prompts";

// Import data from sfdmu folder
export async function importData(sfdmuPath: string, commandThis: any, options: any = {}) {
  uxLog(commandThis, c.cyan(`Importing data from ${c.green(sfdmuPath)} ...`));
  const targetUsername = options.targetUsername || commandThis.org.getConnection().username;
  const dataImportCommand = `sfdx sfdmu:run --sourceusername csvfile --targetusername ${targetUsername} -p ${sfdmuPath}`;
  await execCommand(dataImportCommand, commandThis, {
    fail: true,
    output: true,
  });
}

// Import data from sfdmu folder
export async function exportData(sfdmuPath: string, commandThis: any, options: any = {}) {
  uxLog(commandThis, c.cyan(`Exporting data from ${c.green(sfdmuPath)} ...`));
  const sourceUsername = options.sourceUsername || commandThis.org.getConnection().username;
  const dataImportCommand = `sfdx sfdmu:run --sourceusername ${sourceUsername} --targetusername csvfile -p ${sfdmuPath}`;
  await execCommand(dataImportCommand, commandThis, {
    fail: true,
    output: true,
  });
}

export async function selectDataWorkspace() {
  const dataFolderRoot = path.join(".", "scripts", "data");
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
  const sfdmuDirResult = await prompts({
    type: "select",
    name: "value",
    message: c.cyanBright("Please select a data workspace to export"),
    choices: sfdmuFolders.map((sfdmuFolder) => {
      return { title: sfdmuFolder, value: sfdmuFolder };
    }),
  });
  return sfdmuDirResult.value;
}
