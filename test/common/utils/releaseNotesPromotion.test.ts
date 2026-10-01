/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import type { CommonPullRequestInfo } from '../../../src/common/gitProvider/index.js';
import { dropMetadataOfCommits, dropResolvedPromotionPullRequests, pullRequestsLookup } from '../../../src/common/utils/releaseNotesUtils.js';
import type { MetadataChangeMap } from '../../../src/common/utils/releaseNotesUtils.js';

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

describe('dropMetadataOfCommits()', () => {
  const commit = (sha: string) => ({ sha, title: `commit ${sha}`, author: 'dev', date: '2026-09-01T10:00:00Z' });
  const waitingPr = { idNumber: 483, idStr: '483', title: 'Story 483', authorName: 'dev' };
  function changes(): MetadataChangeMap {
    return {
      added: { ApexClass: ['Promoted', 'Waiting', 'Shared', 'Unattributed'], CustomField: ['Account.Promoted__c'] },
      deleted: { ApexClass: ['OldPromoted'] },
      addedCount: 5,
      deletedCount: 1,
      attribution: new Map([
        // Only touched by a story a merged promotion already carried
        ['ApexClass::Promoted', { pullRequests: [], commits: [commit('p1'), commit('p2')] }],
        ['CustomField::Account.Promoted__c', { pullRequests: [], commits: [commit('p1')] }],
        ['ApexClass::OldPromoted', { pullRequests: [], commits: [commit('p2')] }],
        // Touched by a story still waiting
        ['ApexClass::Waiting', { pullRequests: [waitingPr], commits: [commit('w1')] }],
        // Touched by both: the waiting story may hold a change the target branch does not have
        ['ApexClass::Shared', { pullRequests: [waitingPr], commits: [commit('p1'), commit('w1')] }],
      ]),
    };
  }

  it('leaves out the components only a promoted story changed, in additions and deletions', () => {
    const metadataChanges = changes();
    const removed = dropMetadataOfCommits(metadataChanges, new Set(['p1', 'p2']));
    expect(removed.sort()).to.deep.equal(['ApexClass::OldPromoted', 'ApexClass::Promoted', 'CustomField::Account.Promoted__c']);
    expect(metadataChanges.added).to.deep.equal({ ApexClass: ['Waiting', 'Shared', 'Unattributed'] });
    expect(metadataChanges.deleted).to.deep.equal({});
    expect(metadataChanges.addedCount).to.equal(3);
    expect(metadataChanges.deletedCount).to.equal(0);
    expect(metadataChanges.attribution?.has('ApexClass::Promoted')).to.equal(false);
  });

  it('keeps a component a commit outside any promoted story touched', () => {
    // p1 is promoted, d1 is a commit with no Pull Request: nobody knows it reached the target
    const metadataChanges = changes();
    metadataChanges.attribution?.set('ApexClass::Promoted', { pullRequests: [], commits: [commit('p1'), commit('d1')] });
    const removed = dropMetadataOfCommits(metadataChanges, new Set(['p1', 'p2']));
    expect(removed).to.not.include('ApexClass::Promoted');
  });

  it('changes nothing without promoted commits or without attribution', () => {
    const untouched = changes();
    expect(dropMetadataOfCommits(untouched, new Set())).to.deep.equal([]);
    expect(untouched.addedCount).to.equal(5);
    const noAttribution: MetadataChangeMap = { added: { ApexClass: ['A'] }, deleted: {}, addedCount: 1, deletedCount: 0 };
    expect(dropMetadataOfCommits(noAttribution, new Set(['p1']))).to.deep.equal([]);
    expect(noAttribution.added).to.deep.equal({ ApexClass: ['A'] });
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
