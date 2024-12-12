import { SfError } from '@salesforce/core';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { elapseEnd, elapseStart, execCommand, uxLog } from './index.js';
import { getConfig } from '../../config/index.js';
import { prompts } from './prompts.js';
import { isProductionOrg } from './orgUtils.js';

export const dataFolderRoot = path.join('.', 'scripts', 'data');

// Import data from sfdmu folder
export async function importData(sfdmuPath: string, commandThis: any, options: any = {}) {
  const dtl = await getDataWorkspaceDetail(sfdmuPath);
  if (dtl?.isDelete === true) {
    throw new SfError('Your export.json contains deletion info, please use appropriate delete command');
  }
  uxLog(commandThis, c.cyan(`Importing data from ${c.green(dtl?.full_label)} ...`));
  /* jscpd:ignore-start */
  uxLog(commandThis, c.italic(c.grey(dtl?.description)));
  const targetUsername = options.targetUsername || commandThis.org.getConnection().username;
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
  await execCommand(dataImportCommand, commandThis, {
    fail: true,
    output: true,
  });
  elapseEnd(`import ${dtl?.full_label}`);
}

// Delete data using sfdmu folder
export async function deleteData(sfdmuPath: string, commandThis: any, options: any = {}) {
  const config = await getConfig('branch');
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
    uxLog(this, c.yellow(`If you see a sfdmu error, you probably need to add a property sfdmuCanModify: YOUR_ORG_INSTANCE_URL in the related config/branches/.sfdx-hardis.YOUR_BRANCH.yml config file.`));
  }
  // Delete using sfdmu
  uxLog(commandThis, c.cyan(`Deleting data from ${c.green(dtl?.full_label)} ...`));
  uxLog(commandThis, c.italic(c.grey(dtl?.description)));
  const targetUsername = options.targetUsername || options.conn.username;
  await fs.ensureDir(path.join(sfdmuPath, 'logs'));
  const dataImportCommand =
    'sf sfdmu:run' +
    ` --sourceusername ${targetUsername}` +
    ` -p ${sfdmuPath}` +
    ' --noprompt' +
    (config.sfdmuCanModify ? ` --canmodify ${config.sfdmuCanModify}` : '');
  elapseStart(`delete ${dtl?.full_label}`);
  await execCommand(dataImportCommand, commandThis, {
    fail: true,
    output: true,
  });
  elapseEnd(`delete ${dtl?.full_label}`);
}

// Export data from sfdmu folder
export async function exportData(sfdmuPath: string, commandThis: any, options: any = {}) {
  /* jscpd:ignore-start */
  const dtl = await getDataWorkspaceDetail(sfdmuPath);
  if (dtl?.isDelete === true) {
    throw new SfError('Your export.json contains deletion info, please use appropriate delete command');
  }
  /* jscpd:ignore-end */
  uxLog(commandThis, c.cyan(`Exporting data from ${c.green(dtl?.full_label)} ...`));
  uxLog(commandThis, c.italic(c.grey(dtl?.description)));
  const sourceUsername = options.sourceUsername || commandThis.org.getConnection().username;
  await fs.ensureDir(path.join(sfdmuPath, 'logs'));
  const dataImportCommand = `sf sfdmu:run --sourceusername ${sourceUsername} --targetusername csvfile -p ${sfdmuPath} --noprompt`; // keep target username until sfdmu migrates to SF cli base
  await execCommand(dataImportCommand, commandThis, {
    fail: true,
    output: true,
  });
}

export async function selectDataWorkspace(opts = { selectDataLabel: 'Please select a data workspace to export' }) {
  if (!fs.existsSync(dataFolderRoot)) {
    throw new SfError(
      "There is no sfdmu root folder 'scripts/data' in your workspace. Create it and define sfdmu exports using sfdmu: https://help.sfdmu.com/"
    );
  }

  const sfdmuFolders = fs
    .readdirSync(dataFolderRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.join('.', 'scripts', 'data', dirent.name));
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
    type: 'select',
    name: 'value',
    message: c.cyanBright(opts.selectDataLabel),
    choices: choices,
  });
  return sfdmuDirResult.value;
}

export async function getDataWorkspaceDetail(dataWorkspace: string) {
  const exportFile = path.join(dataWorkspace, 'export.json');
  if (!fs.existsSync(exportFile)) {
    uxLog(
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
