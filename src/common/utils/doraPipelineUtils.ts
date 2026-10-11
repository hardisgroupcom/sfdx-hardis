import { CommonPullRequestInfo } from '../gitProvider/index.js';
import { CommonCiRun } from '../gitProvider/gitProviderRoot.js';
import {
  DoraChangeLeadTime,
  DoraDistribution,
  DoraPipelineChange,
  DoraPipelineResult,
  DoraPipelineStage,
  DoraPipelineStep,
  DoraPullRequestRef,
  buildWeekLabels,
  classifyLeadTime,
  weekKey,
} from './doraUtils.js';
import { DoraBranchInput, DoraPeriod, findDeploymentOfMerge } from './doraMetricsUtils.js';
import { parsePromotionBranchName, parsePromotionPullRequestIds } from './promotionBranchUtils.js';
import { median, percentile, round1 } from './statsUtils.js';

const DAY_MS = 86400000;
export const PIPELINE_BACKLOG_DAYS = 30;
const MAX_LISTED_CHANGES = 10;

export interface DoraPipelineFlow {
  pipeline: DoraPipelineResult;
  // By branch name
  changeLeadTimes: Map<string, DoraChangeLeadTime>;
}

interface PipelineLink {
  from: string;
  to: string;
}

// A merged Pull Request, and the branch it was listed for
interface MergedRecord {
  pullRequest: CommonPullRequestInfo;
  target: string;
  merged: number;
}

type Vehicle = { kind: 'full'; source: string } | { kind: 'promotion'; declared: number[] } | { kind: 'backMerge' };

// A change in a branch: when it got there, and when the job that deployed it finished
interface Stop {
  branch: string;
  arrivedAt: number;
  deployedAt: number | null;
  viaPromotion: boolean;
}

interface TracedChange {
  pullRequest: CommonPullRequestInfo;
  created: number;
  entered: string;
  enteredAt: number;
  stops: Map<string, Stop>;
}

/**
 * Follows every change from the major branch its Pull Request was merged into until production,
 * from the Pull Requests alone: no git history is read, so it also works where the repository is
 * not cloned.
 *
 * - A change is a merged Pull Request that does not move other Pull Requests.
 * - A Pull Request from a major branch into a later one carries every change that was in its
 *   source branch when it was merged.
 * - A promotion Pull Request (promotion/<source>/<target>/... with its promotionPullRequests
 *   list) carries the changes it declares, and the ones of the promotions it declares.
 * - A Pull Request from a major branch into an earlier one (a back-merge after a hotfix) carries
 *   nothing: a hotfix does not travel the pipeline twice.
 *
 * A change is in a branch from the merge that brought it, and deployed there when the deployment
 * job of that merge succeeded. Without such a job the merge date stands for it.
 *
 * Returns null when fewer than two of the branches follow each other in the pipeline.
 */
export function computePipelineFlow(inputs: DoraBranchInput[], period: DoraPeriod): DoraPipelineFlow | null {
  const links = listPipelineLinks(inputs);
  if (links.length === 0) {
    return null;
  }
  const downstream = buildDownstream(inputs, links);
  const { changes, untraced } = traceChanges(inputs, downstream, period);
  const production = inputs.find((input) => input.isProduction) || null;
  const days = Math.max(1, Math.round((period.to.getTime() - period.from.getTime()) / DAY_MS));
  const inCurrent = (date: number) => date >= period.from.getTime() && date < period.to.getTime();
  const inPrevious = (date: number) => period.previousFrom != null && date >= period.previousFrom.getTime() && date < period.from.getTime();

  // Time to production
  const delivered = production ? changes.filter((change) => change.stops.has(production.name)) : [];
  const totalDays = (change: TracedChange, branch: string) => (effective(change.stops.get(branch)!) - change.created) / DAY_MS;
  const deliveredNow = delivered.filter((change) => inCurrent(effective(change.stops.get(production!.name)!)));
  const deliveredBefore = delivered.filter((change) => inPrevious(effective(change.stops.get(production!.name)!)));
  const toProduction = distribution(deliveredNow.map((change) => totalDays(change, production!.name)).filter(isValidDuration));
  const toProductionBefore = distribution(deliveredBefore.map((change) => totalDays(change, production!.name)).filter(isValidDuration));

  // Each step of the pipeline
  const steps: DoraPipelineStep[] = links.map((link) => {
    const through = changes.filter((change) => {
      const source = change.stops.get(link.from);
      const target = change.stops.get(link.to);
      return source != null && target != null && target.arrivedAt >= source.arrivedAt;
    });
    const waitOf = (change: TracedChange) => Math.max(0, effective(change.stops.get(link.to)!) - effective(change.stops.get(link.from)!)) / DAY_MS;
    const now = through.filter((change) => inCurrent(effective(change.stops.get(link.to)!)));
    const before = through.filter((change) => inPrevious(effective(change.stops.get(link.to)!)));
    return {
      from: link.from,
      to: link.to,
      changes: now.length,
      viaPromotion: now.filter((change) => change.stops.get(link.to)!.viaPromotion).length,
      waitDays: distribution(now.map(waitOf)),
      previousMedianDays: distribution(before.map(waitOf)).median,
    };
  });
  const measuredSteps = steps.filter((step) => step.waitDays.median != null);
  const slowestStep = [...measuredSteps].sort((a, b) => b.waitDays.median! - a.waitDays.median!)[0];

  // What is in each branch and went no further
  const stages: DoraPipelineStage[] = inputs.map((input) => {
    const after = downstream.get(input.name)!;
    const waiting =
      after.size === 0
        ? []
        : changes
          .filter((change) => change.stops.has(input.name) && ![...after].some((branch) => change.stops.has(branch)))
          .map((change) => ({ change, since: effective(change.stops.get(input.name)!) }))
          .sort((a, b) => a.since - b.since);
    const ages = waiting.map((entry) => Math.max(0, (period.to.getTime() - entry.since) / DAY_MS));
    return {
      branch: input.name,
      isProduction: input.isProduction,
      entered: changes.filter((change) => change.entered === input.name && inCurrent(change.enteredAt)).length,
      waiting: {
        count: waiting.length,
        staleCount: ages.filter((age) => age > PIPELINE_BACKLOG_DAYS).length,
        oldestDays: ages.length > 0 ? round1(ages[0]) : null,
        medianDays: ages.length > 0 ? round1(median(ages)) : null,
        changes: waiting.slice(0, MAX_LISTED_CHANGES).map((entry, index) => ({
          ...pullRequestRef(entry.change.pullRequest),
          since: new Date(entry.since).toISOString(),
          days: round1(ages[index]),
        })),
      },
    };
  });

  const slowestChanges: DoraPipelineChange[] = deliveredNow
    .map((change) => ({ change, total: totalDays(change, production!.name) }))
    .filter((entry) => isValidDuration(entry.total))
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_LISTED_CHANGES)
    .map((entry) => ({
      ...pullRequestRef(entry.change.pullRequest),
      enteredAt: entry.change.entered,
      totalDays: round1(entry.total),
      stages: [...entry.change.stops.values()]
        .sort((a, b) => a.arrivedAt - b.arrivedAt)
        .map((stop) => ({
          branch: stop.branch,
          arrivedAt: new Date(stop.arrivedAt).toISOString(),
          deployedAt: stop.deployedAt != null ? new Date(stop.deployedAt).toISOString() : null,
        })),
    }));

  // Lead time of the changes of each branch
  const changeLeadTimes = new Map<string, DoraChangeLeadTime>();
  for (const input of inputs) {
    const reached = changes.filter((change) => change.stops.has(input.name));
    const now = reached.filter((change) => inCurrent(effective(change.stops.get(input.name)!)));
    const before = reached.filter((change) => inPrevious(effective(change.stops.get(input.name)!)));
    const current = distribution(now.map((change) => totalDays(change, input.name)).filter(isValidDuration));
    changeLeadTimes.set(input.name, {
      medianDays: current.median,
      p90Days: current.p90,
      avgDays: current.avg,
      level: classifyLeadTime(current.median).level,
      previousMedianDays: distribution(before.map((change) => totalDays(change, input.name)).filter(isValidDuration)).median,
      changes: now.length,
      weeks: buildWeeklyMedians(days, period.to, now, input.name).map(({ week, medianDays }) => ({ week, medianDays })),
    });
  }

  return {
    pipeline: {
      stages,
      steps,
      timeToProduction: production
        ? {
          medianDays: toProduction.median,
          p90Days: toProduction.p90,
          avgDays: toProduction.avg,
          level: classifyLeadTime(toProduction.median).level,
          previousMedianDays: toProductionBefore.median,
          changes: deliveredNow.length,
        }
        : null,
      bottleneck: measuredSteps.length > 1 && slowestStep ? { from: slowestStep.from, to: slowestStep.to } : null,
      weeks: production ? buildWeeklyMedians(days, period.to, deliveredNow, production.name) : [],
      slowestChanges,
      untraced,
    },
    changeLeadTimes,
  };
}

// The steps between the branches computed: the merge targets the project declares, or the order
// of the branches when nothing says where each one is merged
function listPipelineLinks(inputs: DoraBranchInput[]): PipelineLink[] {
  const names = inputs.map((input) => input.name);
  if (inputs.every((input) => input.mergeTargets === undefined)) {
    return names.slice(1).map((to, index) => ({ from: names[index], to }));
  }
  return inputs.flatMap((input) =>
    (input.mergeTargets || []).filter((target) => target !== input.name && names.includes(target)).map((to) => ({ from: input.name, to })),
  );
}

// Every branch a change of a branch can reach later
function buildDownstream(inputs: DoraBranchInput[], links: PipelineLink[]): Map<string, Set<string>> {
  const downstream = new Map<string, Set<string>>();
  for (const input of inputs) {
    const reached = new Set<string>();
    const toVisit = [input.name];
    while (toVisit.length > 0) {
      const current = toVisit.pop()!;
      for (const link of links) {
        if (link.from === current && link.to !== input.name && !reached.has(link.to)) {
          reached.add(link.to);
          toVisit.push(link.to);
        }
      }
    }
    downstream.set(input.name, reached);
  }
  return downstream;
}

function traceChanges(inputs: DoraBranchInput[], downstream: Map<string, Set<string>>, period: DoraPeriod): { changes: TracedChange[]; untraced: number } {
  const names = inputs.map((input) => input.name);
  const records = new Map<number, MergedRecord>();
  for (const input of inputs) {
    for (const pullRequest of input.pipelinePullRequests || input.mergedPullRequests) {
      const merged = Date.parse(pullRequest.mergedDate || '');
      const id = pullRequestNumber(pullRequest);
      if (!Number.isNaN(merged) && !Number.isNaN(id) && !records.has(id)) {
        records.set(id, { pullRequest, target: input.name, merged });
      }
    }
  }
  const succeededRuns = new Map<string, CommonCiRun[]>();
  for (const input of inputs) {
    succeededRuns.set(
      input.name,
      input.deploymentRuns
        .filter((run) => run.status === 'succeeded' && !Number.isNaN(Date.parse(run.finishedAt)))
        .sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt)),
    );
  }
  const deployedAtByRecord = new Map<MergedRecord, number | null>();
  const deployedAtOf = (record: MergedRecord): number | null => {
    if (!deployedAtByRecord.has(record)) {
      const deployment = findDeploymentOfMerge(record.pullRequest, succeededRuns.get(record.target) || []);
      deployedAtByRecord.set(record, deployment ? Date.parse(deployment.finishedAt) : null);
    }
    return deployedAtByRecord.get(record)!;
  };

  const vehicles = new Map<MergedRecord, Vehicle>();
  const changes = new Map<number, TracedChange>();
  for (const [id, record] of records) {
    const vehicle = classifyVehicle(record, names, downstream);
    if (vehicle) {
      vehicles.set(record, vehicle);
      continue;
    }
    const created = Date.parse(record.pullRequest.createdDate || '');
    changes.set(id, {
      pullRequest: record.pullRequest,
      created,
      entered: record.target,
      enteredAt: record.merged,
      stops: new Map([[record.target, { branch: record.target, arrivedAt: record.merged, deployedAt: deployedAtOf(record), viaPromotion: false }]]),
    });
  }

  let untraced = 0;
  const arrive = (change: TracedChange, record: MergedRecord, viaPromotion: boolean) => {
    // The earliest vehicle wins: a full merge after a promotion brings the same change again
    if (!change.stops.has(record.target)) {
      change.stops.set(record.target, { branch: record.target, arrivedAt: record.merged, deployedAt: deployedAtOf(record), viaPromotion });
    }
  };
  // What a promotion declares, the promotions it declares opened up
  const carryDeclared = (declared: number[], record: MergedRecord, seen: Set<number>) => {
    for (const id of declared) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const change = changes.get(id);
      const declaredRecord = records.get(id);
      const declaredVehicle = declaredRecord ? vehicles.get(declaredRecord) : undefined;
      if (change) {
        arrive(change, record, true);
      } else if (declaredVehicle?.kind === 'promotion') {
        carryDeclared(declaredVehicle.declared, record, seen);
      } else if (!declaredRecord && record.merged >= (period.previousFrom || period.from).getTime()) {
        untraced++;
      }
    }
  };
  // In the order of the merges: what a vehicle carries depends on what reached its source before
  const ordered = [...vehicles.entries()].sort(([a], [b]) => a.merged - b.merged);
  for (const [record, vehicle] of ordered) {
    if (vehicle.kind === 'full') {
      for (const change of changes.values()) {
        const inSource = change.stops.get(vehicle.source);
        if (inSource && inSource.arrivedAt <= record.merged) {
          arrive(change, record, false);
        }
      }
    } else if (vehicle.kind === 'promotion') {
      carryDeclared(vehicle.declared, record, new Set([pullRequestNumber(record.pullRequest)]));
    }
  }
  return { changes: [...changes.values()], untraced };
}

// What a merged Pull Request moves. undefined: nothing, it is a change of its own
function classifyVehicle(record: MergedRecord, names: string[], downstream: Map<string, Set<string>>): Vehicle | undefined {
  const sourceBranch = record.pullRequest.sourceBranch || '';
  const promotion = parsePromotionBranchName(sourceBranch);
  if (promotion && promotion.targetBranch === record.target) {
    const declared = parsePromotionPullRequestIds(record.pullRequest.description);
    if (declared != null) {
      return { kind: 'promotion', declared };
    }
  }
  if (names.includes(sourceBranch) && sourceBranch !== record.target) {
    return downstream.get(sourceBranch)?.has(record.target) ? { kind: 'full', source: sourceBranch } : { kind: 'backMerge' };
  }
  return undefined;
}

function buildWeeklyMedians(days: number, to: Date, changes: TracedChange[], branch: string): { week: string; medianDays: number | null; changes: number }[] {
  const weeks = new Map<string, number[]>();
  for (const week of buildWeekLabels(days, to)) {
    weeks.set(week, []);
  }
  for (const change of changes) {
    const reached = effective(change.stops.get(branch)!);
    const total = (reached - change.created) / DAY_MS;
    if (isValidDuration(total)) {
      weeks.get(weekKey(new Date(reached)))?.push(total);
    }
  }
  return [...weeks.entries()].map(([week, values]) => ({ week, medianDays: values.length > 0 ? round1(median(values)) : null, changes: values.length }));
}

// When a change is really in an org: the end of its deployment job, else the merge that brought it
function effective(stop: Stop): number {
  return stop.deployedAt != null && stop.deployedAt >= stop.arrivedAt ? stop.deployedAt : stop.arrivedAt;
}

function distribution(values: number[]): DoraDistribution {
  if (values.length === 0) {
    return { median: null, p90: null, avg: null };
  }
  return {
    median: round1(median(values)),
    p90: round1(percentile(values, 90)),
    avg: round1(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}

function isValidDuration(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function pullRequestNumber(pullRequest: CommonPullRequestInfo): number {
  return Number(pullRequest.idNumber || pullRequest.idStr);
}

function pullRequestRef(pullRequest: CommonPullRequestInfo): DoraPullRequestRef {
  return {
    id: pullRequest.idStr || String(pullRequest.idNumber),
    title: pullRequest.title || '',
    url: pullRequest.webUrl || '',
    author: pullRequest.authorName || '',
  };
}
