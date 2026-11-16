import { t } from '../utils/i18n.js';
import { getReleaseUpdatesSetupUrl, queryReleaseUpdatesToCheck } from '../utils/releaseUpdatesUtils.js';
import { buildMainRow, buildRow, finalizeCheck, notAvailableResult } from './checkResults.js';
import { getDateLabel, getDateSeverity } from './whatWillBreakDeadlines.js';
import { CheckContext, WhatWillBreakCheckKey, WhatWillBreakCheckResult, WhatWillBreakDetailRow } from './whatWillBreakTypes.js';

// Release updates that enforce the change another check of the report looks at, by DeveloperName:
// they are merged into the rows of that check instead of having their own row
const RELEASE_UPDATE_RELATED_CHECKS: Record<string, WhatWillBreakCheckKey> = {
  SoapLoginUserPermEnforcementReleaseUpdate: 'soapLoginPermission',
  OAuthDeviceFlowRestrictionReleaseUpdate: 'deviceFlow',
  OAuthUsrPassFlowEOLReleaseUpdate: 'usernamePasswordFlow',
  OAuthUsrAgtFlowsEOLReleaseUpdate: 'usernamePasswordFlow',
  SoapLoginRetirementNoTestFeatureReleaseUpdate: 'soapLoginRetirement',
  ConnectedAppHardBlockEOLReleaseUpdate: 'connectedAppsToEca',
  ApiVersions31to40Retirement: 'legacyApiVersions',
};

// Release updates not applied yet: each one is a row of the main report, with its own due date
export async function checkReleaseUpdates(context: CheckContext): Promise<WhatWillBreakCheckResult> {
  const key: WhatWillBreakCheckKey = 'releaseUpdates';
  const title = t('whatWillBreakCheckReleaseUpdates');
  let records: any[];
  try {
    records = await queryReleaseUpdatesToCheck(context.conn);
  } catch (e) {
    return notAvailableResult(context, key, title, (e as Error).message);
  }
  const setupUrl = getReleaseUpdatesSetupUrl(context.conn.instanceUrl);
  const rows: WhatWillBreakDetailRow[] = records.map((record) => {
    const dueDate = String(record.DueDate || '').substring(0, 10);
    const row = buildRow(context, key, title, getReleaseUpdateSeverity(record, context.today), {
      Item: record.Title,
      Details: `${record.StepStage}, ${record.Status}, ${record.Category}`,
      WhatWillBreak: t('whatWillBreakImpactReleaseUpdate', { title: record.Title }),
      LastSeen: '',
      Count: '',
      Recommendation: t('whatWillBreakReleaseUpdateTodo', { title: record.Title }),
    });
    row.Deadline = dueDate ? getDateLabel(dueDate, context.today) : '';
    row.Article = setupUrl;
    return row;
  });
  const result = finalizeCheck(context, key, title, rows, records.length, t('whatWillBreakFoundReleaseUpdates', { count: records.length }));
  if (records.length === 0) {
    return result;
  }
  result.mainRows = rows.map((row, index) => ({
    date: String(records[index].DueDate || '').substring(0, 10),
    row: buildMainRow(result, row.Severity, {
      whatWillBreak: row.WhatWillBreak,
      date: row.Deadline,
      whatToDo: row.Recommendation,
      announcementUrl: setupUrl,
      count: 1,
    }),
    relatedCheckKey: RELEASE_UPDATE_RELATED_CHECKS[records[index].DeveloperName],
  }));
  result.detailReportRows = records;
  result.detailReportTitle = t('whatWillBreakReleaseUpdatesReportTitle');
  return result;
}

// An overdue release update is an error, as is one due in less than 60 days
function getReleaseUpdateSeverity(record: any, today: Date): 'error' | 'warning' {
  if (record.StepStage === 'OverDue') {
    return 'error';
  }
  return record.DueDate ? getDateSeverity(String(record.DueDate), today) : 'warning';
}
