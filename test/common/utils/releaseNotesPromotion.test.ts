/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import type { CommonPullRequestInfo } from '../../../src/common/gitProvider/index.js';
import { dropResolvedPromotionPullRequests, pullRequestsLookup } from '../../../src/common/utils/releaseNotesUtils.js';

const ENABLED = { enabled: true, allowedSteps: [] };
const DISABLED = { enabled: false, allowedSteps: [] };
const DECLARATION = '```yaml\npromotionPullRequests: [482, 487]\n```';

function pr(overrides: Partial<CommonPullRequestInfo>): CommonPullRequestInfo {
  const idNumber = overrides.idNumber ?? 1;
  return {
    idNumber,
    idStr: String(idNumber),
    sourceBranch: 'feature/story',
    targetBranch: 'main',
    title: `PR ${idNumber}`,
    description: '',
    authorName: 'someone',
    webUrl: `https://git.example.com/pr/${idNumber}`,
    mergedDate: '2026-09-01T10:00:00Z',
    customBehaviors: {},
    providerInfo: {},
    ...overrides,
  };
}

describe('dropResolvedPromotionPullRequests()', () => {
  const promotion = pr({
    idNumber: 900,
    sourceBranch: 'promotion/uat/preprod/2026-09-06-1',
    targetBranch: 'preprod',
    description: DECLARATION,
  });

  it('leaves only the carried User Stories, so the release is not counted twice', () => {
    const kept = dropResolvedPromotionPullRequests([promotion, pr({ idNumber: 482 }), pr({ idNumber: 487 })], ENABLED);
    expect(kept.map((entry) => entry.idNumber)).to.deep.equal([482, 487]);
  });

  it('keeps a promotion whose stories could not be resolved, so nothing disappears', () => {
    const kept = dropResolvedPromotionPullRequests([promotion, pr({ idNumber: 12 })], ENABLED);
    expect(kept.map((entry) => entry.idNumber)).to.deep.equal([900, 12]);
  });

  it('keeps the promotions next to their stories with --include-promotions', () => {
    const kept = dropResolvedPromotionPullRequests([promotion, pr({ idNumber: 482 })], ENABLED, { includePromotions: true });
    expect(kept.map((entry) => entry.idNumber)).to.deep.equal([900, 482]);
  });

  it('changes nothing when the feature is off', () => {
    const all = [promotion, pr({ idNumber: 482 })];
    expect(dropResolvedPromotionPullRequests(all, DISABLED)).to.deep.equal(all);
  });
});

describe('pullRequestsLookup()', () => {
  const merge = '1d78a01dbc833ccf98b96e9d59849bf83012856b';

  it('reads the go live of the chosen merge commit in post mode, even when the source branch is known', () => {
    expect(pullRequestsLookup({ mode: 'post', targetBranch: 'uat', sourceBranch: 'integration', fromCommit: 'edeb5ae', toCommit: merge })).to.equal('goLive');
  });

  it('lists what is waiting in prepare mode', () => {
    expect(pullRequestsLookup({ mode: 'prepare', targetBranch: 'uat', sourceBranch: 'integration', fromCommit: '', toCommit: 'HEAD' })).to.equal('branches');
  });

  it('uses the dates when there are some', () => {
    expect(pullRequestsLookup({ mode: 'post', targetBranch: 'uat', fromCommit: '', toCommit: '', fromDate: '2026-09-01' })).to.equal('dates');
  });

  it('falls back to the recent merges of the target branch', () => {
    expect(pullRequestsLookup({ mode: 'post', targetBranch: 'main', fromCommit: '', toCommit: 'HEAD' })).to.equal('recent');
  });
});
