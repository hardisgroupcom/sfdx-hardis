import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import fs from './fsUtils.js';
import * as path from 'path';
import { elapseEnd, elapseStart, execSfdxJson, isAgentMode, isCI, uxLog } from './index.js';
import { getConfig } from '../../config/index.js';
import { prompts } from './prompts.js';
import { uxLogTableWithReport } from './filesUtils.js';
import { soqlQuery } from './apiUtils.js';
import { executeSfdmuCommand, SfdmuOperationType } from './sfdmuProgress.js';
import { t } from './i18n.js';

export const DATA_FOLDERS_ROOT = path.join(process.cwd(), 'scripts', 'data');

const DATA_WORKSPACE_TABLE_COLUMNS = ['Object', 'Operation', 'External Id', 'Filter', 'Mock fields'];

// Summarize what sfdmu will do with each object of the workspace, as export.json can be hard to read
export function buildDataWorkspaceObjectsSummary(exportJson: any): any[] {
  return (exportJson?.objects || []).map((objectConfig: any) => {
    const query: string = objectConfig?.query || '';
    const whereMatch = query.match(/\bWHERE\s+(.+?)(?:\s+(?:ORDER BY|GROUP BY|LIMIT|OFFSET)\b|$)/i);
    const filter = whereMatch ? whereMatch[1].trim() : '';
    return {
      Object: (query.match(/\bFROM\s+([\w.]+)/i) || [])[1] || objectConfig?.objectName || '?',
      Operation: objectConfig?.deleteFromSource === true ? 'DeleteSource' : objectConfig?.operation || 'Readonly',
      'External Id': objectConfig?.externalId || '',
      Filter: filter.length > 60 ? filter.substring(0, 57) + '...' : filter,
      'Mock fields': (objectConfig?.mockFields || [])
        .map((mockField: any) => mockField?.name)
        .filter(Boolean)
        .join(', '),
    };
  });
}

/**
 * Displays the content of a sfdmu workspace (export.json), then asks the user to confirm the operation.
 * The confirmation is requested only when the caller asks for it (interactive hardis:org:data:* commands):
 * automated flows like deployments, org initialization or sandbox refresh must never be blocked by a prompt.
 */
export async function displayDataWorkspaceAndConfirm(
  commandThis: any,
  dtl: any,
  options: { operation: SfdmuOperationType; orgUsername?: string; promptConfirm?: boolean }
): Promise<void> {
  // Summary of the objects handled by the workspace
  const objectsSummary = buildDataWorkspaceObjectsSummary(dtl?.exportJson);
  if (objectsSummary.length > 0) {
    const columns = DATA_WORKSPACE_TABLE_COLUMNS.filter(
      (column) => ['Object', 'Operation'].includes(column) || objectsSummary.some((row) => row[column] !== '')
    );
    await uxLogTableWithReport(commandThis, objectsSummary, columns, {
      fileNamePrefix: `sfdmu-workspace-${options.operation}`,
      fileTitle: `SFDMU workspace objects`,
    });
  }
  // Full export.json: it can contain many other settings that are not in the summary
  uxLog('log', commandThis, c.italic(c.grey(t('dataWorkspace') + JSON.stringify(dtl?.exportJson, null, 2))));

  if (options.promptConfirm !== true || isCI || isAgentMode()) {
    return;
  }
  const confirmKey =
    options.operation === 'import'
      ? 'confirmDataImport'
      : options.operation === 'export'
        ? 'confirmDataExport'
        : 'confirmDataDelete';
  const confirmRes = await prompts({
    type: 'confirm',
    message: t(confirmKey, { dtl: dtl?.full_label || '', org: options.orgUsername || '' }),
    description: t('confirmDataOperationDescription'),
  });
  if (confirmRes.value !== true) {
    throw new SfError(t('dataOperationCancelledByUser'));
  }
  // The VS Code UI hides everything that follows a prompt until the next action log
  const startedKey =
    options.operation === 'import'
      ? 'sfdmuImportingData'
      : options.operation === 'export'
        ? 'sfdmuExportingData'
        : 'sfdmuDeletingData';
  uxLog('action', commandThis, c.cyan(t(startedKey)));
}

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
  uxLog("action", commandThis, c.cyan(t('importingDataFromInto', { dtl: c.green(dtl?.full_label), targetUsername })));
  // Needed for production orgs
  const canModify = await resolveSfdmuCanModify(commandThis, targetUsername, options);
  /* jscpd:ignore-start */
  await displayDataWorkspaceAndConfirm(commandThis, dtl, {
    operation: 'import',
    orgUsername: targetUsername,
    promptConfirm: options.promptConfirm === true,
  });
  await fs.ensureDir(path.join(sfdmuPath, 'logs'));
  const dataImportCommand =
    'sf sfdmu:run' +
    ` --sourceusername csvfile` +
    ` --targetusername ${targetUsername}` + // Keep targetusername until sfdmu switches to target-org
    ` -p "${sfdmuPath}"` +
    ' --noprompt' +
    (canModify ? ` --canmodify ${canModify}` : '');
  /* jscpd:ignore-end */
  elapseStart(`import ${dtl?.full_label}`);
  const res = await executeSfdmuCommand(dataImportCommand, commandThis, {
    fail: true,
    output: true,
    cwd: cwd,
    operationType: 'import',
  });
  uxLog("success", commandThis, c.green(t('dataImportedSuccessfullyFromInto', { dtl: c.green(dtl?.full_label), targetUsername })));
  uxLog("log", commandThis, c.italic(c.grey(res.stdout || '')));
  elapseEnd(`import ${dtl?.full_label}`);
  return res;
}

// Delete data using sfdmu folder
export async function deleteData(sfdmuPath: string, commandThis: any, options: any = { cwd: process.cwd() }) {
  const cwd = options?.cwd || process.cwd();
  const dtl = await getDataWorkspaceDetail(sfdmuPath);
  if (dtl?.isDelete === false) {
    throw new SfError(
      'Your export.json does not contain deletion information. Please check http://help.sfdmu.com/full-documentation/advanced-features/delete-from-source'
    );
  }
  const targetUsername = options.targetUsername || options.conn.username;
  // If org is production, make sure that "runnableInProduction": true is present in export.json
  const isProdOrg = await isSfdmuProductionOrg(commandThis, targetUsername, options);
  if (isProdOrg === true && (dtl?.runnableInProduction || false) !== true) {
    throw new SfError(`To run this delete SFDMU script in production, you need to define "runnableInProduction": true in its export.json file`);
  }
  uxLog("action", commandThis, c.cyan(t('deletingDataFrom', { dtl: c.green(dtl?.full_label) })));

  const canModify = await resolveSfdmuCanModify(commandThis, targetUsername, options, isProdOrg);
  if (isProdOrg === true && !canModify) {
    uxLog("warning", commandThis, c.yellow(`If you see a sfdmu error, you probably need to add a property sfdmuCanModify: YOUR_ORG_INSTANCE_URL in the related config/branches/.sfdx-hardis.YOUR_BRANCH.yml config file.`));
  }
  await displayDataWorkspaceAndConfirm(commandThis, dtl, {
    operation: 'delete',
    orgUsername: targetUsername,
    promptConfirm: options.promptConfirm === true,
  });
  await fs.ensureDir(path.join(sfdmuPath, 'logs'));
  const dataImportCommand =
    'sf sfdmu:run' +
    ` --sourceusername ${targetUsername}` +
    ` -p "${sfdmuPath}"` +
    ' --noprompt' +
    (canModify ? ` --canmodify ${canModify}` : '');
  elapseStart(`delete ${dtl?.full_label}`);
  const res = await executeSfdmuCommand(dataImportCommand, commandThis, {
    fail: true,
    output: true,
    cwd: cwd,
    operationType: 'delete',
  });
  uxLog("success", commandThis, c.green(t('dataDeletedSuccessfullyFrom', { dtl: c.green(dtl?.full_label) })));
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
  uxLog("action", commandThis, c.cyan(t('exportingDataFrom', { dtl: c.green(dtl?.full_label) })));
  const sourceUsername = options.sourceUsername || commandThis?.org?.getConnection().username;
  await displayDataWorkspaceAndConfirm(commandThis, dtl, {
    operation: 'export',
    orgUsername: sourceUsername,
    promptConfirm: options.promptConfirm === true,
  });
  await fs.ensureDir(path.join(sfdmuPath, 'logs'));
  const dataImportCommand = `sf sfdmu:run --sourceusername ${sourceUsername} --targetusername csvfile -p "${sfdmuPath}" --noprompt`;
  elapseStart(`export ${dtl?.full_label}`);
  const res = await executeSfdmuCommand(dataImportCommand, commandThis, {
    fail: true,
    output: true,
    cwd: cwd,
    operationType: 'export',
  });
  uxLog("success", commandThis, c.green(t('dataExportedSuccessfullyFrom', { dtl: c.green(dtl?.full_label) })));
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

/**
 * Folder of an SFDMU workspace: a workspace name under scripts/data, or a project-relative path to
 * an SFDMU folder (dataPackages entries can point outside scripts/data). Null when neither exists.
 */
export async function resolveDataWorkspacePath(sfdmuProject: string): Promise<string | null> {
  if (!sfdmuProject) {
    return null;
  }
  const workspacePath = await findDataWorkspaceByName(sfdmuProject, false);
  if (workspacePath) {
    return workspacePath;
  }
  return fs.existsSync(sfdmuProject) && fs.statSync(sfdmuProject).isDirectory() ? sfdmuProject : null;
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
    description: t('descChooseSfdmuConfig'),
    choices: choices,
    initial: opts?.initial === "all" ? sfdmuFolders : opts?.initial ?? null
  });
  return sfdmuDirResult.value;
}

export async function getDataWorkspaceDetail(dataWorkspace: string) {
  const exportFile = path.join(dataWorkspace, 'export.json');
  if (!fs.existsSync(exportFile)) {
    uxLog(
      "action",
      this,
      c.cyan(`Your SFDMU folder ${c.bold(dataWorkspace)} must contain an ${c.bold('export.json')} configuration file`)
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

// What resolveSfdmuCanModify needs from its environment: tests give fakes, other callers use the defaults
export type SfdmuCanModifyDeps = {
  canPrompt: () => boolean;
  ask: typeof prompts;
};

const DEFAULT_SFDMU_CAN_MODIFY_DEPS: SfdmuCanModifyDeps = {
  canPrompt: () => !isCI && !isAgentMode(),
  ask: prompts,
};

/**
 * SFDMU refuses to modify a production org unless --canmodify matches the instance domain of the org,
 * and its own prompt can not be answered when sfdx-hardis runs it with --noprompt.
 * Returns sfdmuCanModify (config or SFDMU_CAN_MODIFY), or, in interactive mode, the instance domain of the
 * production org once the user confirmed. Returns an empty string when nothing is authorized.
 */
export async function resolveSfdmuCanModify(
  commandThis: any,
  targetUsername: string,
  options: any,
  isProdOrg?: boolean,
  deps: SfdmuCanModifyDeps = DEFAULT_SFDMU_CAN_MODIFY_DEPS
): Promise<string> {
  const config = await getConfig('branch');
  const configuredCanModify = config.sfdmuCanModify || process.env.SFDMU_CAN_MODIFY || '';
  if (configuredCanModify) {
    return configuredCanModify;
  }
  if (options?.promptConfirm !== true || !deps.canPrompt()) {
    return '';
  }
  const isProd = isProdOrg ?? (await isSfdmuProductionOrg(commandThis, targetUsername, options));
  if (isProd !== true) {
    return '';
  }
  const instanceDomain = await getOrgInstanceDomain(commandThis, targetUsername, options);
  if (!instanceDomain) {
    return '';
  }
  const confirmRes = await deps.ask({
    type: 'confirm',
    message: t('confirmSfdmuModifyProductionOrg', { org: instanceDomain }),
    description: t('confirmSfdmuModifyProductionOrgDescription', { org: instanceDomain }),
  });
  if (confirmRes.value !== true) {
    throw new SfError(t('dataOperationCancelledByUser'));
  }
  // The VS Code UI hides everything that follows a prompt until the next action log
  uxLog('action', commandThis, c.cyan(t('sfdmuProductionOrgModificationAuthorized', { org: c.green(instanceDomain) })));
  return instanceDomain;
}

// Same rule as SFDMU: Developer Edition orgs are not production orgs, even if they are not sandboxes
export async function isSfdmuProductionOrg(commandThis: any, targetUsername: string, options: any): Promise<boolean> {
  const orgQuery = 'SELECT IsSandbox, OrganizationType FROM Organization LIMIT 1';
  let orgRecords: any[];
  if (options?.conn?.username && options.conn.username === targetUsername) {
    orgRecords = (await soqlQuery(orgQuery, options.conn)).records;
  }
  else {
    const orgQueryRes = await execSfdxJson(`sf data query --query "${orgQuery}" --target-org ${targetUsername}`, commandThis, {
      output: false,
      fail: true,
    });
    orgRecords = orgQueryRes?.result?.records || [];
  }
  return orgRecords[0]?.IsSandbox === false && orgRecords[0]?.OrganizationType !== 'Developer Edition';
}

export async function getOrgInstanceDomain(commandThis: any, targetUsername: string, options: any): Promise<string> {
  let instanceUrl: string = options?.conn?.username === targetUsername ? options.conn.instanceUrl : '';
  if (!instanceUrl) {
    const displayResult = await execSfdxJson(`sf org display --target-org ${targetUsername}`, commandThis, {
      fail: false,
      output: false,
    });
    instanceUrl = displayResult?.result?.instanceUrl || '';
  }
  try {
    return new URL(instanceUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}
