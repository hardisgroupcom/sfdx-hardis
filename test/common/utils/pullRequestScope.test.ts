/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { isRetrofit } from '../../../src/common/utils/orgConfigUtils.js';
import { buildPrSearchBranches, getSinglePullRequestScopeKind, isSinglePullRequestScope } from '../../../src/common/utils/pullRequestUtils.js';

const MAJOR_BRANCHES = ['main', 'preprod', 'uat', 'integration'];

const MAJOR_ORGS = [
  { branchName: 'integration', mergeTargets: ['uat'] },
  { branchName: 'uat', mergeTargets: ['preprod'] },
  { branchName: 'preprod', mergeTargets: ['main'] },
  { branchName: 'main', mergeTargets: [] },
];

describe('isRetrofit()', () => {
  it('recognizes a retrofit branch', () => {
    expect(isRetrofit('retrofit/from-main')).to.equal(true);
    expect(isRetrofit('retrofit')).to.equal(true);
  });

  it('is case insensitive, like the other branch classifiers', () => {
    expect(isRetrofit('Retrofit/From-Main')).to.equal(true);
    expect(isRetrofit('RETROFIT/from-main')).to.equal(true);
  });

  it('only matches the retrofit/<name> convention', () => {
    expect(isRetrofit('feature/retrofit-the-thing')).to.equal(false);
    expect(isRetrofit('integration')).to.equal(false);
    // An ordinary branch that merely starts with the word must not take the batch scope
    expect(isRetrofit('retrofit-JIRA-123')).to.equal(false);
    expect(isRetrofit('retrofitting-legacy')).to.equal(false);
  });

  it('handles an empty branch name', () => {
    expect(isRetrofit('')).to.equal(false);
  });
});

describe('isSinglePullRequestScope()', () => {
  it('scopes a feature branch merge to the merged Pull Request', () => {
    expect(isSinglePullRequestScope('feature/my-feature', MAJOR_BRANCHES)).to.equal(true);
    expect(isSinglePullRequestScope('fix/my-fix', MAJOR_BRANCHES)).to.equal(true);
    expect(isSinglePullRequestScope('hotfix/urgent', MAJOR_BRANCHES)).to.equal(true);
  });

  // A major branch merge carries every Pull Request merged upstream since the previous merge.
  it('keeps the whole batch for a merge between major branches', () => {
    expect(isSinglePullRequestScope('integration', MAJOR_BRANCHES)).to.equal(false);
    expect(isSinglePullRequestScope('uat', MAJOR_BRANCHES)).to.equal(false);
    expect(isSinglePullRequestScope('main', MAJOR_BRANCHES)).to.equal(false);
  });

  // Retrofitting main down to integration must replay what already ran in main.
  it('keeps the whole batch for a merge from a retrofit branch', () => {
    expect(isSinglePullRequestScope('retrofit/from-main', MAJOR_BRANCHES)).to.equal(false);
    expect(isSinglePullRequestScope('retrofit/from-preprod', MAJOR_BRANCHES)).to.equal(false);
  });

  it('does not treat a feature branch named after a major branch as major', () => {
    expect(isSinglePullRequestScope('feature/integration-tests', MAJOR_BRANCHES)).to.equal(true);
  });

  // Some providers do not expose the source branch on a push-triggered deployment. Narrowing the
  // scope there would silently drop every upstream Pull Request, so keep the previous behavior.
  it('keeps the whole batch when the source branch is unknown', () => {
    expect(isSinglePullRequestScope('', MAJOR_BRANCHES)).to.equal(false);
  });

  it('matches major branch names without case, like the other branch classifiers', () => {
    expect(isSinglePullRequestScope('Integration', MAJOR_BRANCHES)).to.equal(false);
    expect(isSinglePullRequestScope('integration', ['Integration', 'UAT'])).to.equal(false);
  });

  it('treats every named branch as a feature branch when no major branch is configured', () => {
    expect(isSinglePullRequestScope('integration', [])).to.equal(true);
    expect(isSinglePullRequestScope('retrofit/from-main', [])).to.equal(false);
  });
});

describe('getSinglePullRequestScopeKind()', () => {
  // The validation job of a feature branch used to collect the whole promotion window: the
  // feature branch had never been merged into the target, so "since the last merge" was its
  // entire history, and the check comment listed the manual actions of every Pull Request ever
  // merged upstream (341 of them on one real project).
  it('scopes the validation job of a feature branch to the checked Pull Request', () => {
    expect(getSinglePullRequestScopeKind(true, 'feature/my-feature', MAJOR_BRANCHES)).to.equal('check');
    expect(getSinglePullRequestScopeKind(true, 'fix/my-fix', MAJOR_BRANCHES)).to.equal('check');
  });

  it('scopes the deployment job of a feature branch to the merged Pull Request', () => {
    expect(getSinglePullRequestScopeKind(false, 'feature/my-feature', MAJOR_BRANCHES)).to.equal('single-pr');
  });

  // Checking integration -> uat must list what the promotion will replay, on both jobs.
  it('keeps the whole batch for a major branch, on the validation job as on the deployment job', () => {
    expect(getSinglePullRequestScopeKind(true, 'integration', MAJOR_BRANCHES)).to.equal(null);
    expect(getSinglePullRequestScopeKind(false, 'integration', MAJOR_BRANCHES)).to.equal(null);
  });

  it('keeps the whole batch for a retrofit branch, on the validation job as on the deployment job', () => {
    expect(getSinglePullRequestScopeKind(true, 'retrofit/from-main', MAJOR_BRANCHES)).to.equal(null);
    expect(getSinglePullRequestScopeKind(false, 'retrofit/from-main', MAJOR_BRANCHES)).to.equal(null);
  });

  it('keeps the whole batch when the source branch is unknown', () => {
    expect(getSinglePullRequestScopeKind(true, '', MAJOR_BRANCHES)).to.equal(null);
    expect(getSinglePullRequestScopeKind(false, '', MAJOR_BRANCHES)).to.equal(null);
  });
});

describe('buildPrSearchBranches()', () => {
  // Upstream branches must be searched too: a hotfix Pull Request merged into main can only be
  // collected after a retrofit if main is part of the search list.
  it('includes every major branch, not just the children of the window target', () => {
    const branches = buildPrSearchBranches('uat', MAJOR_ORGS, 'integration');
    expect(branches).to.have.members(['uat', 'preprod', 'main']);
  });

  it('excludes the branch the git provider already searches by itself', () => {
    const branches = buildPrSearchBranches('preprod', MAJOR_ORGS, 'uat');
    expect(branches).to.not.include('uat');
    expect(branches).to.have.members(['integration', 'preprod', 'main']);
  });

  it('covers the go-live case: all major branches below and above the production branch', () => {
    const branches = buildPrSearchBranches('main', MAJOR_ORGS, 'main');
    expect(branches).to.have.members(['integration', 'uat', 'preprod']);
  });

  it('returns no duplicates when children and major branches overlap', () => {
    const branches = buildPrSearchBranches('main', MAJOR_ORGS, 'preprod');
    expect(branches).to.deep.equal([...new Set(branches)]);
  });
});
