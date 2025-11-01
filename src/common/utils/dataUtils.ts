import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { elapseEnd, elapseStart, execCommand, uxLog } from './index.js';
import { getConfig } from '../../config/index.js';
import { prompts } from './prompts.js';
import { isProductionOrg } from './orgUtils.js';

export const DATA_FOLDERS_ROOT = path.join(process.cwd(), 'scripts', 'data');

// Import data from sfdmu folder
export async function importData(sfdmuPath: string, commandThis: any, options: any = { cwd: process.cwd() }) {
  const cwd = options?.cwd || process.cwd();
  const dtl = await getDataWorkspaceDetail(sfdmuPath);
  if (dtl?.isDelete === true) {
    throw new SfError('Your export.json contains deletion info, please use appropriate delete command');
  }
  let targetUsername = options.targetUsername || commandThis?.org?.getConnection().username;
  if (!targetUsername) {
    const conn: Connection = globalThis.jsForceConn;
    targetUsername = conn.getUsername();
  }
  uxLog("action", commandThis, c.cyan(`Importing data from ${c.green(dtl?.full_label)} into ${targetUsername}...`));
  /* jscpd:ignore-start */
  if (dtl?.description) {
    uxLog("log", commandThis, c.italic(c.grey("Data Workspace Description:" + dtl?.description)));
  }
  await fs.ensureDir(path.join(sfdmuPath, 'logs'));
  const config = await getConfig('branch');
  const dataImportCommand =
    'sf sfdmu:run' +
    ` --sourceusername csvfile` +
    ` --targetusername ${targetUsername}` + // Keep targetusername until sfdmu switches to target-org
    ` -p ${sfdmuPath}` +
    ' --noprompt' +
    // Needed for production orgs
    (config.sfdmuCanModify || process.env.SFDMU_CAN_MODIFY ? ` --canmodify ${config.sfdmuCanModify || process.env.SFDMU_CAN_MODIFY}` : '');
  /* jscpd:ignore-end */
  elapseStart(`import ${dtl?.full_label}`);
  const res = await execCommand(dataImportCommand, commandThis, {
    fail: true,
    output: true,
    cwd: cwd,
  });
  uxLog("success", commandThis, c.green(`Data imported successfully from ${c.green(dtl?.full_label)} into ${targetUsername}`));
  uxLog("log", commandThis, c.italic(c.grey(res.stdout || '')));
  elapseEnd(`import ${dtl?.full_label}`);
  return res;
}

// Delete data using sfdmu folder
export async function deleteData(sfdmuPath: string, commandThis: any, options: any = { cwd: process.cwd() }) {
  const config = await getConfig('branch');
  const cwd = options?.cwd || process.cwd();
  const dtl = await getDataWorkspaceDetail(sfdmuPath);
  if (dtl?.isDelete === false) {
    throw new SfError(
      'Your export.json does not contain deletion information. Please check http://help.sfdmu.com/full-documentation/advanced-features/delete-from-source'
    );
  }
  // If org is production, make sure that "runnableInProduction": true is present in export.json
  const isProdOrg = await isProductionOrg(options?.targetUsername || options?.conn?.username || "ERROR", options);
  if (isProdOrg === true && (dtl?.runnableInProduction || false) !== true) {
    throw new SfError(`To run this delete SFDMU script in production, you need to define "runnableInProduction": true in its export.json file`);
  }
  if (isProdOrg === true && !config.sfdmuCanModify) {
    uxLog("warning", commandThis, c.yellow(`If you see a sfdmu error, you probably need to add a property sfdmuCanModify: YOUR_ORG_INSTANCE_URL in the related config/branches/.sfdx-hardis.YOUR_BRANCH.yml config file.`));
  }
  uxLog("action", commandThis, c.cyan(`Deleting data from ${c.green(dtl?.full_label)} ...`));
  if (dtl?.description) {
    uxLog("log", commandThis, c.italic(c.grey("Data Workspace Description:" + dtl?.description)));
  }
  const targetUsername = options.targetUsername || options.conn.username;
  await fs.ensureDir(path.join(sfdmuPath, 'logs'));
  const dataImportCommand =
    'sf sfdmu:run' +
    ` --sourceusername ${targetUsername}` +
    ` -p ${sfdmuPath}` +
    ' --noprompt' +
    (config.sfdmuCanModify ? ` --canmodify ${config.sfdmuCanModify}` : '');
  elapseStart(`delete ${dtl?.full_label}`);
  const res = await execCommand(dataImportCommand, commandThis, {
    fail: true,
    output: true,
    cwd: cwd,
  });
  uxLog("success", commandThis, c.green(`Data deleted successfully from ${c.green(dtl?.full_label)}`));
  uxLog("log", commandThis, c.italic(c.grey(res.stdout || '')));
  elapseEnd(`delete ${dtl?.full_label}`);
}

// Export data from sfdmu folder
export async function exportData(sfdmuPath: string, commandThis: any, options: any = { cwd: process.cwd() }) {
  /* jscpd:ignore-start */
  const cwd = options?.cwd || process.cwd();
  const dtl = await getDataWorkspaceDetail(sfdmuPath);
  if (dtl?.isDelete === true) {
    throw new SfError('Your export.json contains deletion info, please use appropriate delete command');
  }
  /* jscpd:ignore-end */
  uxLog("action", commandThis, c.cyan(`Exporting data from ${c.green(dtl?.full_label)} ...`));
  if (dtl?.description) {
    uxLog("log", commandThis, c.italic(c.grey("Data Workspace Description:" + dtl?.description)));
  }
  const sourceUsername = options.sourceUsername || commandThis?.org?.getConnection().username;
  await fs.ensureDir(path.join(sfdmuPath, 'logs'));
  const dataImportCommand = `sf sfdmu:run --sourceusername ${sourceUsername} --targetusername csvfile -p ${sfdmuPath} --noprompt`;
  elapseStart(`export ${dtl?.full_label}`);
  const res = await execCommand(dataImportCommand, commandThis, {
    fail: true,
    output: true,
    cwd: cwd,
  });
  uxLog("success", commandThis, c.green(`Data exported successfully from ${c.green(dtl?.full_label)}`));
  uxLog("log", commandThis, c.italic(c.grey(res.stdout || '')));
  elapseEnd(`export ${dtl?.full_label}`);
}

export async function findDataWorkspaceByName(projectName: string, throwIfNotFound: boolean = true) {
  const folderPath = path.join(DATA_FOLDERS_ROOT, projectName);
  if (fs.existsSync(folderPath)) {
    return folderPath;
  }
  if (!throwIfNotFound) {
    return null;
  }
  throw new SfError(`There is no sfdmu folder named ${projectName} in your workspace (${DATA_FOLDERS_ROOT})`);
}

export async function hasDataWorkspaces(cwd: string = process.cwd()) {
  const dataFolderToSearch = path.join(cwd, 'scripts', 'data');
  if (!fs.existsSync(dataFolderToSearch)) {
    return false;
  }
  const sfdmuFolders = listDataFolders(dataFolderToSearch);
  return sfdmuFolders.length > 0;
}

function listDataFolders(dataFolderToSearch: string) {
  const sfdmuFolders = fs
    .readdirSync(dataFolderToSearch, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.join('scripts', 'data', dirent.name));
  return sfdmuFolders
}

export async function selectDataWorkspace(opts: { selectDataLabel: string, multiple?: boolean, initial?: string | string[], cwd?: string } = { selectDataLabel: 'Please select a data workspace to export', multiple: false }): Promise<string | string[] | null> {
  let dataFolderToSearch = DATA_FOLDERS_ROOT;
  if (opts.cwd) {
    dataFolderToSearch = path.join(opts.cwd, 'scripts', 'data');
  }
  if (!fs.existsSync(dataFolderToSearch)) {
    uxLog("warning", this,
      c.yellowBright(
        "There is no sfdmu root folder 'scripts/data' in your workspace. Create it and define sfdmu exports using sfdmu: https://help.sfdmu.com/"
      ));
    return null;
  }

  const sfdmuFolders = listDataFolders(dataFolderToSearch);
  if (sfdmuFolders.length === 0) {
    throw new SfError('There is no sfdmu folder in your workspace. Create them using sfdmu: https://help.sfdmu.com/');
  }
  const choices: any = [];
  for (const sfdmuFolder of sfdmuFolders) {
    const dtl = await getDataWorkspaceDetail(sfdmuFolder);
    if (dtl !== null) {
      choices.push({
        title: `📁 ${dtl.full_label}`,
        description: dtl.description,
        value: sfdmuFolder,
      });
    }
  }
  const sfdmuDirResult = await prompts({
    type: opts.multiple ? 'multiselect' : 'select',
    name: 'value',
    message: c.cyanBright(opts.selectDataLabel),
    description: 'Select the SFDMU data configuration to use for this operation',
    choices: choices,
    initial: opts?.initial === "all" ? sfdmuFolders : opts?.initial ?? null
  });
  return sfdmuDirResult.value;
}

export async function getDataWorkspaceDetail(dataWorkspace: string) {
  const exportFile = path.join(dataWorkspace, 'export.json');
  if (!fs.existsSync(exportFile)) {
    uxLog(
      "warning",
      this,
      c.yellow(`Your SFDMU folder ${c.bold(dataWorkspace)} must contain an ${c.bold('export.json')} configuration file`)
    );
    return null;
  }
  const exportFileJson = JSON.parse(await fs.readFile(exportFile, 'utf8'));
  const folderName = (dataWorkspace.replace(/\\/g, '/').match(/([^/]*)\/*$/) || [])[1];
  const hardisLabel = exportFileJson.sfdxHardisLabel || folderName;
  const hardisDescription = exportFileJson.sfdxHardisDescription || dataWorkspace;
  return {
    full_label: `[${folderName}]${folderName != hardisLabel ? `: ${hardisLabel}` : ''}`,
    label: hardisLabel,
    description: hardisDescription,
    exportJson: exportFileJson,
    isDelete: isDeleteDataWorkspace(exportFileJson),
    runnableInProduction: exportFileJson.runnableInProduction || false
  };
}

// Checks if a sfdmu data workspace can delete object!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!*!*!é!*é!!!é*!é!*!*é!*!*!*!*!*!*!**!!!!!!!*!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!s -> https://help.sfdmu.com/full-documentation/advanced-features/delete-from-source
export function isDeleteDataWorkspace(exportFileJson: any) {
  let isDelete = false;
  for (const objectConfig of exportFileJson.objects) {
    if (objectConfig?.deleteFromSource === true || objectConfig.operation === 'DeleteSource') {
      isDelete = true;
    }
  }
  return isDelete;
}
