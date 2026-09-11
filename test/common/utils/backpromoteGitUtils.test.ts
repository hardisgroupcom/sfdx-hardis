/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import { SimpleGit, simpleGit } from 'simple-git';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import fs from '../../../src/common/utils/fsUtils.js';
import {
  abortMerge,
  applyConflictDecision,
  changedFilesBetween,
  clearBackpromoteBase,
  commitAllChanges,
  commitMerge,
  headCommit,
  isAncestor,
  isMergeInProgress,
  listConflictedFiles,
  listFilesWithConflictMarkers,
  listUncommittedFiles,
  mergeBaseOf,
  mergeParentBranch,
  readBackpromoteBase,
  readMergeHead,
  resolveBackpromoteParentRef,
  saveBackpromoteBase,
} from '../../../src/common/utils/backpromoteGitUtils.js';

// The helpers run git in process.cwd(): each test works in a throwaway repository and gives the
// original cwd back
const originalCwd = process.cwd();
const apexClass = 'force-app/main/default/classes/InvoiceCalculator.cls';
const flow = 'force-app/main/default/flows/Quote_Approval.flow-meta.xml';

async function makeRepo(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-backpromote-git-')));
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig('user.email', 'hardis-test@example.com');
  await g.addConfig('user.name', 'Hardis Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.addConfig('core.autocrlf', 'false');
  return dir;
}

async function commit(dir: string, files: Record<string, string>, message: string): Promise<string> {
  const g = simpleGit(dir);
  for (const [file, content] of Object.entries(files)) {
    await fs.ensureDir(path.dirname(path.join(dir, file)));
    await fs.writeFile(path.join(dir, file), content);
    await g.add(file);
  }
  await g.commit(message);
  return (await g.revparse(['HEAD'])).trim();
}

describe('backpromote merge on a real git repository', () => {
  let repo: string;
  let g: SimpleGit;
  let base: string;

  beforeEach(async () => {
    repo = await makeRepo();
    process.chdir(repo);
    g = simpleGit(repo);
    await commit(repo, { 'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }) }, 'project');
    base = await commit(repo, { [apexClass]: 'public class InvoiceCalculator { Decimal scale = 2; }\n', [flow]: '<Flow><label>Quote</label></Flow>\n' }, 'base');
    await g.branch(['-M', 'integration']);
    await g.checkoutLocalBranch('feature/E2E-401-dev');
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.remove(repo).catch(() => null);
  });

  async function teammatesMerge(files: Record<string, string>): Promise<string> {
    await g.checkout('integration');
    const hash = await commit(repo, files, "Merge pull request #482 from acme/feature/quote");
    await g.checkout('feature/E2E-401-dev');
    return hash;
  }

  it('merges without conflict when the sides changed different files, and knows what came in', async () => {
    await commit(repo, { [flow]: '<Flow><label>Quote (mine)</label></Flow>\n' }, 'my work');
    const incoming = await teammatesMerge({ [apexClass]: 'public class InvoiceCalculator { Decimal scale = 4; }\n' });
    expect(isAncestor('integration', 'HEAD')).to.be.false;
    expect(mergeBaseOf('integration', 'HEAD')).to.equal(base);
    expect(changedFilesBetween(base, 'integration')).to.deep.equal([apexClass]);

    const before = headCommit();
    const merge = mergeParentBranch('integration', 'integration');
    expect(merge).to.deep.equal({ conflicted: [], merged: true });
    expect(isMergeInProgress()).to.be.false;
    expect(isAncestor(incoming, 'HEAD')).to.be.true;
    expect(changedFilesBetween(before, 'HEAD')).to.deep.equal([apexClass]);
    expect(await fs.readFile(path.join(repo, apexClass), 'utf8')).to.contain('scale = 4');
  });

  it('overwrites a conflicting file with the parent branch version and commits the merge', async () => {
    await commit(repo, { [apexClass]: 'public class InvoiceCalculator { Decimal scale = 3; }\n' }, 'my work');
    await teammatesMerge({ [apexClass]: 'public class InvoiceCalculator { Decimal scale = 4; }\n' });
    saveBackpromoteBase(headCommit());
    const merge = mergeParentBranch('integration', 'integration');
    expect(merge.merged).to.be.false;
    expect(merge.conflicted).to.deep.equal([apexClass]);
    expect(isMergeInProgress()).to.be.true;
    expect(readMergeHash()).to.equal((await g.revparse(['integration'])).trim());
    expect(readBackpromoteBase()).to.equal((await g.revparse(['HEAD'])).trim());

    applyConflictDecision(apexClass, 'overwrite');
    expect(await fs.readFile(path.join(repo, apexClass), 'utf8')).to.contain('scale = 4');
    commitMerge(merge.conflicted);
    expect(isMergeInProgress()).to.be.false;
    expect((await g.log(['-1'])).latest?.message).to.contain('backpromote integration');
    clearBackpromoteBase();
    expect(readBackpromoteBase()).to.be.null;
  });

  it('keeps the developer version when asked, and leaves the markers for a manual merge', async () => {
    await commit(repo, { [apexClass]: 'public class InvoiceCalculator { Decimal scale = 3; }\n', [flow]: '<Flow><label>Mine</label></Flow>\n' }, 'my work');
    await teammatesMerge({ [apexClass]: 'public class InvoiceCalculator { Decimal scale = 4; }\n', [flow]: '<Flow><label>Theirs</label></Flow>\n' });
    const merge = mergeParentBranch('integration', 'integration');
    expect(merge.conflicted.sort()).to.deep.equal([apexClass, flow].sort());

    applyConflictDecision(apexClass, 'keep');
    applyConflictDecision(flow, 'merge');
    expect(await fs.readFile(path.join(repo, apexClass), 'utf8')).to.contain('scale = 3');
    const withMarkers = await listFilesWithConflictMarkers(merge.conflicted);
    expect(withMarkers).to.deep.equal([{ path: flow, conflictBlocks: 1 }]);
    expect(listConflictedFiles()).to.deep.equal([flow]);

    // The developer solves the flow by hand, then the merge is committed
    await fs.writeFile(path.join(repo, flow), '<Flow><label>Mine and theirs</label></Flow>\n');
    expect(await listFilesWithConflictMarkers(merge.conflicted)).to.deep.equal([]);
    commitMerge(merge.conflicted);
    expect(isMergeInProgress()).to.be.false;
    expect(await fs.readFile(path.join(repo, flow), 'utf8')).to.contain('Mine and theirs');
  });

  it('gives the branch back when the merge is abandoned', async () => {
    await commit(repo, { [apexClass]: 'public class InvoiceCalculator { Decimal scale = 3; }\n' }, 'my work');
    const before = headCommit();
    await teammatesMerge({ [apexClass]: 'public class InvoiceCalculator { Decimal scale = 4; }\n' });
    saveBackpromoteBase(before);
    mergeParentBranch('integration', 'integration');
    abortMerge();
    clearBackpromoteBase();
    expect(isMergeInProgress()).to.be.false;
    expect(headCommit()).to.equal(before);
    expect(await fs.readFile(path.join(repo, apexClass), 'utf8')).to.contain('scale = 3');
    expect(await listUncommittedFiles()).to.deep.equal([]);
  });

  it('saves every change of the working tree in one commit, and reports nothing when clean', async () => {
    expect(await commitAllChanges('nothing')).to.deep.equal([]);
    await fs.writeFile(path.join(repo, flow), '<Flow><label>From the org</label></Flow>\n');
    await fs.ensureDir(path.join(repo, 'hardis-report'));
    await fs.writeFile(path.join(repo, 'hardis-report', 'backpromote-merge-prompt.md'), '# prompt\n');
    // The reports sfdx-hardis writes are not user changes
    expect(await listUncommittedFiles()).to.deep.equal([flow]);
    expect(await commitAllChanges('chore: save org changes')).to.deep.equal([flow]);
    expect((await g.status()).files.map((file) => file.path)).to.not.include(flow);
  });

  it('reads the parent branch from origin when the remote-tracking branch exists', async () => {
    await g.raw(['update-ref', 'refs/remotes/origin/integration', 'integration']);
    expect(resolveBackpromoteParentRef('integration')).to.equal('origin/integration');
    expect(resolveBackpromoteParentRef('uat')).to.equal('uat');
  });

  function readMergeHash(): string | null {
    return readMergeHead();
  }
});
