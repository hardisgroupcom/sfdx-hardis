import { DoraAttentionItem, DoraBranchResult } from './doraUtils.js';
import { DoraBranchInput } from './doraMetricsUtils.js';
import { t } from './i18n.js';
import { round1 } from './statsUtils.js';

const DAY_MS = 86400000;
const STALE_PULL_REQUEST_DAYS = 7;
const NO_DEPLOYMENT_DAYS = 30;
const FAILURE_RATE_FLOOR = 10;
const FAILURE_RATE_RISE = 5;

/**
 * What a release manager should look at on a major branch, the most urgent first:
 *
 * - deploymentFailing: the last deployment job failed, the org is behind its branch.
 * - stalePullRequests: Pull Requests open for more than a week (drafts are left out).
 * - failureRateUp: the failure rate is above 10 % and rose by 5 points or more since the period before.
 * - noRecentDeployment: nothing deployed for 30 days on a branch that was deployed before.
 */
export function computeAttentionItems(input: DoraBranchInput, result: DoraBranchResult, now: Date): DoraAttentionItem[] {
  const items: DoraAttentionItem[] = [];
  const finished = input.deploymentRuns
    .filter((run) => run.status !== 'canceled' && !Number.isNaN(Date.parse(run.finishedAt)))
    .sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));
  const last = finished[finished.length - 1];
  const daysSince = (date: string | undefined) => Math.floor((now.getTime() - Date.parse(date || '')) / DAY_MS);

  if (last?.status === 'failed') {
    items.push({
      code: 'deploymentFailing',
      severity: 'error',
      message: t('doraAttentionDeploymentFailing', { date: last.finishedAt.split('T')[0], days: daysSince(last.finishedAt) }),
      url: last.webUrl || null,
    });
  }

  const stale = input.openPullRequests
    .filter((pullRequest) => pullRequest.isDraft !== true && daysSince(pullRequest.createdDate) > STALE_PULL_REQUEST_DAYS)
    .sort((a, b) => Date.parse(a.createdDate || '') - Date.parse(b.createdDate || ''));
  if (stale.length > 0) {
    items.push({
      code: 'stalePullRequests',
      severity: 'warning',
      message: t('doraAttentionStalePullRequests', { count: stale.length, title: stale[0].title, days: daysSince(stale[0].createdDate) }),
      url: stale[0].webUrl || null,
    });
  }

  const failureRate = result.metrics.changeFailureRate;
  if (
    failureRate.percent != null &&
    failureRate.previousPercent != null &&
    failureRate.percent > FAILURE_RATE_FLOOR &&
    failureRate.percent - failureRate.previousPercent >= FAILURE_RATE_RISE
  ) {
    items.push({
      code: 'failureRateUp',
      severity: 'warning',
      message: t('doraAttentionFailureRateUp', { previous: round1(failureRate.previousPercent), current: round1(failureRate.percent) }),
      url: null,
    });
  }

  const lastSucceeded = [...finished].reverse().find((run) => run.status === 'succeeded');
  // A failing branch already says it: the same fact is not listed twice
  if (lastSucceeded && last?.status !== 'failed' && daysSince(lastSucceeded.finishedAt) >= NO_DEPLOYMENT_DAYS) {
    items.push({
      code: 'noRecentDeployment',
      severity: 'info',
      message: t('doraAttentionNoRecentDeployment', { days: daysSince(lastSucceeded.finishedAt) }),
      url: lastSucceeded.webUrl || null,
    });
  }
  return items;
}
