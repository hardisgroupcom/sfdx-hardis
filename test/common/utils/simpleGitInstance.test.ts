/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from '../../../src/common/utils/fsUtils.js';
import * as os from 'os';
import * as path from 'path';
import { simpleGit } from 'simple-git';
import { git } from '../../../src/common/utils/index.js';
import { createSimpleGit } from '../../../src/common/utils/simpleGitInstance.js';

// simple-git v4 removes inherited GIT_* variables (and EDITOR, VISUAL, PAGER, SSH_ASKPASS, PREFIX)
// from the git process unless they are allowed. These tests run real git in throwaway repositories
// and check that git() still passes them through, as simple-git v3 did, with the guards still on.

const originalCwd = process.cwd();
const sandboxes: string[] = [];

// Variables a test sets in process.env, removed afterwards
const testEnv: Record<string, string> = {
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'hardis.inherited',
  GIT_CONFIG_VALUE_0: 'from-ci-runner',
  // An alias printing the environment git gives to its child processes
  GIT_CONFIG_KEY_1: 'alias.hardis-env',
  GIT_CONFIG_VALUE_1: '!env',
  GIT_ASKPASS: 'hardis-askpass-test',
  SSH_ASKPASS: 'hardis-ssh-askpass-test',
  GIT_SSL_CAINFO: 'hardis-ca-test.pem',
  GIT_EDITOR: 'hardis-editor-test',
  GIT_PAGER: 'hardis-pager-test',
};

async function makeSandbox(name: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), `hardis-${name}-`));
  const real = await fs.realpath(raw);
  sandboxes.push(real);
  return real;
}

async function initRepo(dir: string): Promise<void> {
  const g = createSimpleGit(dir);
  await g.init();
  await g.addConfig('user.email', 'hardis-test@example.com');
  await g.addConfig('user.name', 'Hardis Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.checkoutLocalBranch('main');
}

async function writeAndCommit(dir: string, file: string, content: string, message: string): Promise<void> {
  await fs.writeFile(path.join(dir, file), content);
  const g = createSimpleGit(dir);
  await g.add([file]);
  await g.commit(message);
}

describe('simple-git instances (createSimpleGit, git())', function () {
  this.timeout(60000);

  afterEach(async () => {
    process.chdir(originalCwd);
    for (const key of Object.keys(testEnv)) {
      delete process.env[key];
    }
    for (const dir of sandboxes.splice(0)) {
      await fs.remove(dir).catch(() => undefined);
    }
  });

  describe('inherited environment', () => {
    beforeEach(async () => {
      const repo = await makeSandbox('sg-env');
      await initRepo(repo);
      process.chdir(repo);
      Object.assign(process.env, testEnv);
    });

    it('passes GIT_CONFIG_COUNT/KEY/VALUE set by a CI runner to git()', async () => {
      const value = await git({ output: false, displayCommand: false }).raw(['config', '--get', 'hardis.inherited']);
      expect(value.trim()).to.equal('from-ci-runner');
    });

    it('passes GIT_ASKPASS, SSH_ASKPASS and GIT_SSL_CAINFO to git and its child processes', async () => {
      const envOutput = await git({ output: false, displayCommand: false }).raw(['hardis-env']);
      expect(envOutput).to.include('GIT_ASKPASS=hardis-askpass-test');
      expect(envOutput).to.include('SSH_ASKPASS=hardis-ssh-askpass-test');
      expect(envOutput).to.include('GIT_SSL_CAINFO=hardis-ca-test.pem');
    });

    it('passes GIT_EDITOR and GIT_PAGER, read back by git var', async () => {
      const editor = await git({ output: false, displayCommand: false }).raw(['var', 'GIT_EDITOR']);
      expect(editor.trim()).to.equal('hardis-editor-test');
      const pager = await git({ output: false, displayCommand: false }).raw(['var', 'GIT_PAGER']);
      expect(pager.trim()).to.equal('hardis-pager-test');
    });

    it('a bare simple-git instance does not see them: createSimpleGit is what keeps them', async () => {
      const value = await simpleGit(process.cwd())
        .raw(['config', '--get', 'hardis.inherited'])
        .catch(() => '');
      expect(value.trim()).to.equal('');
    });
  });

  describe('guards kept on', () => {
    let repo: string;
    beforeEach(async () => {
      repo = await makeSandbox('sg-guards');
      await initRepo(repo);
      await writeAndCommit(repo, 'a.txt', 'a\n', 'first');
    });

    it('refuses an abbreviated long option', async () => {
      let error: any = null;
      await createSimpleGit(repo)
        .raw(['log', '--max-c=1'])
        .catch((e) => (error = e));
      expect(error).to.not.equal(null);
    });

    it('refuses an unsafe config key unless the call allows it', async () => {
      let error: any = null;
      await createSimpleGit(repo)
        .addConfig('difftool.vscode.cmd', 'code --wait --diff $LOCAL $REMOTE')
        .catch((e) => (error = e));
      expect(error?.message || '').to.include('allowUnsafeDiffExternal');

      await createSimpleGit(repo, { allowUnsafeDiffExternal: true }).addConfig('difftool.vscode.cmd', 'code --wait --diff $LOCAL $REMOTE');
      const value = await createSimpleGit(repo).raw(['config', '--get', 'difftool.vscode.cmd']);
      expect(value.trim()).to.equal('code --wait --diff $LOCAL $REMOTE');
    });
  });

  describe('git operations sfdx-hardis runs', () => {
    it('init, add, commit, log, diff, branch, merge, reset, tag and status work', async () => {
      const repo = await makeSandbox('sg-ops');
      await initRepo(repo);
      await writeAndCommit(repo, 'a.txt', 'a\n', 'first');
      process.chdir(repo);
      const g = git({ output: false, displayCommand: false });

      // A feature branch with one commit, merged back with the options deployment and promotion use
      await g.checkoutLocalBranch('feature/one');
      await writeAndCommit(repo, 'b.txt', 'b\n', 'add b');
      await g.checkout('main');
      await writeAndCommit(repo, 'a.txt', 'a\nchanged\n', 'change a');
      await g.merge(['--no-ff', '--no-edit', '-m', 'Merge feature/one', 'feature/one']);

      const log = await g.log(['--first-parent', '-n', '5', 'main']);
      expect(log.all.map((c) => c.message)).to.deep.equal(['Merge feature/one', 'change a', 'first']);
      const latest = log.latest!;
      const parents = (await g.raw(['rev-list', '--parents', '-n', '1', latest.hash])).trim().split(/\s+/);
      expect(parents).to.have.length(3);

      const diffNames = await g.diff(['--name-only', 'HEAD~1', 'HEAD']);
      expect(diffNames.trim()).to.equal('b.txt');
      const summary = await g.diffSummary(['HEAD~2', 'HEAD']);
      expect(summary.files.map((f) => f.file).sort()).to.deep.equal(['a.txt', 'b.txt']);

      const branches = await g.branch(['-v']);
      expect(branches.all).to.include.members(['main', 'feature/one']);
      expect(branches.current).to.equal('main');
      expect((await g.revparse(['--abbrev-ref', 'HEAD'])).trim()).to.equal('main');
      expect((await g.revparse(['--show-toplevel'])).trim()).to.not.equal('');

      await g.addTag('v1.0.0');
      const tags = await g.tags(['--sort=-v:refname']);
      expect(tags.all).to.deep.equal(['v1.0.0']);

      await fs.writeFile(path.join(repo, 'c.txt'), 'c\n');
      const status = await g.status();
      expect(status.not_added).to.deep.equal(['c.txt']);
      await g.raw(['add', '--all', '--', '.']);
      await g.commit('add c', ['--no-verify']);
      await g.reset(['--soft', 'HEAD~1']);
      expect((await g.status()).staged).to.deep.equal(['c.txt']);

      const isAncestor = await g
        .raw(['merge-base', '--is-ancestor', 'feature/one', 'HEAD'])
        .then(() => true)
        .catch(() => false);
      expect(isAncestor).to.be.true;
    });
  });
});
