/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import { SimpleGit, simpleGit } from 'simple-git';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import fs from '../../../src/common/utils/fsUtils.js';
import {
  createBackpromoteBranch,
  exportBranchPackageDirectories,
  isBranchUpToDateWith,
  leaveBackpromoteBranch,
  readBackpromoteBranchInfo,
} from '../../../src/common/utils/backpromoteBranchUtils.js';

// The helpers run git in process.cwd(): each test works in a throwaway repository and gives the
// original cwd back
const originalCwd = process.cwd();
const apexClass = 'force-app/main/default/classes/PromoE2EAlphaTest.cls';
const baseContent = 'public class PromoE2EAlphaTest {}\n';

async function makeRepo(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-backpromote-branch-')));
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig('user.email', 'hardis-test@example.com');
  await g.addConfig('user.name', 'Hardis Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.addConfig('core.autocrlf', 'false');
  return dir;
}

async function commit(dir: string, file: string, content: string, message: string): Promise<void> {
  await fs.ensureDir(path.dirname(path.join(dir, file)));
  await fs.writeFile(path.join(dir, file), content);
  const g = simpleGit(dir);
  await g.add(file);
  await g.commit(message);
}

describe('backpromote working branch on a real git repository', () => {
  let repo: string;
  let g: SimpleGit;
  const currentBranch = async () => (await g.branchLocal()).current;
  const leave = (branch: string, outcome: 'mergePrepared' | 'deployed' | 'notDeployed', mergedFiles: string[] = []) =>
    leaveBackpromoteBranch({
      branch,
      returnBranch: 'feature/E2E-401-dev',
      parentRef: 'integration',
      outcome,
      mergedFiles,
      commitMessage: 'chore(sfdx-hardis): backpromote merge of ApexClass:PromoE2EAlphaTest from integration',
      listUncommittedFiles: async () => (await g.status()).files.map((file) => file.path),
      commandThis: undefined,
    });

  beforeEach(async () => {
    repo = await makeRepo();
    process.chdir(repo);
    g = simpleGit(repo);
    await commit(repo, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }), 'project');
    await commit(repo, apexClass, baseContent, 'base');
    await g.branch(['-M', 'integration']);
    await g.checkoutLocalBranch('feature/E2E-401-dev');
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.remove(repo).catch(() => null);
  });

  it('tells whether a branch contains the latest commit of its parent branch', async () => {
    expect(isBranchUpToDateWith('integration', 'feature/E2E-401-dev')).to.be.true;
    await g.checkout('integration');
    await commit(repo, apexClass, 'public class PromoE2EAlphaTest { /* incoming */ }\n', 'incoming');
    expect(isBranchUpToDateWith('integration', 'feature/E2E-401-dev')).to.be.false;
    expect(isBranchUpToDateWith('origin/integration', 'feature/E2E-401-dev')).to.be.false;
  });

  it('creates a backpromote branch from the parent branch, not tracking it, and records where to come back', async () => {
    const branch = await createBackpromoteBranch('integration', 'integration', 'feature/E2E-401-dev', undefined);
    expect(branch).to.match(/^backpromote\/integration\/\d{4}-\d{2}-\d{2}-\d{4}$/);
    expect(await currentBranch()).to.equal(branch);
    expect(readBackpromoteBranchInfo(branch)).to.deep.equal({ returnBranch: 'feature/E2E-401-dev', parentBranch: 'integration' });
    expect(readBackpromoteBranchInfo('feature/E2E-401-dev')).to.deep.equal({ returnBranch: null, parentBranch: null });
    const upstream = await g.raw(['config', '--get-regexp', `^branch\\.${branch.replace(/\//g, '\\/')}\\.merge$`]).catch(() => '');
    expect(upstream.trim()).to.equal('');
  });

  it('brings the user back and deletes a backpromote branch holding nothing of its own', async () => {
    const branch = await createBackpromoteBranch('integration', 'integration', 'feature/E2E-401-dev', undefined);
    await leave(branch, 'notDeployed');
    expect(await currentBranch()).to.equal('feature/E2E-401-dev');
    expect((await g.branchLocal()).all).to.not.include(branch);
    expect(readBackpromoteBranchInfo(branch)).to.deep.equal({ returnBranch: null, parentBranch: null });
  });

  it('commits the deployed merged files on the backpromote branch, keeps it, and brings the user back', async () => {
    const branch = await createBackpromoteBranch('integration', 'integration', 'feature/E2E-401-dev', undefined);
    await fs.writeFile(path.join(repo, apexClass), 'public class PromoE2EAlphaTest { /* org */ /* incoming */ }\n');
    await leave(branch, 'deployed', [path.join(repo, apexClass)]);
    expect(await currentBranch()).to.equal('feature/E2E-401-dev');
    expect((await g.branchLocal()).all).to.include(branch);
    expect((await g.log([branch, '-1'])).latest?.message).to.equal('chore(sfdx-hardis): backpromote merge of ApexClass:PromoE2EAlphaTest from integration');
    expect(await fs.readFile(path.join(repo, apexClass), 'utf8')).to.equal(baseContent);
  });

  it('keeps the user on the backpromote branch while a merge is prepared or left uncommitted', async () => {
    const branch = await createBackpromoteBranch('integration', 'integration', 'feature/E2E-401-dev', undefined);
    await leave(branch, 'mergePrepared');
    expect(await currentBranch()).to.equal(branch);
    await fs.writeFile(path.join(repo, apexClass), '<<<<<<< your org\n');
    await leave(branch, 'notDeployed');
    expect(await currentBranch()).to.equal(branch);
    expect((await g.branchLocal()).all).to.include(branch);
  });

  it('reads the package directories of another branch without checking it out or touching the index', async () => {
    await g.checkout('integration');
    await commit(repo, apexClass, 'public class PromoE2EAlphaTest { /* incoming */ }\n', 'incoming');
    await g.checkout('feature/E2E-401-dev');
    const directories = await exportBranchPackageDirectories('integration');
    expect(directories).to.have.length(1);
    expect(directories[0].path).to.equal('force-app');
    expect(await fs.readFile(path.join(directories[0].fullPath, 'main/default/classes/PromoE2EAlphaTest.cls'), 'utf8')).to.equal(
      'public class PromoE2EAlphaTest { /* incoming */ }\n'
    );
    expect(await fs.readFile(path.join(repo, apexClass), 'utf8')).to.equal(baseContent);
    expect((await g.status()).files).to.deep.equal([]);
    expect(await currentBranch()).to.equal('feature/E2E-401-dev');
  });
});
