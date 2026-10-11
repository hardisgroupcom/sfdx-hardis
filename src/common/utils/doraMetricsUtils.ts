import { CommonPullRequestInfo } from '../gitProvider/index.js';
import { CommonCiRun } from '../gitProvider/gitProviderRoot.js';
import {
  DoraBranchMetrics,
  DoraBranchResult,
  DoraContributor,
  DoraDistribution,
  DoraFailedDeployment,
  DoraPullRequestRef,
  DoraWeek,
  buildWeekLabels,
  classifyChangeFailureRate,
  classifyDeploymentFrequency,
  classifyLeadTime,
  classifyMttr,
  classifyReworkRate,
  weekKey,
} from './doraUtils.js';
import { median, percentile, round1 } from './statsUtils.js';

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
// A deployment job is the one of a merge when it starts within this delay after it
const MAX_MERGE_TO_DEPLOYMENT_MS = 14 * DAY_MS;
const SLOW_PULL_REQUEST_DAYS = 7;
const QUICK_FIX_MS = 24 * HOUR_MS;
const HOTFIX_BRANCH_PATTERN = /^(hotfix|fix|bugfix)[/-]/i;

// Everything the git provider returned about one major branch, over the period and the one before
// it when a comparison is asked for
export interface DoraBranchInput {
  name: string;
  level: number;
  isProduction: boolean;
  deploymentRuns: CommonCiRun[];
  validationRuns: CommonCiRun[];
  mergedPullRequests: CommonPullRequestInfo[];
  openPullRequests: CommonPullRequestInfo[];
}

export interface DoraPeriod {
  from: Date;
  to: Date;
  // Start of the period of the same length just before, null when no comparison is asked for
  previousFrom: Date | null;
}

/**
 * DORA metrics of one major branch, from its deployment jobs and its Pull Requests.
 *
 * - A deployment counts in the period its job finished in, a Pull Request in the one it was merged in.
 * - Canceled jobs are counted apart: they are in no rate.
 * - The attention list is left empty: computeAttentionItems fills it.
 */
export function computeBranchResult(input: DoraBranchInput, period: DoraPeriod): DoraBranchResult {
  const current = computeWindow(input, period.from, period.to);
  const previous = period.previousFrom ? computeWindow(input, period.previousFrom, period.from) : null;
  const metrics: DoraBranchMetrics = {
    deploymentFrequency: {
      perDay: round2(current.perDay),
      perWeek: round1(current.perDay * 7),
      level: classifyDeploymentFrequency(current.deployments === 0 ? null : current.perDay).level,
      previousPerWeek: previous && previous.deployments > 0 ? round1(previous.perDay * 7) : null,
    },
    leadTime: {
      medianDays: current.leadTime.median,
      p90Days: current.leadTime.p90,
      avgDays: current.leadTime.avg,
      level: classifyLeadTime(current.leadTime.median).level,
      previousMedianDays: previous ? previous.leadTime.median : null,
    },
    changeFailureRate: {
      percent: current.failureRate,
      level: classifyChangeFailureRate(current.failureRate).level,
      previousPercent: previous ? previous.failureRate : null,
    },
    mttr: {
      medianHours: current.recovery.median,
      avgHours: current.recovery.avg,
      recoveries: current.recoveries,
      level: classifyMttr(current.recovery.median).level,
      previousMedianHours: previous ? previous.recovery.median : null,
    },
    reworkRate: {
      percent: current.reworkRate,
      level: classifyReworkRate(current.reworkRate).level,
      previousPercent: previous ? previous.reworkRate : null,
    },
  };
  const oldestRun = sortByDate(input.deploymentRuns, (run) => run.finishedAt)[0];
  return {
    name: input.name,
    level: input.level,
    isProduction: input.isProduction,
    oldestRunDate: oldestRun ? oldestRun.finishedAt : null,
    metrics,
    supplementary: {
      deploymentDuration: current.duration,
      queueTime: current.queueTime,
      prCycleTime: current.cycleTime,
      changeVolume: { prsPerWeek: round1((current.pullRequests / current.days) * 7), deploymentsPerWeek: round1(current.perDay * 7) },
      validationSuccessRate: current.validationSuccessRate,
    },
    counts: {
      deployments: current.deployments,
      succeeded: current.succeeded,
      failed: current.failed,
      canceled: current.canceled,
      validations: current.validations,
      pullRequests: current.pullRequests,
      openPullRequests: input.openPullRequests.length,
    },
    weeks: current.weeks,
    failedDeployments: current.failedDeployments,
    slowPullRequests: current.slowPullRequests,
    hotfixPullRequests: current.hotfixPullRequests,
    attention: [],
  };
}

/** People behind the Pull Requests and the deployment jobs of the period, the most active first */
export function computeContributors(inputs: DoraBranchInput[], period: DoraPeriod): DoraContributor[] {
  const byName = new Map<string, { pullRequests: Set<string>; cycleDays: number[]; deploymentsTriggered: number; failedDeployments: number }>();
  const entryOf = (name: string) => {
    const key = name || 'Unknown';
    if (!byName.has(key)) {
      byName.set(key, { pullRequests: new Set(), cycleDays: [], deploymentsTriggered: 0, failedDeployments: 0 });
    }
    return byName.get(key)!;
  };
  for (const input of inputs) {
    for (const pullRequest of input.mergedPullRequests) {
      if (!isWithin(pullRequest.mergedDate, period.from, period.to)) {
        continue;
      }
      const entry = entryOf(pullRequest.authorName);
      const id = pullRequestId(pullRequest);
      // A Pull Request targets one branch: the set only guards against a provider listing it twice
      if (!entry.pullRequests.has(id)) {
        entry.pullRequests.add(id);
        const cycle = daysBetweenIso(pullRequest.createdDate, pullRequest.mergedDate);
        if (cycle != null) {
          entry.cycleDays.push(cycle);
        }
      }
    }
    for (const run of input.deploymentRuns) {
      if (run.status === 'canceled' || !isWithin(run.finishedAt, period.from, period.to)) {
        continue;
      }
      const entry = entryOf(run.triggeredBy);
      entry.deploymentsTriggered++;
      if (run.status === 'failed') {
        entry.failedDeployments++;
      }
    }
  }
  return [...byName.entries()]
    .map(([name, entry]) => ({
      name,
      pullRequests: entry.pullRequests.size,
      avgCycleDays: entry.cycleDays.length > 0 ? round1(average(entry.cycleDays)) : null,
      deploymentsTriggered: entry.deploymentsTriggered,
      failedDeployments: entry.failedDeployments,
    }))
    .sort((a, b) => b.pullRequests + b.deploymentsTriggered - (a.pullRequests + a.deploymentsTriggered) || a.name.localeCompare(b.name));
}

// Numbers of one branch over one window of time
function computeWindow(input: DoraBranchInput, from: Date, to: Date) {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  // Every finished job in order, the ones before the window included: a recovery or a merge is
  // looked for across the limits of the window
  const allRuns = sortByDate(input.deploymentRuns, (run) => run.finishedAt);
  const allFinished = allRuns.filter((run) => run.status !== 'canceled');
  const runs = allRuns.filter((run) => isWithin(run.finishedAt, from, to));
  const succeeded = runs.filter((run) => run.status === 'succeeded');
  const failed = runs.filter((run) => run.status === 'failed');
  const canceled = runs.filter((run) => run.status === 'canceled');
  const deployments = succeeded.length + failed.length;
  const pullRequests = input.mergedPullRequests.filter((pullRequest) => isWithin(pullRequest.mergedDate, from, to));
  const validations = input.validationRuns.filter((run) => run.status !== 'canceled' && isWithin(run.finishedAt, from, to));
  const validationsFailed = validations.filter((run) => run.status === 'failed');
  const allSucceeded = allFinished.filter((run) => run.status === 'succeeded');

  // Lead time: Pull Request created, until the job that deployed its merge succeeded
  const leadTimes = pullRequests
    .map((pullRequest) => ({ pullRequest, days: leadTimeDays(pullRequest, allSucceeded) }))
    .filter((entry): entry is { pullRequest: CommonPullRequestInfo; days: number } => entry.days != null);

  // Recovery: a failed job, until the next one that succeeded on the branch
  const failedDeployments: DoraFailedDeployment[] = failed.map((run) => {
    const recovery = allSucceeded.find((candidate) => time(candidate.finishedAt) > time(run.finishedAt));
    const merged = input.mergedPullRequests.find((pullRequest) => isSameCommit(pullRequest.mergeCommitSha, run.commitSha));
    return {
      date: run.finishedAt,
      runName: run.name,
      runUrl: run.webUrl,
      triggeredBy: run.triggeredBy,
      pullRequest: merged ? pullRequestRef(merged) : null,
      recoveryHours: recovery ? round1((time(recovery.finishedAt) - time(run.finishedAt)) / HOUR_MS) : null,
    };
  });
  const recoveryHours = failedDeployments.map((failure) => failure.recoveryHours).filter((hours): hours is number => hours != null && hours > 0);

  // Rework: Pull Requests coming from a fix branch, or deployments redone within a day of a failure
  const hotfixPullRequests = pullRequests.filter((pullRequest) => HOTFIX_BRANCH_PATTERN.test(pullRequest.sourceBranch || ''));
  const finishedRuns = runs.filter((run) => run.status !== 'canceled');
  let quickFixes = 0;
  for (let i = 1; i < finishedRuns.length; i++) {
    const gap = time(finishedRuns[i].finishedAt) - time(finishedRuns[i - 1].finishedAt);
    if (finishedRuns[i].status === 'succeeded' && finishedRuns[i - 1].status === 'failed' && gap > 0 && gap <= QUICK_FIX_MS) {
      quickFixes++;
    }
  }

  const cycleDays = pullRequests
    .map((pullRequest) => ({ pullRequest, days: daysBetweenIso(pullRequest.createdDate, pullRequest.mergedDate) }))
    .filter((entry): entry is { pullRequest: CommonPullRequestInfo; days: number } => entry.days != null);

  return {
    days,
    perDay: succeeded.length / days,
    deployments,
    succeeded: succeeded.length,
    failed: failed.length,
    canceled: canceled.length,
    pullRequests: pullRequests.length,
    validations: validations.length,
    validationSuccessRate: validations.length > 0 ? round1(((validations.length - validationsFailed.length) / validations.length) * 100) : null,
    failureRate: deployments > 0 ? round1((failed.length / deployments) * 100) : null,
    reworkRate: deployments > 0 ? round1((Math.max(hotfixPullRequests.length, quickFixes) / deployments) * 100) : null,
    leadTime: distribution(leadTimes.map((entry) => entry.days)),
    recovery: distribution(recoveryHours),
    recoveries: recoveryHours.length,
    duration: distribution(succeeded.map((run) => minutesBetweenIso(run.startedAt, run.finishedAt)).filter(isPositive)),
    queueTime: distribution(finishedRuns.map((run) => minutesBetweenIso(run.queuedAt, run.startedAt)).filter(isPositiveOrZero)),
    cycleTime: distribution(cycleDays.map((entry) => entry.days)),
    weeks: buildWeeks(days, to, runs, validations, leadTimes),
    // The newest first, like a log
    failedDeployments: failedDeployments.reverse(),
    slowPullRequests: cycleDays
      .filter((entry) => entry.days > SLOW_PULL_REQUEST_DAYS)
      .sort((a, b) => b.days - a.days)
      .map((entry) => ({ ...pullRequestRef(entry.pullRequest), cycleDays: round1(entry.days) })),
    hotfixPullRequests: hotfixPullRequests.map((pullRequest) => ({
      ...pullRequestRef(pullRequest),
      sourceBranch: pullRequest.sourceBranch,
      mergedDate: pullRequest.mergedDate || '',
    })),
  };
}

// Days from the creation of a Pull Request to the end of the job that deployed it. The job is the
// one of its merge commit when the provider tells it, else the first that started after the merge.
// Without any, the merge date ends the lead time: the change is in the branch, its deployment is not known
function leadTimeDays(pullRequest: CommonPullRequestInfo, succeededRuns: CommonCiRun[]): number | null {
  const created = time(pullRequest.createdDate);
  const merged = time(pullRequest.mergedDate);
  if (Number.isNaN(created) || Number.isNaN(merged)) {
    return null;
  }
  const ofMergeCommit = succeededRuns.find((run) => isSameCommit(pullRequest.mergeCommitSha, run.commitSha));
  const deployment =
    ofMergeCommit ||
    succeededRuns.find((run) => {
      const gap = time(run.queuedAt) - merged;
      return gap >= 0 && gap <= MAX_MERGE_TO_DEPLOYMENT_MS;
    });
  const end = deployment ? time(deployment.finishedAt) : merged;
  return end >= created ? (end - created) / DAY_MS : null;
}

function buildWeeks(
  days: number,
  to: Date,
  runs: CommonCiRun[],
  validations: CommonCiRun[],
  leadTimes: { pullRequest: CommonPullRequestInfo; days: number }[],
): DoraWeek[] {
  const weeks = new Map<string, DoraWeek & { leadTimes: number[] }>();
  for (const week of buildWeekLabels(days, to)) {
    weeks.set(week, { week, succeeded: 0, failed: 0, canceled: 0, validations: 0, validationsFailed: 0, leadTimeMedianDays: null, leadTimes: [] });
  }
  const weekOf = (date: string | undefined) => weeks.get(weekKey(new Date(time(date))));
  for (const run of runs) {
    const week = weekOf(run.finishedAt);
    if (week) {
      week[run.status]++;
    }
  }
  for (const run of validations) {
    const week = weekOf(run.finishedAt);
    if (week) {
      week.validations++;
      week.validationsFailed += run.status === 'failed' ? 1 : 0;
    }
  }
  for (const entry of leadTimes) {
    weekOf(entry.pullRequest.mergedDate)?.leadTimes.push(entry.days);
  }
  return [...weeks.values()].map(({ leadTimes: weekLeadTimes, ...week }) => ({
    ...week,
    leadTimeMedianDays: weekLeadTimes.length > 0 ? round1(median(weekLeadTimes)) : null,
  }));
}

function distribution(values: number[]): DoraDistribution {
  if (values.length === 0) {
    return { median: null, p90: null, avg: null };
  }
  return { median: round1(median(values)), p90: round1(percentile(values, 90)), avg: round1(average(values)) };
}

// Bitbucket names the merge commit of a Pull Request by the first 12 characters of its hash
function isSameCommit(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || Math.min(a.length, b.length) < 7) {
    return false;
  }
  return a.startsWith(b) || b.startsWith(a);
}

function pullRequestRef(pullRequest: CommonPullRequestInfo): DoraPullRequestRef {
  return { id: pullRequestId(pullRequest), title: pullRequest.title || '', url: pullRequest.webUrl || '', author: pullRequest.authorName || '' };
}

function pullRequestId(pullRequest: CommonPullRequestInfo): string {
  return pullRequest.idStr || String(pullRequest.idNumber);
}

function sortByDate<T>(items: T[], getDate: (item: T) => string): T[] {
  return items.filter((item) => !Number.isNaN(time(getDate(item)))).sort((a, b) => time(getDate(a)) - time(getDate(b)));
}

// from included, to excluded: a job is in one window only
function isWithin(date: string | undefined, from: Date, to: Date): boolean {
  const value = time(date);
  return value >= from.getTime() && value < to.getTime();
}

function daysBetweenIso(start: string | undefined, end: string | undefined): number | null {
  const value = (time(end) - time(start)) / DAY_MS;
  return Number.isNaN(value) || value < 0 ? null : value;
}

function minutesBetweenIso(start: string, end: string): number {
  return (time(end) - time(start)) / 60000;
}

function time(date: string | undefined): number {
  return Date.parse(date || '');
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isPositiveOrZero(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
