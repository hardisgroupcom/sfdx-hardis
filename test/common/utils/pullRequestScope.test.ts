/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { isRetrofit } from '../../../src/common/utils/orgConfigUtils.js';
import { isSinglePullRequestScope } from '../../../src/common/utils/pullRequestUtils.js';

const MAJOR_BRANCHES = ['main', 'preprod', 'uat', 'integration'];

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
