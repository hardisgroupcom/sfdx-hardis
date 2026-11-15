import { t } from '../utils/i18n.js';
import { getReleaseUpdatesSetupUrl, queryReleaseUpdatesToCheck } from '../utils/releaseUpdatesUtils.js';
import { buildMainRow, buildRow, finalizeCheck, notAvailableResult } from './checkResults.js';
import { getDateLabel, getDateSeverity } from './whatWillBreakDeadlines.js';
import { CheckContext, WhatWillBreakCheckKey, WhatWillBreakCheckResult, WhatWillBreakDetailRow } from './whatWillBreakTypes.js';

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
      LastSeen: '',
      Count: '',
      Recommendation: t('whatWillBreakTodoReleaseUpdates'),
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
      whatWillBreak: t('whatWillBreakImpactReleaseUpdate', { title: row.Item }),
      date: row.Deadline,
      whatToDo: t('whatWillBreakTodoReleaseUpdates'),
      announcementUrl: setupUrl,
      count: 1,
    }),
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
