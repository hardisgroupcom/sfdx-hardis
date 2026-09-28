/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import { simpleGit } from 'simple-git';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import fs from '../../../src/common/utils/fsUtils.js';
import { abortPromotion } from '../../../src/common/utils/promotionCreateUtils.js';

// abortPromotion runs git in process.cwd(): each test works in a throwaway repository and gives the
// original cwd back
const originalCwd = process.cwd();

async function makeRepo(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-promotion-abort-')));
  const g = simpleGit(root);
  await g.init();
  await g.addConfig('user.email', 'hardis-test@example.com');
  await g.addConfig('user.name', 'Hardis Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.addConfig('core.autocrlf', 'false');
  await fs.writeFile(path.join(root, 'NOTES.md'), 'base\n');
  await g.add('NOTES.md');
  await g.commit('base');
  await g.branch(['-M', 'uat']);
  return root;
}

describe('abortPromotion() on a real git repository', () => {
  const commandThis = { ux: null };
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('goes back to the previous branch and deletes the promotion branch', async () => {
    const g = simpleGit(repo);
    await g.checkoutLocalBranch('promotion/uat/preprod/2026-09-12-1200');
    await abortPromotion('promotion/uat/preprod/2026-09-12-1200', 'uat', commandThis);
    const branches = await g.branchLocal();
    expect(branches.current).to.equal('uat');
    expect(branches.all).to.not.include('promotion/uat/preprod/2026-09-12-1200');
  });

  it('does nothing the second time, so the undo of the caller does not report a missing branch', async () => {
    const g = simpleGit(repo);
    await g.checkoutLocalBranch('promotion/uat/preprod/2026-09-12-1200');
    await abortPromotion('promotion/uat/preprod/2026-09-12-1200', 'uat', commandThis);
    // cherryPickCandidates undoes what it started, then the caller undoes again in its catch
    await abortPromotion('promotion/uat/preprod/2026-09-12-1200', 'uat', commandThis);
    const branches = await g.branchLocal();
    expect(branches.current).to.equal('uat');
    expect(branches.all).to.not.include('promotion/uat/preprod/2026-09-12-1200');
  });
});
