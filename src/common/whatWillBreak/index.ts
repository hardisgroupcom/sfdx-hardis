import path from 'path';
import { SfError } from '@salesforce/core';
import { soqlQuery } from '../utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../utils/filesUtils.js';
import { t } from '../utils/i18n.js';
import { getMonitoringDisable } from '../notifProvider/utils/notificationConfig.js';
import { WebSocketClient } from '../websocketClient.js';
import { loadLoginHistory, needsLoginHistory, runAuthCheck } from './authChecks.js';
import { buildMainRow } from './checkResults.js';
import { checkConnectedAppsToEca } from './connectedAppsCheck.js';
import { checkLegacyApiVersions } from './legacyApiCheck.js';
import { checkReleaseUpdates } from './releaseUpdatesCheck.js';
import { getDeadlineDate, WHAT_WILL_BREAK_DEADLINES } from './whatWillBreakDeadlines.js';
import {
  CheckContext,
  WhatWillBreakCheckKey,
  WhatWillBreakCheckResult,
  WhatWillBreakDatedMainRow,
  WhatWillBreakFamily,
  WhatWillBreakMainRow,
  WhatWillBreakOptions,
  WhatWillBreakResult,
} from './whatWillBreakTypes.js';

export interface WhatWillBreakCheckDefinition {
  key: WhatWillBreakCheckKey;
  family: WhatWillBreakFamily;
  titleKey: string;
  // Name of the metric sent with the notification, when the check has one
  metricName?: string;
  // Monitoring command this check replaces: turning that command off also skips the check
  replacesMonitoringKey?: string;
}

// Every check, the earliest Salesforce date first
export const WHAT_WILL_BREAK_CHECKS: WhatWillBreakCheckDefinition[] = [
  { key: 'idleRefreshTokens', family: 'auth', titleKey: 'authRetirementsCheckIdleTokens', metricName: 'IdleRefreshTokensExpiringSoon' },
  { key: 'refreshTokenCadence', family: 'auth', titleKey: 'whatWillBreakCheckRefreshTokenCadence', metricName: 'IntegrationsRefreshingTooRarely' },
  { key: 'deviceFlow', family: 'auth', titleKey: 'authRetirementsCheckDeviceFlow', metricName: 'DeviceFlowUsers' },
  { key: 'soapLoginPermission', family: 'auth', titleKey: 'authRetirementsCheckSoapPermission', metricName: 'SoapLoginUsersMissingPermission' },
  { key: 'soapLoginIpRange', family: 'auth', titleKey: 'authRetirementsCheckSoapIpRange', metricName: 'SoapLoginUsersNeedingToken' },
  { key: 'soapLoginInactivity', family: 'auth', titleKey: 'authRetirementsCheckSoapInactivity' },
  { key: 'usernamePasswordFlow', family: 'auth', titleKey: 'authRetirementsCheckUsernamePassword', metricName: 'UsernamePasswordFlowUsers' },
  { key: 'sfConnectLegacyAuth', family: 'auth', titleKey: 'authRetirementsCheckSfConnect', metricName: 'SfConnectLegacyDataSources' },
  { key: 'soapLoginRetirement', family: 'auth', titleKey: 'authRetirementsCheckSoapRetirement', metricName: 'SoapLoginUsers' },
  { key: 'connectedAppsToEca', family: 'connectedApps', titleKey: 'whatWillBreakCheckConnectedAppsToEca', metricName: 'ConnectedAppsToMigrate' },
  {
    key: 'legacyApiVersions',
    family: 'apiVersions',
    titleKey: 'whatWillBreakCheckLegacyApiVersions',
    metricName: 'LegacyApiCalls',
    replacesMonitoringKey: 'LEGACY_API',
  },
  {
    key: 'releaseUpdates',
    family: 'releaseUpdates',
    titleKey: 'whatWillBreakCheckReleaseUpdates',
    metricName: 'ReleaseUpdates',
    replacesMonitoringKey: 'RELEASE_UPDATES',
  },
];

export const WHAT_WILL_BREAK_CHECK_KEYS: WhatWillBreakCheckKey[] = WHAT_WILL_BREAK_CHECKS.map((check) => check.key);

// Check keys from the comma-separated --checks flag; an unknown key is an error, so a typo never skips a check silently
export function parseWhatWillBreakChecks(value: string): WhatWillBreakCheckKey[] {
  const keys = value
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  const unknown = keys.filter((key) => !WHAT_WILL_BREAK_CHECK_KEYS.includes(key as WhatWillBreakCheckKey));
  if (unknown.length > 0) {
    throw new SfError(t('whatWillBreakUnknownChecks', { checks: unknown.join(', '), available: WHAT_WILL_BREAK_CHECK_KEYS.join(', ') }));
  }
  return WHAT_WILL_BREAK_CHECK_KEYS.filter((key) => keys.includes(key));
}

// Checks run when none is chosen: all of them, except those whose former monitoring command the user turned off
// (monitoringDisable, or frequency "off" in monitoringCommands)
export function getDefaultWhatWillBreakChecks(config: any): WhatWillBreakCheckKey[] {
  const disabled = getMonitoringDisable(config);
  const monitoringCommands: any[] = Array.isArray(config?.monitoringCommands) ? config.monitoringCommands : [];
  return WHAT_WILL_BREAK_CHECKS.filter((check) => {
    if (!check.replacesMonitoringKey) {
      return true;
    }
    const override = monitoringCommands.find((entry) => entry?.key === check.replacesMonitoringKey);
    return !disabled.includes(check.replacesMonitoringKey) && override?.frequency !== 'off';
  }).map((check) => check.key);
}

export function getWhatWillBreakCheckTitle(key: WhatWillBreakCheckKey): string {
  const definition = WHAT_WILL_BREAK_CHECKS.find((check) => check.key === key);
  return definition ? t(definition.titleKey) : key;
}

export function getWhatWillBreakFamilyTitle(family: WhatWillBreakFamily): string {
  const keys: Record<WhatWillBreakFamily, string> = {
    auth: 'whatWillBreakFamilyAuth',
    apiVersions: 'whatWillBreakFamilyApiVersions',
    releaseUpdates: 'whatWillBreakFamilyReleaseUpdates',
    connectedApps: 'whatWillBreakFamilyConnectedApps',
  };
  return t(keys[family]);
}

// Run the selected checks. Fails when the org cannot be reached, instead of reporting every check as not run.
export async function runWhatWillBreak(options: WhatWillBreakOptions): Promise<WhatWillBreakResult> {
  const context: CheckContext = {
    conn: options.conn,
    today: options.today || new Date(),
    isSandbox: await fetchIsSandbox(options),
    lookbackDays: options.lookbackDays,
    idleWarningDays: options.idleWarningDays,
    ignoreSet: new Set(options.ignoreUsers.map((user) => user.toLowerCase())),
    logins: { failed: true, records: [], usernameById: new Map(), activeUserIds: new Set() },
    commandThis: options.commandThis,
    debugMode: options.debugMode,
  };
  const selected = WHAT_WILL_BREAK_CHECKS.filter((check) => options.checks.includes(check.key));
  if (needsLoginHistory(selected.map((check) => check.key))) {
    await withProgress(t('whatWillBreakReadingLoginHistory', { days: context.lookbackDays }), () => loadLoginHistory(context));
  }
  const checks: WhatWillBreakCheckResult[] = [];
  for (const [index, check] of selected.entries()) {
    const progressTitle = t('whatWillBreakCheckProgress', {
      position: index + 1,
      total: selected.length,
      title: getWhatWillBreakCheckTitle(check.key),
    });
    checks.push(await withProgress(progressTitle, () => runCheck(context, check)));
  }
  return { checks, metrics: buildMetrics(checks), severity: rollupSeverity(checks), isSandbox: context.isSandbox };
}

// Write the report of every check that found something, then return the main report rows:
// what will break first (errors, then warnings, the earliest date first), then information, checks not run, and checks that found nothing
export async function writeWhatWillBreakReports(result: WhatWillBreakResult): Promise<{
  mainRows: WhatWillBreakMainRow[];
  reportFiles: Record<string, string[]>;
}> {
  const reportFiles: Record<string, string[]> = {};
  const datedRows: WhatWillBreakDatedMainRow[] = [];
  for (const check of result.checks) {
    reportFiles[check.key] = await writeCheckReport(check);
    const reportName = reportFiles[check.key].length > 0 ? path.basename(reportFiles[check.key][0]) : '';
    for (const datedRow of buildCheckMainRows(check, result.isSandbox)) {
      datedRow.row['Detail report'] = reportName;
      datedRows.push(datedRow);
    }
  }
  const order: Record<string, number> = { error: 0, warning: 1, info: 2, notChecked: 3, success: 4 };
  datedRows.sort(
    (a, b) =>
      order[a.row.Severity] - order[b.row.Severity] ||
      (a.date || '9999').localeCompare(b.date || '9999') ||
      a.row.Check.localeCompare(b.row.Check)
  );
  return { mainRows: datedRows.map((datedRow) => datedRow.row), reportFiles };
}

// Every API user can read Organization: an error here means the org cannot be reached (expired login, invalid session...).
// It is not caught, so the command fails instead of reporting every check as not run, which would read as "nothing will break".
async function fetchIsSandbox(options: WhatWillBreakOptions): Promise<boolean> {
  const res = await soqlQuery('SELECT IsSandbox FROM Organization LIMIT 1', options.conn);
  return res.records?.[0]?.IsSandbox === true;
}

// Show a step as a progress block in the UIs listening to the command (VS Code). A check with known steps sends them itself.
async function withProgress<T>(title: string, run: () => Promise<T>): Promise<T> {
  WebSocketClient.sendProgressStartMessage(title);
  try {
    return await run();
  } finally {
    WebSocketClient.sendProgressEndMessage();
  }
}

async function runCheck(context: CheckContext, check: WhatWillBreakCheckDefinition): Promise<WhatWillBreakCheckResult> {
  switch (check.family) {
    case 'auth':
      return runAuthCheck(context, check.key);
    case 'connectedApps':
      return checkConnectedAppsToEca(context);
    case 'apiVersions':
      return checkLegacyApiVersions(context);
    case 'releaseUpdates':
      return checkReleaseUpdates(context);
    default:
      throw new SfError(`Unknown check family ${check.family}`);
  }
}

function buildMetrics(checks: WhatWillBreakCheckResult[]): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const check of checks) {
    const metricName = WHAT_WILL_BREAK_CHECKS.find((definition) => definition.key === check.key)?.metricName;
    // A check that could not run on this org sends no metric: an absent metric is "not measured", a 0 is "none found"
    if (metricName && check.metric !== undefined && check.notChecked !== true) {
      metrics[metricName] = check.metric;
    }
  }
  return metrics;
}

function rollupSeverity(checks: WhatWillBreakCheckResult[]): 'error' | 'warning' | 'log' {
  if (checks.some((check) => check.status === 'error')) {
    return 'error';
  }
  if (checks.some((check) => check.status === 'warning')) {
    return 'warning';
  }
  return 'log';
}

// Report of a check that found something: the files the check wrote itself, or its rows
async function writeCheckReport(check: WhatWillBreakCheckResult): Promise<string[]> {
  if (check.reportFiles && check.reportFiles.length > 0) {
    return check.reportFiles;
  }
  if (check.status === 'success' || check.notChecked === true) {
    return [];
  }
  const rows = check.detailReportRows || check.rows.filter((row) => row.Severity !== 'success');
  if (rows.length === 0) {
    return [];
  }
  const reportPath = await generateReportPath(`what-will-break-${check.key}`, '');
  const files = await generateCsvFile(rows, reportPath, { fileTitle: check.detailReportTitle || check.title });
  return [files?.csvFile || reportPath, files?.xlsxFile].filter(Boolean);
}

// Main report rows of a check: its own rows when it has several dates, else one row that says what will break, or that nothing will
function buildCheckMainRows(check: WhatWillBreakCheckResult, isSandbox: boolean): WhatWillBreakDatedMainRow[] {
  if (check.mainRows && check.mainRows.length > 0 && check.notChecked !== true) {
    return check.mainRows;
  }
  const pascalKey = check.key.charAt(0).toUpperCase() + check.key.slice(1);
  const severity = check.notChecked === true ? 'notChecked' : check.status;
  let whatWillBreak: string;
  let whatToDo: string;
  if (severity === 'success') {
    whatWillBreak = t('whatWillBreakNothingWillBreak', { what: t(`whatWillBreakOk${pascalKey}`) });
    whatToDo = t('whatWillBreakNothingToDo');
  } else if (severity === 'notChecked') {
    whatWillBreak = check.detail;
    whatToDo = t('whatWillBreakTodoNotChecked');
  } else if (severity === 'info') {
    whatWillBreak = check.detail;
    whatToDo = t('whatWillBreakTodoInfo');
  } else {
    const items = check.impactItems || [];
    const itemList = items.length > 0 ? ` (${items.slice(0, 5).join(', ')}${items.length > 5 ? ', ...' : ''})` : '';
    whatWillBreak = `${t(`whatWillBreakImpact${pascalKey}`, { count: check.metric ?? '' })}${itemList}`;
    whatToDo = t(`whatWillBreakTodo${pascalKey}`);
  }
  return [
    {
      date: getDeadlineDate(check.key, isSandbox),
      row: buildMainRow(check, severity, {
        whatWillBreak,
        date: check.deadline,
        whatToDo,
        announcementUrl: WHAT_WILL_BREAK_DEADLINES[check.key].articleUrl,
        count: check.metric ?? '',
      }),
    },
  ];
}
