import path from 'path';
import { t } from '../utils/i18n.js';
import { LegacyApiCallsCollector, LegacyApiDescriptor } from '../utils/legacyApiUtils.js';
import { buildMainRow, buildRow, finalizeCheck, notAvailableResult, successRow } from './checkResults.js';
import { getDeadlineDate, getDeadlineLabel, getDeadlineSeverity, WHAT_WILL_BREAK_DEADLINES } from './whatWillBreakDeadlines.js';
import {
  CheckContext,
  WhatWillBreakCheckKey,
  WhatWillBreakCheckResult,
  WhatWillBreakDeadlineKey,
  WhatWillBreakDetailRow,
} from './whatWillBreakTypes.js';

// Same event log analysis as hardis:org:diagnose:legacyapi: one main report row per range of API versions called.
// SOAP login() calls stay in the detail report only: the soapLoginRetirement check covers them, from LoginHistory.
export async function checkLegacyApiVersions(context: CheckContext): Promise<WhatWillBreakCheckResult> {
  const key: WhatWillBreakCheckKey = 'legacyApiVersions';
  const title = t('whatWillBreakCheckLegacyApiVersions');
  let collected;
  try {
    collected = await new LegacyApiCallsCollector({
      conn: context.conn,
      eventType: 'ApiTotalUsage',
      limit: 999,
      outputFile: null,
      debugMode: context.debugMode === true,
      commandThis: context.commandThis || null,
      partOfAnotherCommand: true,
    }).collect();
  } catch (e) {
    return notAvailableResult(context, key, title, (e as Error).message);
  }
  const rows: WhatWillBreakDetailRow[] = [];
  const mainRows: { date: string; row: ReturnType<typeof buildMainRow> }[] = [];
  for (const found of collected.descriptors) {
    if (found.totalErrors === 0 || isSoapLoginDescriptor(found.descriptor)) {
      continue;
    }
    const deadlineKey = getVersionsDeadlineKey(found.descriptor);
    const severity = getDeadlineSeverity(deadlineKey, context.isSandbox, context.today);
    const deadline = getDeadlineLabel(deadlineKey, context.isSandbox, context.today);
    const versions = `${found.descriptor.minApiVersion} - ${found.descriptor.maxApiVersion}`;
    // The API clients file of this range lists the IP addresses and the users to go and fix
    const clientsFile = collected.apiClientsFiles.find(
      (file) => file.minApiVersion === found.descriptor.minApiVersion && file.maxApiVersion === found.descriptor.maxApiVersion
    );
    const whatToDo = t('whatWillBreakLegacyApiTodo', {
      clientsFile: clientsFile ? path.basename(clientsFile.xlsxFile || clientsFile.csvFile) : path.basename(collected.csvFile || ''),
      ips: found.ipCount,
      min: found.descriptor.minApiVersion,
      max: found.descriptor.maxApiVersion,
      latest: context.conn.getApiVersion(),
    });
    const whatWillBreak = t('whatWillBreakImpactLegacyApiVersions', { count: found.totalErrors, versions, ips: found.ipCount });
    const row = buildRow(context, key, title, severity, {
      Item: versions,
      Details: t('whatWillBreakDetailLegacyApi', { count: found.totalErrors, ips: found.ipCount }),
      WhatWillBreak: whatWillBreak,
      LastSeen: '',
      Count: found.totalErrors,
      Recommendation: whatToDo,
    });
    row.Deadline = deadline;
    row.Article = WHAT_WILL_BREAK_DEADLINES[deadlineKey].articleUrl;
    rows.push(row);
    mainRows.push({
      date: getDeadlineDate(deadlineKey, context.isSandbox),
      row: buildMainRow({ key, title, howToFixUrl: row.HowToFix }, severity, {
        whatWillBreak,
        date: deadline,
        whatToDo,
        announcementUrl: row.Article,
        count: found.totalErrors,
      }),
    });
  }
  // The metric keeps the meaning it had with hardis:org:diagnose:legacyapi (SOAP login() calls included), so the history continues
  const result = finalizeCheck(context, key, title, rows, collected.totalErrors, t('whatWillBreakFoundLegacyApi', { count: rows.length }));
  if (collected.eventLogFilesInOrg === 0) {
    result.detail = t('whatWillBreakNoApiEventLog');
    result.rows = [successRow(context, key, title, result.detail)];
    return result;
  }
  if (rows.length > 0) {
    result.mainRows = mainRows;
    result.reportFiles = [
      collected.csvFile,
      collected.xlsxFile,
      ...collected.apiClientsFiles.flatMap((file) => [file.csvFile, file.xlsxFile]),
    ].filter((file): file is string => !!file);
  }
  return result;
}

function isSoapLoginDescriptor(descriptor: LegacyApiDescriptor): boolean {
  return (descriptor.apiResources || []).includes('login');
}

// API versions 30.0 and older are retired, 31.0 to 40.0 are retired in Summer '28
function getVersionsDeadlineKey(descriptor: LegacyApiDescriptor): WhatWillBreakDeadlineKey {
  return descriptor.maxApiVersion <= 30 ? 'legacyApiRetired' : 'legacyApiVersions';
}
