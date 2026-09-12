/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import { SimpleGit, simpleGit } from 'simple-git';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import fs from '../../../src/common/utils/fsUtils.js';
import {
  changedFilesBetween,
  checkoutBackpromoteBranch,
  collectItemFiles,
  commitAllChanges,
  commitFiles,
  commitsTouchingFiles,
  currentBranchName,
  deleteBackpromoteBranch,
  fetchOrigin,
  fileAtRef,
  headCommit,
  inspectBackpromoteBranch,
  isAncestor,
  listFilesWithConflictMarkers,
  listUncommittedFiles,
  pushBackpromoteBranch,
  remoteBranchExists,
  resolveBackpromoteParentRef,
  resolveFilesToMetadataKeys,
  revParse,
  stashWorkingTree,
  writeMergedFile,
} from '../../../src/common/utils/backpromoteGitUtils.js';
import { countConflictMarkerBlocks } from '../../../src/common/utils/backpromoteRules.js';

// The helpers run git in process.cwd(): each test works in a throwaway repository and gives the
// original cwd back
const originalCwd = process.cwd();
const apexClass = 'force-app/main/default/classes/InvoiceCalculator.cls';
const layout = 'force-app/main/default/layouts/Case-Case Layout.layout-meta.xml';
const lwcFile = 'force-app/main/default/lwc/card/card.js';
const lwcMeta = 'force-app/main/default/lwc/card/card.js-meta.xml';
const BRANCH = 'backpromote/integration/dev1';

async function makeRepo(): Promise<{ work: string; origin: string }> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-backpromote-git-')));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  await fs.ensureDir(origin);
  await simpleGit(origin).init(true);
  await fs.ensureDir(work);
  const g = simpleGit(work);
  await g.init();
  await g.addConfig('user.email', 'hardis-test@example.com');
  await g.addConfig('user.name', 'Hardis Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.addConfig('core.autocrlf', 'false');
  await g.addRemote('origin', origin);
  return { work, origin };
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

describe('backpromote branch on a real git repository', () => {
  let repo: string;
  let g: SimpleGit;
  let parentHead: string;

  beforeEach(async () => {
    const made = await makeRepo();
    repo = made.work;
    g = simpleGit(repo);
    await commit(repo, { 'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }) }, 'project');
    await g.branch(['-M', 'integration']);
    await commit(repo, { [apexClass]: 'public class InvoiceCalculator { Decimal scale = 2; }\n', [layout]: '<Layout><a/><z/></Layout>\n' }, 'base');
    parentHead = await commit(repo, { [apexClass]: 'public class InvoiceCalculator { Decimal scale = 3; }\n', [lwcFile]: 'export default class Card {}\n', [lwcMeta]: '<LightningComponentBundle/>\n' }, "Merge pull request #482 from acme/feature/quote");
    await g.push(['-u', 'origin', 'integration']);
    await g.checkout(['-b', 'feature/my-story', 'integration~1']);
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('reads the parent branch from origin, and knows the backpromote branch does not exist yet', () => {
    fetchOrigin();
    expect(resolveBackpromoteParentRef('integration')).to.equal('origin/integration');
    expect(revParse('origin/integration')).to.equal(parentHead);
    expect(remoteBranchExists(BRANCH)).to.be.false;
    expect(inspectBackpromoteBranch(BRANCH, 'origin/integration')).to.deep.equal({ name: BRANCH, existsOnOrigin: false, head: null, pendingMerges: [] });
    expect(isAncestor(parentHead, 'HEAD')).to.be.false;
    expect(changedFilesBetween(`${parentHead}^1`, parentHead)).to.deep.equal([apexClass, lwcFile, lwcMeta]);
    expect(fileAtRef('origin/integration', apexClass)).to.contain('scale = 3');
    expect(fileAtRef('origin/integration', 'nope.txt')).to.be.null;
    expect(commitsTouchingFiles(`${parentHead}^1`, parentHead, [lwcFile])).to.deep.equal([parentHead]);
  });

  it('creates the backpromote branch from the parent head, commits a merge on it and pushes it with a lease', async () => {
    fetchOrigin();
    const carried = checkoutBackpromoteBranch(BRANCH, 'origin/integration');
    expect(carried).to.deep.equal({ droppedMerges: [], carriedCommits: 0 });
    expect(currentBranchName()).to.equal(BRANCH);
    expect(headCommit()).to.equal(parentHead);
    await fs.writeFile(path.join(repo, apexClass), 'public class InvoiceCalculator { Decimal scale = 3; String merged = "yes"; }\n');
    const mergeCommit = commitFiles([apexClass], 'chore(sfdx-hardis): backpromote merges for dev1 from integration\n\n- ' + apexClass);
    expect(mergeCommit).to.not.equal(parentHead);
    expect(pushBackpromoteBranch(BRANCH)).to.deep.equal({ pushed: true, rejected: false, error: null });
    expect(inspectBackpromoteBranch(BRANCH, 'origin/integration')).to.deep.equal({ name: BRANCH, existsOnOrigin: true, head: mergeCommit, pendingMerges: [apexClass] });
  });

  it('carries the pending merges over a new parent head, and drops the ones the parent changed again', async () => {
    fetchOrigin();
    checkoutBackpromoteBranch(BRANCH, 'origin/integration');
    await fs.writeFile(path.join(repo, apexClass), 'public class InvoiceCalculator { Decimal scale = 3; String merged = "yes"; }\n');
    commitFiles([apexClass], 'merge of the class');
    await fs.writeFile(path.join(repo, layout), '<Layout><a/><merged/><z/></Layout>\n');
    commitFiles([layout], 'merge of the layout');
    pushBackpromoteBranch(BRANCH);
    // The parent branch moves on: the class changes again (the merge is stale), the layout does not
    await g.checkout('integration');
    const newParentHead = await commit(repo, { [apexClass]: 'public class InvoiceCalculator { Decimal scale = 4; }\n' }, "Merge pull request #483 from acme/feature/scale");
    await g.push('origin', 'integration');
    await g.checkout('feature/my-story');
    fetchOrigin();
    const carried = checkoutBackpromoteBranch(BRANCH, 'origin/integration');
    expect(carried.carriedCommits).to.equal(1);
    expect(carried.droppedMerges).to.deep.equal([apexClass]);
    expect(isAncestor(newParentHead, 'HEAD')).to.be.true;
    expect(await fs.readFile(path.join(repo, layout), 'utf8')).to.contain('<merged/>');
    expect(await fs.readFile(path.join(repo, apexClass), 'utf8')).to.contain('scale = 4');
    expect(countConflictMarkerBlocks(await fs.readFile(path.join(repo, apexClass), 'utf8'))).to.equal(0);
  });

  it('writes a three-way merge with git merge-file and a two-way merge with markers, and lists the files left with markers', async () => {
    const threeWay = await writeMergedFile({
      absolutePath: path.join(repo, layout),
      baseContent: '<Layout><a/><z/></Layout>\n',
      sandboxContent: '<Layout><a/><fromOrg/><z/></Layout>\n',
      parentContent: '<Layout><a/><fromGit/><z/></Layout>\n',
      labels: { sandbox: 'sandbox dev1', parent: 'integration', base: 'base' },
    });
    expect(threeWay.threeWay).to.be.true;
    expect(threeWay.conflictBlocks).to.equal(1);
    const content = await fs.readFile(path.join(repo, layout), 'utf8');
    expect(content).to.contain('<<<<<<< sandbox dev1');
    expect(content).to.contain('>>>>>>> integration');
    // diff3 style: whoever solves the merge must see what both sides started from
    expect(content).to.contain('||||||| base');
    expect(content).to.contain('<z/>');
    const clean = await writeMergedFile({
      absolutePath: path.join(repo, apexClass),
      baseContent: 'a\nb\nc\nd\ne\n',
      sandboxContent: 'a\nB\nc\nd\ne\n',
      parentContent: 'a\nb\nc\nd\nE\n',
      labels: { sandbox: 'sandbox dev1', parent: 'integration', base: 'base' },
    });
    expect(clean).to.deep.equal({ conflictBlocks: 0, threeWay: true });
    expect(await fs.readFile(path.join(repo, apexClass), 'utf8')).to.equal('a\nB\nc\nd\nE\n');
    const twoWay = await writeMergedFile({
      absolutePath: path.join(repo, lwcFile),
      baseContent: null,
      sandboxContent: 'export default class Card { org = 1; }\n',
      parentContent: 'export default class Card { git = 1; }\n',
      labels: { sandbox: 'sandbox dev1', parent: 'integration', base: 'base' },
    });
    expect(twoWay).to.deep.equal({ conflictBlocks: 1, threeWay: false });
    expect(await listFilesWithConflictMarkers([layout, apexClass, lwcFile, 'missing.txt'])).to.deep.equal([
      { path: layout, conflictBlocks: 1 },
      { path: lwcFile, conflictBlocks: 1 },
    ]);
  });

  it('stashes a dirty working tree under a message, and commits everything when asked', async () => {
    await fs.writeFile(path.join(repo, layout), '<Layout>dirty</Layout>\n');
    await fs.writeFile(path.join(repo, 'notes.txt'), 'untracked\n');
    expect(await listUncommittedFiles()).to.have.members([layout, 'notes.txt']);
    expect(stashWorkingTree('sfdx-hardis backpromote 7f3a from feature/my-story')).to.be.true;
    expect(await listUncommittedFiles()).to.deep.equal([]);
    expect((await g.stashList()).all[0].message).to.contain('sfdx-hardis backpromote 7f3a from feature/my-story');
    await g.stash(['pop']);
    const committed = await commitAllChanges('WIP');
    expect(committed).to.have.members([layout, 'notes.txt']);
    expect(await commitAllChanges('nothing')).to.deep.equal([]);
  });

  it('deletes the backpromote branch on origin and locally, leaving it first when it is checked out', () => {
    fetchOrigin();
    checkoutBackpromoteBranch(BRANCH, 'origin/integration');
    pushBackpromoteBranch(BRANCH);
    fetchOrigin();
    expect(remoteBranchExists(BRANCH)).to.be.true;
    const deleted = deleteBackpromoteBranch(BRANCH, 'origin/integration');
    expect(deleted).to.deep.equal({ deletedOnOrigin: true, deletedLocally: true });
    fetchOrigin();
    expect(remoteBranchExists(BRANCH)).to.be.false;
    expect(currentBranchName()).to.equal('HEAD');
  });

  it('resolves files to metadata items with the Salesforce registry, and collects whole bundles at the parent head', () => {
    const keys = resolveFilesToMetadataKeys([apexClass, lwcFile, 'force-app/main/default/objects/Account/fields/X__c.field-meta.xml', 'README.md']);
    expect(keys.get(apexClass)).to.deep.equal(['ApexClass:InvoiceCalculator']);
    expect(keys.get(lwcFile)).to.deep.equal(['LightningComponentBundle:card']);
    expect(keys.get('force-app/main/default/objects/Account/fields/X__c.field-meta.xml')).to.deep.equal(['CustomField:Account.X__c']);
    expect(keys.has('README.md')).to.be.false;
    fetchOrigin();
    const files = collectItemFiles(['ApexClass:InvoiceCalculator', 'LightningComponentBundle:card'], [apexClass, lwcFile], 'origin/integration');
    expect(files.get('ApexClass:InvoiceCalculator')).to.deep.equal([apexClass]);
    expect(files.get('LightningComponentBundle:card')).to.deep.equal([lwcFile, lwcMeta]);
  });
});
