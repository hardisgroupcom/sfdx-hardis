/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { SfError } from '@salesforce/core';
import {
  assertMajorBranchCheckAllowed,
  enableMajorBranchCheckMode,
  isMajorBranchCheckMode,
  resetMajorBranchCheckMode,
} from '../../../src/common/utils/majorBranchCheckUtils.js';
import { GitProvider } from '../../../src/common/gitProvider/index.js';
import { executePrePostCommands } from '../../../src/common/utils/prePostCommandUtils.js';
import SmartDeploy from '../../../src/commands/hardis/project/deploy/smart.js';

const MAJOR_ORGS = [{ branchName: 'integration' }, { branchName: 'uat' }, { branchName: 'main' }];

describe('assertMajorBranchCheckAllowed()', () => {
  it('accepts a major branch', () => {
    expect(() => assertMajorBranchCheckAllowed('uat', MAJOR_ORGS)).not.to.throw();
  });

  it('refuses a branch without a branch config file', () => {
    expect(() => assertMajorBranchCheckAllowed('feature/my-story', MAJOR_ORGS)).to.throw(SfError, /feature\/my-story/);
  });

  it('refuses an unknown branch', () => {
    expect(() => assertMajorBranchCheckAllowed(null, MAJOR_ORGS)).to.throw(SfError);
    expect(() => assertMajorBranchCheckAllowed('', [])).to.throw(SfError);
  });
});

describe('Major branch deployment check mode', () => {
  const originalGetInstance = GitProvider.getInstance;

  beforeEach(() => {
    resetMajorBranchCheckMode();
  });

  afterEach(() => {
    resetMajorBranchCheckMode();
    GitProvider.getInstance = originalGetInstance;
    GitProvider.prInfoCache = null;
  });

  it('is off until enabled', () => {
    expect(isMajorBranchCheckMode()).to.equal(false);
    enableMajorBranchCheckMode();
    expect(isMajorBranchCheckMode()).to.equal(true);
  });

  it('reads no Pull Request, not even the cached one', async () => {
    GitProvider.prInfoCache = { idNumber: 42, sourceBranch: 'feature/a', targetBranch: 'uat' };
    expect(await GitProvider.getPullRequestInfo({ useCache: true })).to.not.be.null;
    enableMajorBranchCheckMode();
    expect(await GitProvider.getPullRequestInfo({ useCache: true })).to.be.null;
    expect(await GitProvider.getPullRequestInfo()).to.be.null;
  });

  it('posts no Pull Request comment, and does not even reach the git provider', async () => {
    let providerAsked = false;
    GitProvider.getInstance = (async () => {
      providerAsked = true;
      return null;
    }) as typeof GitProvider.getInstance;
    enableMajorBranchCheckMode();
    await GitProvider.managePostPullRequestComment(true);
    expect(providerAsked).to.equal(false);
  });

  it('runs no deployment action', async () => {
    enableMajorBranchCheckMode();
    // A command that fails the phase if it ever runs
    const extraCommands = [{ id: 'mbc-test', label: 'Must not run', type: 'command', command: 'exit 1', preOrPost: 'commandsPreDeploy' }];
    await executePrePostCommands('commandsPreDeploy', { success: true, checkOnly: true, extraCommands });
    await executePrePostCommands('commandsPostDeploy', { success: true, checkOnly: true, extraCommands });
  });

  it('never allows a delta, even between major branches when it is enabled', async () => {
    enableMajorBranchCheckMode();
    const fakeCommand = { configInfo: { enableDeltaDeploymentBetweenMajorBranches: true, useDeltaDeployment: true }, checkOnly: true };
    const allowed = await SmartDeploy.prototype.isDeltaAllowed.call(fakeCommand);
    expect(allowed).to.equal(false);
  });
});
