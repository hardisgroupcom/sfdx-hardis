import { t } from '../utils/i18n.js';
import { getConnectedAppsUsage } from '../utils/connectedAppsUsageUtils.js';
import { buildRow, finalizeCheck, notAvailableResult } from './checkResults.js';
import { getDeadlineSeverity } from './whatWillBreakDeadlines.js';
import { CheckContext, WhatWillBreakCheckKey, WhatWillBreakCheckResult } from './whatWillBreakTypes.js';

// Connected Apps the org owns and still uses: they must become External Client Apps before Salesforce stops supporting them.
// Same rule as the "Move to External Client App" column of hardis:org:diagnose:unsecure-connected-apps.
export async function checkConnectedAppsToEca(context: CheckContext): Promise<WhatWillBreakCheckResult> {
  const key: WhatWillBreakCheckKey = 'connectedAppsToEca';
  const title = t('whatWillBreakCheckConnectedAppsToEca');
  let usage: Awaited<ReturnType<typeof getConnectedAppsUsage>>;
  try {
    usage = await getConnectedAppsUsage(context.conn);
  } catch (e) {
    return notAvailableResult(context, key, title, (e as Error).message);
  }
  const severity = getDeadlineSeverity(key, context.isSandbox, context.today);
  const toMove = usage.filter((app) => app['Move to External Client App'] === 'Required');
  const rows = toMove.map((app) =>
    buildRow(context, key, title, severity, {
      Item: app['Connected App'],
      Details: t('whatWillBreakDetailConnectedAppToMove', { lastUsed: app['Last Used Date'] }),
      LastSeen: app['Last Used Date'],
      Count: '',
      Recommendation: t('whatWillBreakTodoConnectedAppsToEca'),
    })
  );
  const result = finalizeCheck(context, key, title, rows, rows.length, t('whatWillBreakFoundConnectedApps', { count: rows.length }));
  if (rows.length > 0) {
    result.impactItems = toMove.map((app) => app['Connected App']);
    // The whole usage list: the apps of vendors and the unused ones tell what else to clean up
    result.detailReportRows = usage;
    result.detailReportTitle = t('connectedAppsUsageFiletitle');
  }
  return result;
}
