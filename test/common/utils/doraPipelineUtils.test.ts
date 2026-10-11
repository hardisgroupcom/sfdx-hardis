import { expect } from 'chai';
import { CommonCiRun } from '../../../src/common/gitProvider/gitProviderRoot.js';
import { CommonPullRequestInfo } from '../../../src/common/gitProvider/index.js';
import { DoraBranchInput, DoraPeriod } from '../../../src/common/utils/doraMetricsUtils.js';
import { computePipelineFlow } from '../../../src/common/utils/doraPipelineUtils.js';
import { computePipelineBacklogItem } from '../../../src/common/utils/doraAttentionUtils.js';

const NOW = new Date('2026-09-30T12:00:00Z');
// 28 days, and the 28 days before
const PERIOD: DoraPeriod = { from: new Date('2026-09-02T12:00:00Z'), to: NOW, previousFrom: new Date('2026-08-05T12:00:00Z') };
const BRANCHES = ['integration', 'uat', 'preprod', 'main'];

const day = (dayOfSeptember: number, hour = 10) => new Date(Date.UTC(2026, 8, dayOfSeptember, hour)).toISOString();

const pullRequest = (id: number, target: string, created: string, merged: string, overrides: Partial<CommonPullRequestInfo> = {}): CommonPullRequestInfo => ({
  idNumber: id,
  idStr: String(id),
  targetBranch: target,
  sourceBranch: `feature/story-${id}`,
  title: `Story ${id}`,
  description: '',
  authorName: 'Mariia',
  webUrl: `https://git.example.com/pr/${id}`,
  createdDate: created,
  mergedDate: merged,
  mergeCommitSha: `sha${id}`.padEnd(12, '0'),
  customBehaviors: {},
  providerInfo: null,
  ...overrides,
});

// A merge of a major branch into the next one
const merge = (id: number, source: string, target: string, merged: string) => pullRequest(id, target, merged, merged, { sourceBranch: source, title: `${source} to ${target}` });

const promotion = (id: number, source: string, target: string, merged: string, carried: number[], overrides: Partial<CommonPullRequestInfo> = {}) =>
  pullRequest(id, target, merged, merged, {
    sourceBranch: `promotion/${source}/${target}/2026-09-10-1000`,
    title: `Promotion ${source} to ${target}`,
    description: ['Stories of the week', '', '```yaml', `promotionPullRequests: [${carried.join(', ')}]`, '```'].join('\n'),
    ...overrides,
  });

// The deployment job of a merge, finished an hour after it
const deployment = (branch: string, merged: CommonPullRequestInfo, status: CommonCiRun['status'] = 'succeeded'): CommonCiRun => {
  const finished = Date.parse(merged.mergedDate || '') + 3600000;
  return {
    id: `run-${branch}-${merged.idNumber}`,
    name: 'deploy_to_org',
    kind: 'deployment',
    branch,
    status,
    queuedAt: new Date(finished - 50 * 60000).toISOString(),
    startedAt: new Date(finished - 45 * 60000).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    commitSha: merged.mergeCommitSha || '',
    triggeredBy: 'Romain',
    webUrl: `https://ci.example.com/${branch}/${merged.idNumber}`,
  };
};

// The four branches of the pipeline, each holding the Pull Requests merged into it and their deployment jobs
const pipelineInputs = (pullRequests: CommonPullRequestInfo[], options: { withoutMergeTargets?: boolean; withoutJobsOf?: number[] } = {}): DoraBranchInput[] =>
  BRANCHES.map((name, index) => {
    const merged = pullRequests.filter((candidate) => candidate.targetBranch === name);
    return {
      name,
      level: (index + 1) * 10,
      isProduction: name === 'main',
      deploymentRuns: merged.filter((candidate) => !(options.withoutJobsOf || []).includes(candidate.idNumber)).map((candidate) => deployment(name, candidate)),
      validationRuns: [],
      mergedPullRequests: merged,
      openPullRequests: [],
      ...(options.withoutMergeTargets ? {} : { mergeTargets: index < BRANCHES.length - 1 ? [BRANCHES[index + 1]] : [] }),
    };
  });

const stepOf = (flow: NonNullable<ReturnType<typeof computePipelineFlow>>, from: string, to: string) =>
  flow.pipeline.steps.find((step) => step.from === from && step.to === to)!;
const stageOf = (flow: NonNullable<ReturnType<typeof computePipelineFlow>>, branch: string) => flow.pipeline.stages.find((stage) => stage.branch === branch)!;

describe('doraPipelineUtils', () => {
  it('follows a change through every branch of a linear pipeline', () => {
    const flow = computePipelineFlow(
      pipelineInputs([
        pullRequest(1, 'integration', day(3), day(5)),
        merge(10, 'integration', 'uat', day(8)),
        merge(11, 'uat', 'preprod', day(15)),
        merge(12, 'preprod', 'main', day(19)),
      ]),
      PERIOD,
    )!;

    // Created on the 3rd, deployed in production on the 19th, an hour after the merge
    expect(flow.pipeline.timeToProduction).to.include({ medianDays: 16, changes: 1, level: 'medium' });
    expect(stepOf(flow, 'integration', 'uat').waitDays.median).to.equal(3);
    expect(stepOf(flow, 'uat', 'preprod').waitDays.median).to.equal(7);
    expect(stepOf(flow, 'preprod', 'main').waitDays.median).to.equal(4);
    expect(flow.pipeline.bottleneck).to.deep.equal({ from: 'uat', to: 'preprod' });
    expect(flow.pipeline.slowestChanges.map((change) => [change.id, change.enteredAt, change.totalDays])).to.deep.equal([['1', 'integration', 16]]);
    expect(flow.pipeline.slowestChanges[0].stages.map((stage) => stage.branch)).to.deep.equal(BRANCHES);
    expect(flow.pipeline.stages.map((stage) => stage.waiting.count)).to.deep.equal([0, 0, 0, 0]);
    expect(stageOf(flow, 'integration').entered).to.equal(1);
  });

  it('gives each branch the lead time of its changes, not the one of the merge that brought them', () => {
    const flow = computePipelineFlow(
      pipelineInputs([pullRequest(1, 'integration', day(3), day(5)), merge(10, 'integration', 'uat', day(8)), merge(11, 'uat', 'preprod', day(15))]),
      PERIOD,
    )!;

    expect(flow.changeLeadTimes.get('integration')).to.include({ medianDays: 2, changes: 1, level: 'high' });
    expect(flow.changeLeadTimes.get('uat')).to.include({ medianDays: 5, changes: 1 });
    expect(flow.changeLeadTimes.get('preprod')).to.include({ medianDays: 12, changes: 1, level: 'medium' });
    expect(flow.changeLeadTimes.get('main')).to.include({ medianDays: null, changes: 0, level: 'none' });
    expect(flow.changeLeadTimes.get('preprod')!.weeks.filter((week) => week.medianDays != null).length).to.equal(1);
  });

  it('carries with a merge only what was in the source branch when it was merged', () => {
    const flow = computePipelineFlow(
      pipelineInputs([
        pullRequest(1, 'integration', day(3), day(5)),
        merge(10, 'integration', 'uat', day(8)),
        // Merged after the merge to uat: it waits for the next one
        pullRequest(2, 'integration', day(8, 12), day(9)),
      ]),
      PERIOD,
    )!;

    expect(stepOf(flow, 'integration', 'uat').changes).to.equal(1);
    expect(stageOf(flow, 'integration').waiting.changes.map((change) => change.id)).to.deep.equal(['2']);
    expect(stageOf(flow, 'uat').waiting.changes.map((change) => change.id)).to.deep.equal(['1']);
    // 21 days and 2 hours in uat, counted from the end of its deployment job
    expect(stageOf(flow, 'uat').waiting).to.include({ count: 1, staleCount: 0, oldestDays: 22 });
  });

  it('carries with a promotion the changes it declares, and leaves the others where they are', () => {
    const flow = computePipelineFlow(
      pipelineInputs([
        pullRequest(1, 'uat', day(3), day(5)),
        pullRequest(2, 'uat', day(3), day(6)),
        promotion(20, 'uat', 'preprod', day(10), [1]),
      ]),
      PERIOD,
    )!;

    expect(stepOf(flow, 'uat', 'preprod')).to.include({ changes: 1, viaPromotion: 1 });
    expect(stageOf(flow, 'uat').waiting.changes.map((change) => change.id)).to.deep.equal(['2']);
    expect(stageOf(flow, 'preprod').waiting.changes.map((change) => change.id)).to.deep.equal(['1']);
    // The promotion moves changes: it is not one
    expect(flow.changeLeadTimes.get('preprod')!.changes).to.equal(1);
  });

  it('opens up a promotion that a later promotion declares', () => {
    const flow = computePipelineFlow(
      pipelineInputs([
        pullRequest(1, 'uat', day(3), day(5)),
        promotion(20, 'uat', 'preprod', day(10), [1]),
        promotion(21, 'preprod', 'main', day(12), [20]),
      ]),
      PERIOD,
    )!;

    expect(flow.pipeline.timeToProduction).to.include({ changes: 1, medianDays: 9 });
    expect(stepOf(flow, 'preprod', 'main')).to.include({ changes: 1, viaPromotion: 1 });
    expect(flow.pipeline.untraced).to.equal(0);
  });

  it('keeps the first arrival when a merge brings again what a promotion carried', () => {
    const flow = computePipelineFlow(
      pipelineInputs([
        pullRequest(1, 'uat', day(3), day(5)),
        pullRequest(2, 'uat', day(3), day(6)),
        promotion(20, 'uat', 'preprod', day(10), [1]),
        merge(11, 'uat', 'preprod', day(20)),
      ]),
      PERIOD,
    )!;

    const step = stepOf(flow, 'uat', 'preprod');
    expect(step).to.include({ changes: 2, viaPromotion: 1 });
    // Story 1 waited 5 days (5th to 10th), story 2 waited 14 (6th to 20th)
    expect(step.waitDays).to.deep.equal({ median: 9.5, p90: 14, avg: 9.5 });
    expect(stageOf(flow, 'uat').waiting.count).to.equal(0);
  });

  it('counts a hotfix from the branch it was merged into, and does not send it through the pipeline again', () => {
    const flow = computePipelineFlow(
      pipelineInputs([
        pullRequest(5, 'main', day(10), day(10, 15), { sourceBranch: 'hotfix/price-rule' }),
        // The back-merge that brings the hotfix to integration, then the usual way up
        merge(13, 'main', 'integration', day(11)),
        merge(10, 'integration', 'uat', day(12)),
      ]),
      PERIOD,
    )!;

    expect(flow.pipeline.timeToProduction).to.include({ changes: 1, medianDays: 0.3 });
    expect(flow.pipeline.slowestChanges[0]).to.include({ id: '5', enteredAt: 'main' });
    expect(stageOf(flow, 'main').entered).to.equal(1);
    expect(flow.pipeline.steps.map((step) => step.changes)).to.deep.equal([0, 0, 0]);
    expect(flow.pipeline.stages.map((stage) => stage.waiting.count)).to.deep.equal([0, 0, 0, 0]);
  });

  it('says how many declared changes it could not find', () => {
    const flow = computePipelineFlow(pipelineInputs([pullRequest(1, 'uat', day(3), day(5)), promotion(20, 'uat', 'preprod', day(10), [1, 999])]), PERIOD)!;

    expect(flow.pipeline.untraced).to.equal(1);
    expect(stepOf(flow, 'uat', 'preprod').changes).to.equal(1);
  });

  it('reads a promotion branch without its list, or aimed at another branch, as a change of its own', () => {
    const flow = computePipelineFlow(
      pipelineInputs([
        pullRequest(1, 'uat', day(3), day(5)),
        promotion(20, 'uat', 'preprod', day(10), [1], { description: 'No list here' }),
        // Named for preprod, merged into main
        promotion(21, 'uat', 'preprod', day(11), [1], { targetBranch: 'main' }),
      ]),
      PERIOD,
    )!;

    expect(stepOf(flow, 'uat', 'preprod').changes).to.equal(0);
    expect(stageOf(flow, 'preprod').entered).to.equal(1);
    expect(stageOf(flow, 'main').entered).to.equal(1);
    expect(stageOf(flow, 'uat').waiting.changes.map((change) => change.id)).to.deep.equal(['1']);
  });

  it('uses the merge date when no deployment job is known for it', () => {
    const flow = computePipelineFlow(
      pipelineInputs([pullRequest(1, 'integration', day(3), day(5)), merge(10, 'integration', 'uat', day(8))], { withoutJobsOf: [1, 10] }),
      PERIOD,
    )!;

    expect(stepOf(flow, 'integration', 'uat').waitDays.median).to.equal(3);
    expect(flow.changeLeadTimes.get('uat')!.medianDays).to.equal(5);
  });

  it('compares with the period before', () => {
    const august = (dayOfAugust: number) => new Date(Date.UTC(2026, 7, dayOfAugust, 10)).toISOString();
    const flow = computePipelineFlow(
      pipelineInputs([
        pullRequest(1, 'preprod', august(8), august(10)),
        merge(12, 'preprod', 'main', august(20)),
        pullRequest(2, 'preprod', day(4), day(5)),
        merge(14, 'preprod', 'main', day(9)),
      ]),
      PERIOD,
    )!;

    expect(flow.pipeline.timeToProduction).to.include({ medianDays: 5, previousMedianDays: 12, changes: 1 });
    expect(stepOf(flow, 'preprod', 'main')).to.include({ changes: 1, previousMedianDays: 10 });
    expect(flow.changeLeadTimes.get('main')).to.include({ medianDays: 5, previousMedianDays: 12 });
    expect(flow.pipeline.weeks.filter((week) => week.changes > 0).map((week) => [week.week, week.medianDays])).to.deep.equal([['2026-W37', 5]]);
  });

  it('follows the order of the branches when nothing says where each one is merged', () => {
    const flow = computePipelineFlow(
      pipelineInputs([pullRequest(1, 'integration', day(3), day(5)), merge(10, 'integration', 'uat', day(8))], { withoutMergeTargets: true }),
      PERIOD,
    )!;

    expect(flow.pipeline.steps.map((step) => `${step.from}>${step.to}`)).to.deep.equal(['integration>uat', 'uat>preprod', 'preprod>main']);
    expect(stepOf(flow, 'integration', 'uat').changes).to.equal(1);
  });

  it('computes nothing when the branches do not follow each other', () => {
    const [integration, , , main] = pipelineInputs([pullRequest(1, 'integration', day(3), day(5))]);

    expect(computePipelineFlow([main], PERIOD)).to.equal(null);
    // integration is merged into uat, which is not computed
    expect(computePipelineFlow([integration, main], PERIOD)).to.equal(null);
  });

  it('gives no time to production without a production branch', () => {
    const inputs = pipelineInputs([pullRequest(1, 'integration', day(3), day(5)), merge(10, 'integration', 'uat', day(8))]).slice(0, 2);

    const flow = computePipelineFlow(inputs, PERIOD)!;

    expect(flow.pipeline.timeToProduction).to.equal(null);
    expect(flow.pipeline.weeks).to.deep.equal([]);
    expect(flow.pipeline.steps.length).to.equal(1);
    // One step alone has nothing to be compared with
    expect(flow.pipeline.bottleneck).to.equal(null);
  });

  it('flags the changes that have been waiting in a branch for more than 30 days', () => {
    const august = (dayOfAugust: number) => new Date(Date.UTC(2026, 7, dayOfAugust, 10)).toISOString();
    const flow = computePipelineFlow(
      pipelineInputs([pullRequest(1, 'uat', august(10), august(12)), pullRequest(2, 'uat', august(14), august(15)), pullRequest(3, 'uat', day(20), day(21))]),
      PERIOD,
    )!;

    const stage = stageOf(flow, 'uat');
    expect(stage.waiting).to.include({ count: 3, staleCount: 2 });
    const item = computePipelineBacklogItem(stage)!;
    expect(item).to.include({ code: 'pipelineBacklog', severity: 'warning', url: 'https://git.example.com/pr/1' });
    expect(computePipelineBacklogItem(stageOf(flow, 'preprod'))).to.equal(null);
  });
});
