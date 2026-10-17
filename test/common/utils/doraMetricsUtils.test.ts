import { expect } from 'chai';
import { CommonCiRun } from '../../../src/common/gitProvider/gitProviderRoot.js';
import { CommonPullRequestInfo } from '../../../src/common/gitProvider/index.js';
import { DoraBranchInput, DoraPeriod, computeBranchResult, computeContributors } from '../../../src/common/utils/doraMetricsUtils.js';
import { computeAttentionItems } from '../../../src/common/utils/doraAttentionUtils.js';

const NOW = new Date('2026-09-30T12:00:00Z');
// 28 days, and the 28 days before
const PERIOD: DoraPeriod = { from: new Date('2026-09-02T12:00:00Z'), to: NOW, previousFrom: new Date('2026-08-05T12:00:00Z') };

let nextId = 1;
const run = (finishedAt: string, status: CommonCiRun['status'], overrides: Partial<CommonCiRun> = {}): CommonCiRun => {
  const finished = Date.parse(finishedAt);
  return {
    id: String(nextId++),
    name: 'deploy_to_org',
    kind: 'deployment',
    branch: 'uat',
    status,
    // Asked for 12 minutes before its end, picked by a runner 2 minutes later
    queuedAt: new Date(finished - 12 * 60000).toISOString(),
    startedAt: new Date(finished - 10 * 60000).toISOString(),
    finishedAt,
    commitSha: '',
    triggeredBy: 'Romain',
    webUrl: `https://ci.example.com/${nextId}`,
    ...overrides,
  };
};

const pullRequest = (id: number, createdDate: string, mergedDate: string | undefined, overrides: Partial<CommonPullRequestInfo> = {}): CommonPullRequestInfo => ({
  idNumber: id,
  idStr: String(id),
  targetBranch: 'uat',
  sourceBranch: `feature/${id}`,
  title: `Story ${id}`,
  description: '',
  authorName: 'Mariia',
  webUrl: `https://git.example.com/pr/${id}`,
  createdDate,
  mergedDate,
  customBehaviors: {},
  providerInfo: null,
  ...overrides,
});

const input = (overrides: Partial<DoraBranchInput> = {}): DoraBranchInput => ({
  name: 'uat',
  level: 50,
  isProduction: false,
  deploymentRuns: [],
  validationRuns: [],
  mergedPullRequests: [],
  openPullRequests: [],
  ...overrides,
});

describe('doraMetricsUtils', () => {
  it('rates nothing when a branch has no deployment and no Pull Request', () => {
    const result = computeBranchResult(input(), PERIOD);
    expect(result.metrics.deploymentFrequency).to.include({ perWeek: 0, level: 'none' });
    expect(result.metrics.leadTime).to.include({ medianDays: null, level: 'none' });
    expect(result.metrics.changeFailureRate).to.include({ percent: null, level: 'none' });
    expect(result.metrics.mttr).to.include({ medianHours: null, level: 'none' });
    expect(result.metrics.reworkRate).to.include({ percent: null, level: 'none' });
    expect(result.supplementary.validationSuccessRate).to.equal(null);
    expect(result.oldestRunDate).to.equal(null);
    expect(result.weeks.length).to.be.greaterThan(3);
  });

  it('computes frequency and failure rate from finished jobs, canceled ones apart', () => {
    const result = computeBranchResult(
      input({
        deploymentRuns: [
          run('2026-09-05T10:00:00Z', 'succeeded'),
          run('2026-09-12T10:00:00Z', 'succeeded'),
          run('2026-09-19T10:00:00Z', 'failed'),
          run('2026-09-19T14:00:00Z', 'succeeded'),
          run('2026-09-26T10:00:00Z', 'canceled'),
          // The period before: 1 failure out of 2
          run('2026-08-10T10:00:00Z', 'failed'),
          run('2026-08-20T10:00:00Z', 'succeeded'),
        ],
      }),
      PERIOD,
    );
    expect(result.counts).to.include({ deployments: 4, succeeded: 3, failed: 1, canceled: 1 });
    // 3 successes over 28 days
    expect(result.metrics.deploymentFrequency).to.include({ perWeek: 0.8, level: 'medium', previousPerWeek: 0.3 });
    expect(result.metrics.changeFailureRate).to.include({ percent: 25, level: 'low', previousPercent: 50 });
    expect(result.oldestRunDate).to.equal('2026-08-10T10:00:00Z');
    const weekOfFailure = result.weeks.find((week) => week.failed === 1)!;
    expect(weekOfFailure).to.include({ succeeded: 1, failed: 1, canceled: 0 });
    expect(result.weeks.reduce((sum, week) => sum + week.succeeded + week.failed + week.canceled, 0)).to.equal(5);
  });

  it('measures the recovery from a failed job to the next successful one, across the limits of the period', () => {
    const result = computeBranchResult(
      input({
        deploymentRuns: [
          run('2026-09-10T10:00:00Z', 'failed', { commitSha: 'merge-7' }),
          run('2026-09-10T16:00:00Z', 'succeeded'),
          run('2026-09-29T10:00:00Z', 'failed'),
        ],
        mergedPullRequests: [pullRequest(7, '2026-09-08T10:00:00Z', '2026-09-10T09:50:00Z', { mergeCommitSha: 'merge-7' })],
      }),
      PERIOD,
    );
    expect(result.metrics.mttr).to.include({ medianHours: 6, recoveries: 1, level: 'high' });
    // The newest first, the one that never recovered included
    expect(result.failedDeployments.map((failure) => [failure.date, failure.recoveryHours, failure.pullRequest?.id])).to.deep.equal([
      ['2026-09-29T10:00:00Z', null, undefined],
      ['2026-09-10T10:00:00Z', 6, '7'],
    ]);
    // A deployment redone within a day of a failure is rework: 1 out of 3 deployments
    expect(result.metrics.reworkRate.percent).to.equal(33.3);
  });

  it('ends the lead time at the job of the merge commit, else at the first job after the merge, else at the merge', () => {
    const result = computeBranchResult(
      input({
        deploymentRuns: [
          run('2026-09-10T12:00:00Z', 'succeeded', { commitSha: 'merge-1' }),
          // Starts after the merge of Pull Request 2
          run('2026-09-15T12:00:00Z', 'succeeded'),
        ],
        mergedPullRequests: [
          pullRequest(1, '2026-09-08T12:00:00Z', '2026-09-10T11:40:00Z', { mergeCommitSha: 'merge-1' }),
          pullRequest(2, '2026-09-11T12:00:00Z', '2026-09-15T11:00:00Z'),
          // Nothing deployed it within two weeks: the merge ends it
          pullRequest(3, '2026-09-19T12:00:00Z', '2026-09-20T12:00:00Z', { sourceBranch: 'hotfix/3' }),
          // Merged before the period
          pullRequest(4, '2026-08-01T12:00:00Z', '2026-08-25T12:00:00Z'),
        ],
      }),
      PERIOD,
    );
    // 2 days, 4 days and 1 day
    expect(result.metrics.leadTime).to.include({ medianDays: 2, avgDays: 2.3, level: 'high' });
    expect(result.counts.pullRequests).to.equal(3);
    expect(result.metrics.leadTime.previousMedianDays).to.equal(24);
    expect(result.hotfixPullRequests.map((hotfix) => hotfix.id)).to.deep.equal(['3']);
    // One hotfix Pull Request for two deployments
    expect(result.metrics.reworkRate.percent).to.equal(50);
  });

  it('lists the slow Pull Requests, the slowest first', () => {
    const result = computeBranchResult(
      input({
        mergedPullRequests: [
          pullRequest(1, '2026-09-01T12:00:00Z', '2026-09-10T12:00:00Z'),
          pullRequest(2, '2026-08-20T12:00:00Z', '2026-09-12T12:00:00Z'),
          pullRequest(3, '2026-09-14T12:00:00Z', '2026-09-15T12:00:00Z'),
        ],
      }),
      PERIOD,
    );
    expect(result.slowPullRequests.map((slow) => [slow.id, slow.cycleDays])).to.deep.equal([
      ['2', 23],
      ['1', 9],
    ]);
    expect(result.supplementary.prCycleTime.median).to.equal(9);
  });

  it('reports the duration, the queue time and the success rate of the deployment checks', () => {
    const result = computeBranchResult(
      input({
        deploymentRuns: [run('2026-09-10T12:00:00Z', 'succeeded'), run('2026-09-11T12:00:00Z', 'failed', { startedAt: '', queuedAt: '2026-09-11T11:00:00Z' })],
        validationRuns: [
          run('2026-09-09T12:00:00Z', 'succeeded', { kind: 'validation' }),
          run('2026-09-09T13:00:00Z', 'failed', { kind: 'validation' }),
          run('2026-09-09T14:00:00Z', 'succeeded', { kind: 'validation' }),
          run('2026-09-09T15:00:00Z', 'canceled', { kind: 'validation' }),
        ],
      }),
      PERIOD,
    );
    expect(result.supplementary.deploymentDuration.median).to.equal(10);
    // The job without a start date is left out of the queue time
    expect(result.supplementary.queueTime).to.deep.equal({ median: 2, p90: 2, avg: 2 });
    expect(result.supplementary.validationSuccessRate).to.equal(66.7);
    expect(result.counts.validations).to.equal(3);
    expect(result.weeks.reduce((sum, week) => sum + week.validationsFailed, 0)).to.equal(1);
  });

  it('counts the Pull Requests and the deployments of each person', () => {
    const contributors = computeContributors(
      [
        input({
          deploymentRuns: [run('2026-09-10T12:00:00Z', 'succeeded'), run('2026-09-11T12:00:00Z', 'failed'), run('2026-09-12T12:00:00Z', 'canceled')],
          mergedPullRequests: [pullRequest(1, '2026-09-08T12:00:00Z', '2026-09-10T12:00:00Z'), pullRequest(2, '2026-09-08T12:00:00Z', '2026-09-12T12:00:00Z')],
        }),
        input({ name: 'main', mergedPullRequests: [pullRequest(3, '2026-09-08T12:00:00Z', '2026-09-09T12:00:00Z', { authorName: 'Victor' })] }),
      ],
      PERIOD,
    );
    expect(contributors).to.deep.equal([
      { name: 'Mariia', pullRequests: 2, avgCycleDays: 3, deploymentsTriggered: 0, failedDeployments: 0 },
      { name: 'Romain', pullRequests: 0, avgCycleDays: null, deploymentsTriggered: 2, failedDeployments: 1 },
      { name: 'Victor', pullRequests: 1, avgCycleDays: 1, deploymentsTriggered: 0, failedDeployments: 0 },
    ]);
  });
});

describe('doraAttentionUtils', () => {
  const attentionCodes = (branchInput: DoraBranchInput) => computeAttentionItems(branchInput, computeBranchResult(branchInput, PERIOD), NOW).map((item) => item.code);

  it('says nothing about a branch that deploys and reviews in time', () => {
    expect(
      attentionCodes(
        input({
          deploymentRuns: [run('2026-09-28T12:00:00Z', 'succeeded')],
          openPullRequests: [pullRequest(1, '2026-09-27T12:00:00Z', undefined)],
        }),
      ),
    ).to.deep.equal([]);
  });

  it('flags a branch whose last deployment failed, and not also as idle', () => {
    const branchInput = input({ deploymentRuns: [run('2026-08-10T12:00:00Z', 'succeeded'), run('2026-09-27T12:00:00Z', 'failed')] });
    const items = computeAttentionItems(branchInput, computeBranchResult(branchInput, PERIOD), NOW);
    // The failure rate went from 0 to 100 %, which is listed too: the 48 days without a success are not
    expect(items.map((item) => [item.code, item.severity])).to.deep.equal([
      ['deploymentFailing', 'error'],
      ['failureRateUp', 'warning'],
    ]);
    expect(items[0].message).to.contain('2026-09-27').and.to.contain('3');
    expect(items[0].url).to.be.a('string');
  });

  it('flags the Pull Requests open for more than a week, drafts left out', () => {
    const branchInput = input({
      openPullRequests: [
        pullRequest(1, '2026-09-18T12:00:00Z', undefined),
        pullRequest(2, '2026-09-10T12:00:00Z', undefined, { title: 'Account hierarchy' }),
        pullRequest(3, '2026-09-01T12:00:00Z', undefined, { isDraft: true }),
        pullRequest(4, '2026-09-26T12:00:00Z', undefined),
      ],
    });
    const items = computeAttentionItems(branchInput, computeBranchResult(branchInput, PERIOD), NOW);
    expect(items.map((item) => item.code)).to.deep.equal(['stalePullRequests']);
    expect(items[0].message).to.contain('2').and.to.contain('Account hierarchy').and.to.contain('20');
  });

  it('flags a failure rate above 10 % that rose by 5 points', () => {
    const previous = [run('2026-08-10T12:00:00Z', 'succeeded'), run('2026-08-11T12:00:00Z', 'succeeded')];
    const failing = [run('2026-09-10T12:00:00Z', 'failed'), run('2026-09-11T12:00:00Z', 'succeeded'), run('2026-09-12T12:00:00Z', 'succeeded')];
    expect(attentionCodes(input({ deploymentRuns: [...previous, ...failing] }))).to.deep.equal(['failureRateUp']);
    // Nothing to compare with
    expect(attentionCodes(input({ deploymentRuns: failing }))).to.deep.equal([]);
  });

  it('flags a branch nothing was deployed to for 30 days', () => {
    expect(attentionCodes(input({ deploymentRuns: [run('2026-08-20T12:00:00Z', 'succeeded')] }))).to.deep.equal(['noRecentDeployment']);
    expect(attentionCodes(input())).to.deep.equal([]);
  });
});
