import { t } from '../utils/i18n.js';
import { getReleaseUpdatesSetupUrl, queryReleaseUpdatesToCheck } from '../utils/releaseUpdatesUtils.js';
import { buildMainRow, buildRow, finalizeCheck, notAvailableResult } from './checkResults.js';
import { getReleaseUpdateCatalogEntry, ReleaseUpdateCatalogEntry } from './releaseUpdatesCatalog.js';
import { getDateLabel, getDateSeverity } from './whatWillBreakDeadlines.js';
import {
  CheckContext,
  WhatWillBreakCheckKey,
  WhatWillBreakCheckResult,
  WhatWillBreakDetailRow,
  WhatWillBreakSeverity,
} from './whatWillBreakTypes.js';

// Longest part of the Salesforce description shown for a release update sfdx-hardis does not know
const UNKNOWN_DESCRIPTION_MAX_LENGTH = 400;

// Release updates not applied yet: each one is a row of the main report, with its own due date.
// A release update of the catalog says in plain words what stops working and what to do, and links to its official page.
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
  const entries = records.map((record) => getReleaseUpdateCatalogEntry(record.DeveloperName));
  const rows: WhatWillBreakDetailRow[] = records.map((record, index) => {
    const entry = entries[index];
    const dueDate = String(record.DueDate || '').substring(0, 10);
    const texts = entry ? describeKnownReleaseUpdate(record, entry, dueDate) : describeUnknownReleaseUpdate(record);
    const severity: WhatWillBreakSeverity = entry && !entry.impacting ? 'info' : getReleaseUpdateSeverity(record, context.today);
    const row = buildRow(context, key, title, severity, {
      Item: record.Title,
      Details: `${record.StepStage}, ${record.Status}, ${record.Category}`,
      WhatWillBreak: texts.whatWillBreak,
      LastSeen: '',
      Count: '',
      Recommendation: texts.whatToDo,
    });
    row.Deadline = dueDate ? getDateLabel(dueDate, context.today) : '';
    row.Article = entry?.articleUrl || setupUrl;
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
      announcementUrl: row.Article,
      count: 1,
    }),
    relatedCheckKey: entries[index]?.relatedCheck,
    relatedRowsMatch: entries[index]?.relatedRowsMatch,
  }));
  result.detailReportRows = records;
  result.detailReportTitle = t('whatWillBreakReleaseUpdatesReportTitle');
  return result;
}

function describeKnownReleaseUpdate(
  record: any,
  entry: ReleaseUpdateCatalogEntry,
  dueDate: string
): { whatWillBreak: string; whatToDo: string } {
  const enableStep = entry.impacting
    ? t('whatWillBreakReleaseUpdateThenEnable', { date: dueDate })
    : t('whatWillBreakReleaseUpdateNoRiskEnable', { date: dueDate });
  return {
    whatWillBreak: t('whatWillBreakReleaseUpdateKnownImpact', {
      title: record.Title,
      impact: t(`whatWillBreakRu${entry.developerName}Impact`),
    }),
    whatToDo: `${t(`whatWillBreakRu${entry.developerName}Todo`)}. ${enableStep}`,
  };
}

// A release update sfdx-hardis does not know yet: the description Salesforce gives in the org, in the org language
function describeUnknownReleaseUpdate(record: any): { whatWillBreak: string; whatToDo: string } {
  const description = toPlainText(record.Description);
  return {
    whatWillBreak: description
      ? t('whatWillBreakReleaseUpdateKnownImpact', { title: record.Title, impact: description })
      : t('whatWillBreakImpactReleaseUpdate', { title: record.Title }),
    whatToDo: t('whatWillBreakReleaseUpdateTodo', { title: record.Title }),
  };
}

// Release update descriptions may hold HTML: keep the text, cut after the last full sentence that fits
function toPlainText(value: string | null | undefined): string {
  const text = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= UNKNOWN_DESCRIPTION_MAX_LENGTH) {
    return text;
  }
  const cut = text.substring(0, UNKNOWN_DESCRIPTION_MAX_LENGTH);
  const lastSentenceEnd = cut.lastIndexOf('. ');
  return lastSentenceEnd > 0 ? cut.substring(0, lastSentenceEnd + 1) : `${cut}...`;
}

// An overdue release update is an error, as is one due in less than 60 days
function getReleaseUpdateSeverity(record: any, today: Date): 'error' | 'warning' {
  if (record.StepStage === 'OverDue') {
    return 'error';
  }
  return record.DueDate ? getDateSeverity(String(record.DueDate), today) : 'warning';
}
