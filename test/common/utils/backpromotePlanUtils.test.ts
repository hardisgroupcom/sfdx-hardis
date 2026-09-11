/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import { simpleGit } from 'simple-git';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import fs from '../../../src/common/utils/fsUtils.js';
import { listFilesWithConflictMarkers, listUncommittedFiles, prepareBackpromoteMerge } from '../../../src/common/utils/backpromotePlanUtils.js';

// prepareBackpromoteMerge and listUncommittedFiles read git from process.cwd(): each test works in
// a throwaway repository and gives the original cwd back.
const originalCwd = process.cwd();

async function makeRepo(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-backpromote-')));
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig('user.email', 'hardis-test@example.com');
  await g.addConfig('user.name', 'Hardis Test');
  await g.addConfig('commit.gpgsign', 'false');
  return dir;
}

async function commit(dir: string, file: string, content: string, message: string): Promise<string> {
  await fs.ensureDir(path.dirname(path.join(dir, file)));
  await fs.writeFile(path.join(dir, file), content);
  const g = simpleGit(dir);
  await g.add(file);
  await g.commit(message);
  return (await g.revparse(['HEAD'])).trim();
}

const flow = (lines: string[]) => ['<?xml version="1.0" encoding="UTF-8"?>', '<Flow>', ...lines, '</Flow>', ''].join('\n');

describe('prepareBackpromoteMerge() on a real git repository', () => {
  let repo: string;
  const file = 'force-app/main/default/flows/Quote_Approval.flow-meta.xml';

  beforeEach(async () => {
    repo = await makeRepo();
    process.chdir(repo);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.remove(repo).catch(() => null);
  });

  it('merges without markers when the org and the parent branch changed different lines', async () => {
    const base = await commit(repo, file, flow(['  <label>Quote Approval</label>', '  <status>Draft</status>', '  <threshold>1000</threshold>']), 'base');
    await commit(repo, file, flow(['  <label>Quote Approval</label>', '  <status>Draft</status>', '  <threshold>5000</threshold>']), 'incoming');
    const orgFile = path.join(repo, 'org.flow-meta.xml');
    await fs.writeFile(orgFile, flow(['  <label>Quote Approval (sandbox)</label>', '  <status>Draft</status>', '  <threshold>1000</threshold>']));

    const result = await prepareBackpromoteMerge({ key: 'Flow:Quote_Approval', localPath: file, orgPath: orgFile, baseCommit: base, parentBranch: 'integration' });

    expect(result.conflictBlocks).to.equal(0);
    expect(result.localPath).to.equal(file);
    expect(result.basePath).to.contain(file);
    const merged = await fs.readFile(path.join(repo, file), 'utf8');
    expect(merged).to.contain('<label>Quote Approval (sandbox)</label>');
    expect(merged).to.contain('<threshold>5000</threshold>');
    expect(result.originalContent).to.contain('<label>Quote Approval</label>');
  });

  it('writes labelled conflict markers when both sides changed the same line, and keeps CRLF files CRLF', async () => {
    const crlf = (content: string) => content.replace(/\n/g, '\r\n');
    const base = await commit(repo, file, crlf(flow(['  <threshold>1000</threshold>'])), 'base');
    await commit(repo, file, crlf(flow(['  <threshold>5000</threshold>'])), 'incoming');
    const orgFile = path.join(repo, 'org.flow-meta.xml');
    // Retrieved files come back with LF: the merge must not see a whole-file conflict because of it
    await fs.writeFile(orgFile, flow(['  <threshold>2000</threshold>']));

    const result = await prepareBackpromoteMerge({ key: 'Flow:Quote_Approval', localPath: file, orgPath: orgFile, baseCommit: base, parentBranch: 'integration' });

    expect(result.conflictBlocks).to.equal(1);
    const merged = await fs.readFile(path.join(repo, file), 'utf8');
    expect(merged).to.contain('<<<<<<< your org\r\n  <threshold>2000</threshold>');
    expect(merged).to.contain('||||||| last backpromoted\r\n  <threshold>1000</threshold>');
    expect(merged).to.contain('>>>>>>> integration');
    expect(merged.replace(/\r\n/g, '')).to.not.contain('\n');
    expect(await listFilesWithConflictMarkers([path.join(repo, file)])).to.deep.equal([`${file} (1)`]);
  });

  it('only reports the uncommitted files that are not allowed, never the reports sfdx-hardis wrote', async () => {
    await commit(repo, file, flow(['  <threshold>1000</threshold>']), 'base');
    await commit(repo, 'README.md', '# repo\n', 'readme');
    await fs.writeFile(path.join(repo, file), flow(['  <threshold>merged</threshold>']));
    await fs.writeFile(path.join(repo, 'README.md'), '# changed\n');
    await fs.ensureDir(path.join(repo, 'hardis-report'));
    await fs.writeFile(path.join(repo, 'hardis-report', 'backpromote-merge-prompt.md'), '# prompt\n');

    expect(await listUncommittedFiles([path.join(repo, file)])).to.deep.equal(['README.md']);
    expect((await listUncommittedFiles([])).sort()).to.deep.equal(['README.md', file].sort());
  });
});
