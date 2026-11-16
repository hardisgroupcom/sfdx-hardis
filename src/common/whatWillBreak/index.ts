import path from 'path';
import { SfError } from '@salesforce/core';
import { soqlQuery } from '../utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../utils/filesUtils.js';
import { t } from '../utils/i18n.js';
import { getMonitoringDisable } from '../notifProvider/utils/notificationConfig.js';
import { markRowSensitiveValues, SENSITIVE_VALUES_KEY } from '../utils/anonymizeUtils.js';
import { WebSocketClient } from '../websocketClient.js';
import { loadLoginHistory, needsLoginHistory, runAuthCheck } from './authChecks.js';
import { buildMainRow, notAvailableResult } from './checkResults.js';
import { checkConnectedAppsToEca } from './connectedAppsCheck.js';
import { checkLegacyApiVersions } from './legacyApiCheck.js';
import { checkReleaseUpdates } from './releaseUpdatesCheck.js';
import { getDeadlineDate, WHAT_WILL_BREAK_DEADLINES } from './whatWillBreakDeadlines.js';
import {
  CheckContext,
  WhatWillBreakCheckKey,
  WhatWillBreakCheckResult,
  WhatWillBreakDatedMainRow,
  WhatWillBreakDetailRow,
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

// Findings of a check listed one by one in the main report: the others are counted in a last row that points to the detail report
export const WHAT_WILL_BREAK_MAX_MAIN_ROWS_PER_CHECK = 20;

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
    await withProgress(t('whatWillBreakReadingLoginHistory', { days: context.lookbackDays }), async () => {
      try {
        await loadLoginHistory(context);
      } catch {
        // The login based checks then report "Not checked", with the reason
        context.logins = { failed: true, records: [], usernameById: new Map(), activeUserIds: new Set() };
      }
    });
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
  linkReleaseUpdatesToChecks(checks);
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
    for (const datedRow of buildCheckMainRows(check, result.isSandbox, reportName)) {
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

// A check that fails (query timeout, missing access...) is reported as not checked, and the other checks still report
async function runCheck(context: CheckContext, check: WhatWillBreakCheckDefinition): Promise<WhatWillBreakCheckResult> {
  try {
    return await runCheckOfFamily(context, check);
  } catch (e) {
    return notAvailableResult(context, check.key, getWhatWillBreakCheckTitle(check.key), (e as Error).message);
  }
}

async function runCheckOfFamily(context: CheckContext, check: WhatWillBreakCheckDefinition): Promise<WhatWillBreakCheckResult> {
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

// A release update that enforces a change an authentication check looks at says what that check found in this org
function linkReleaseUpdatesToChecks(checks: WhatWillBreakCheckResult[]): void {
  const releaseUpdates = checks.find((check) => check.key === 'releaseUpdates');
  for (const datedRow of releaseUpdates?.mainRows || []) {
    const related = checks.find((check) => check.key === datedRow.relatedCheckKey);
    if (!related || related.notChecked === true) {
      continue;
    }
    const checkTitle = getWhatWillBreakCheckTitle(related.key);
    const link =
      related.status === 'success'
        ? t('whatWillBreakReleaseUpdateCheckedOk', { check: checkTitle })
        : t('whatWillBreakReleaseUpdateCheckedHere', { check: checkTitle });
    datedRow.row['What to do'] = `${datedRow.row['What to do']}. ${link}`;
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

// Main report rows of a check: the rows the check built itself (one per release update...), else one row per finding,
// each saying what breaks for that item and what to do about it, or one row that says nothing will break / the check did not run
function buildCheckMainRows(check: WhatWillBreakCheckResult, isSandbox: boolean, reportName: string): WhatWillBreakDatedMainRow[] {
  if (check.mainRows && check.mainRows.length > 0 && check.notChecked !== true) {
    return check.mainRows;
  }
  const announcementUrl = WHAT_WILL_BREAK_DEADLINES[check.key].articleUrl;
  const checkDate = getDeadlineDate(check.key, isSandbox);
  if (check.notChecked === true || check.status === 'success') {
    const pascalKey = check.key.charAt(0).toUpperCase() + check.key.slice(1);
    const isSuccess = check.notChecked !== true;
    return [
      {
        date: checkDate,
        row: buildMainRow(check, isSuccess ? 'success' : 'notChecked', {
          whatWillBreak: isSuccess ? t('whatWillBreakNothingWillBreak', { what: t(`whatWillBreakOk${pascalKey}`) }) : check.detail,
          date: check.deadline,
          whatToDo: isSuccess ? t('whatWillBreakNothingToDo') : t('whatWillBreakTodoNotChecked'),
          announcementUrl,
          count: check.metric ?? '',
        }),
      },
    ];
  }
  const order: Record<string, number> = { error: 0, warning: 1, info: 2, success: 3 };
  const findings = check.rows.filter((row) => row.Severity !== 'success').sort((a, b) => order[a.Severity] - order[b.Severity]);
  const datedRows: WhatWillBreakDatedMainRow[] = findings.slice(0, WHAT_WILL_BREAK_MAX_MAIN_ROWS_PER_CHECK).map((finding) => ({
    date: getFindingDate(finding) || checkDate,
    row: copySensitiveMarkers(
      finding,
      buildMainRow(check, finding.Severity, {
        whatWillBreak: finding.WhatWillBreak || finding.Details,
        date: finding.Deadline,
        whatToDo: finding.Recommendation || t('whatWillBreakNothingToDo'),
        announcementUrl: finding.Article,
        count: finding.Count,
      })
    ),
  }));
  const others = findings.slice(WHAT_WILL_BREAK_MAX_MAIN_ROWS_PER_CHECK);
  if (others.length > 0) {
    datedRows.push({
      date: checkDate,
      row: buildMainRow(check, others[0].Severity, {
        whatWillBreak: t('whatWillBreakMoreFindings', { count: others.length }),
        date: check.deadline,
        whatToDo: t('whatWillBreakMoreFindingsTodo', { file: reportName }),
        announcementUrl,
        count: others.length,
      }),
    });
  }
  return datedRows;
}

// Date of a finding (YYYY-MM-DD), read from its deadline label: a token has its own expiry date, a release its month
function getFindingDate(finding: WhatWillBreakDetailRow): string {
  const match = /(\d{4}-\d{2})(-\d{2})?/.exec(finding.Deadline || '');
  if (!match) {
    return '';
  }
  return match[2] ? match[0] : `${match[1]}-01`;
}

// The usernames and IP addresses of a finding are also in its main report row texts: the anonymization must find them there too
function copySensitiveMarkers(finding: WhatWillBreakDetailRow, row: WhatWillBreakMainRow): WhatWillBreakMainRow {
  const markers = (finding as any)[SENSITIVE_VALUES_KEY];
  return Array.isArray(markers) ? markRowSensitiveValues(row, markers) : row;
}
