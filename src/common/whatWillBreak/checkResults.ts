import { t } from '../utils/i18n.js';
import { getDeadlineLabel, getFixDocUrl, WHAT_WILL_BREAK_DEADLINES } from './whatWillBreakDeadlines.js';
import {
  CheckContext,
  WhatWillBreakCheckKey,
  WhatWillBreakCheckResult,
  WhatWillBreakDetailRow,
  WhatWillBreakMainRow,
  WhatWillBreakSeverity,
} from './whatWillBreakTypes.js';

export const DAY_MS = 86400000;

// Result of a check from its findings: its status is the most severe finding, or success when it found nothing
export function finalizeCheck(
  context: CheckContext,
  key: WhatWillBreakCheckKey,
  title: string,
  rows: WhatWillBreakDetailRow[],
  metric: number,
  foundDetail: string
): WhatWillBreakCheckResult {
  const deadline = getDeadlineLabel(key, context.isSandbox, context.today);
  const order: Record<WhatWillBreakSeverity, number> = { success: 0, info: 1, warning: 2, error: 3 };
  const status = rows.reduce<WhatWillBreakSeverity>(
    (worst, row) => (order[row.Severity] > order[worst] ? row.Severity : worst),
    'success'
  );
  if (rows.length === 0) {
    const detail = t('authRetirementsNothingFound');
    return {
      key,
      status: 'success',
      title,
      detail,
      deadline,
      howToFixUrl: getFixDocUrl(key),
      rows: [successRow(context, key, title, detail)],
      metric,
    };
  }
  // Only information rows: nothing to act on
  const detail = status === 'info' ? t('authRetirementsInfoOnly', { count: rows.length }) : foundDetail;
  return { key, status, title, detail, deadline, howToFixUrl: getFixDocUrl(key), rows, metric };
}

// Result of a check that could not run on this org (missing object or permission): it never reads as "nothing found"
export function notAvailableResult(
  context: CheckContext,
  key: WhatWillBreakCheckKey,
  title: string,
  reason: string
): WhatWillBreakCheckResult {
  const detail = t('authRetirementsCheckNotAvailable', { reason });
  const row = buildRow(context, key, title, 'info', {
    Item: '-',
    Details: detail,
    LastSeen: '',
    Count: '',
    Recommendation: '',
  });
  return {
    key,
    status: 'info',
    title,
    detail,
    deadline: row.Deadline,
    howToFixUrl: row.HowToFix,
    rows: [row],
    notChecked: true,
  };
}

export function successRow(context: CheckContext, key: WhatWillBreakCheckKey, title: string, detail: string): WhatWillBreakDetailRow {
  return buildRow(context, key, title, 'success', {
    Item: '-',
    Details: detail,
    LastSeen: '',
    Count: 0,
    Recommendation: '',
  });
}

export function buildRow(
  context: CheckContext,
  key: WhatWillBreakCheckKey,
  title: string,
  severity: WhatWillBreakSeverity,
  values: Pick<WhatWillBreakDetailRow, 'Item' | 'Details' | 'LastSeen' | 'Count' | 'Recommendation'> & { WhatWillBreak?: string }
): WhatWillBreakDetailRow {
  // Explicit order: it is the column order of the detail report
  return {
    Check: title,
    CheckKey: key,
    Severity: severity,
    Deadline: getDeadlineLabel(key, context.isSandbox, context.today),
    Item: values.Item,
    Details: values.Details,
    WhatWillBreak: values.WhatWillBreak || '',
    LastSeen: values.LastSeen,
    Count: values.Count,
    Recommendation: values.Recommendation,
    HowToFix: getFixDocUrl(key),
    Article: WHAT_WILL_BREAK_DEADLINES[key].articleUrl,
  };
}

// Status column of the main report: an icon and a word, so a reader without colors still sees it
export function getStatusLabel(severity: WhatWillBreakSeverity | 'notChecked'): string {
  const labels: Record<WhatWillBreakSeverity | 'notChecked', string> = {
    error: `❌ ${t('whatWillBreakStatusError')}`,
    warning: `⚠️ ${t('whatWillBreakStatusWarning')}`,
    info: `ℹ️ ${t('whatWillBreakStatusInfo')}`,
    notChecked: `⏸️ ${t('whatWillBreakStatusNotChecked')}`,
    success: `✅ ${t('whatWillBreakStatusOk')}`,
  };
  return labels[severity];
}

// A main report row with the values of the check filled in: the check sets what will break, when, and what to do
export function buildMainRow(
  check: Pick<WhatWillBreakCheckResult, 'key' | 'title' | 'howToFixUrl'>,
  severity: WhatWillBreakSeverity | 'notChecked',
  values: { whatWillBreak: string; date: string; whatToDo: string; announcementUrl: string; count: number | string }
): WhatWillBreakMainRow {
  return {
    Status: getStatusLabel(severity),
    Check: check.title,
    'What will break': values.whatWillBreak,
    Date: values.date,
    'What to do': values.whatToDo,
    'Salesforce announcement': values.announcementUrl,
    'How to fix': check.howToFixUrl,
    Count: values.count,
    'Detail report': '',
    CheckKey: check.key,
    Severity: severity,
  };
}

export function formatDate(value: string): string {
  return value ? new Date(value).toISOString().split('T')[0] : '';
}
