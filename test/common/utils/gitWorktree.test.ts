/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import {
  listGitWorktrees,
  getBranchWorktreePath,
  assertBranchNotInOtherWorktree,
  createWorkBranchFromTarget,
} from '../../../src/common/utils/index.js';
import { getGitDeltaScope } from '../../../src/common/utils/gitUtils.js';

// These tests exercise the git-worktree-aware branch logic against real, throwaway git
// repositories. The functions under test (git(), getGitRepoRoot(), gitFetch()) operate on
// process.cwd(), so each test chdir's into a temp repo and restores the original cwd afterwards.

const originalCwd = process.cwd();
const sandboxes: string[] = [];

async function makeSandbox(name: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), `hardis-${name}-`));
  // realpath so our path assertions match what git reports (tmp dirs may be symlinked/8.3 names)
  const real = await fs.realpath(raw);
  sandboxes.push(real);
  return real;
}

async function initRepo(dir: string): Promise<SimpleGit> {
  await fs.ensureDir(dir);
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig('user.email', 'hardis-test@example.com');
  await g.addConfig('user.name', 'Hardis Test');
  await g.addConfig('commit.gpgsign', 'false');
  return g;
}

async function commitFile(dir: string, file: string, content: string, message: string): Promise<string> {
  await fs.writeFile(path.join(dir, file), content);
  const g = simpleGit(dir);
  await g.add('.');
  await g.commit(message);
  return (await g.revparse(['HEAD'])).trim();
}

// Build a repo named "work" with a "main" branch pushed to a local bare "origin".
async function setupWithOrigin(base: string): Promise<{ originDir: string; workDir: string; mainTip: string; g: SimpleGit }> {
  const originDir = path.join(base, 'origin.git');
  await fs.ensureDir(originDir);
  await simpleGit(originDir).raw(['init', '--bare']);

  const workDir = path.join(base, 'work');
  const g = await initRepo(workDir);
  const mainTip = await commitFile(workDir, 'README.md', '# test\n', 'chore: initial commit');
  await g.raw(['branch', '-M', 'main']);
  await g.addRemote('origin', originDir.replace(/\\/g, '/'));
  await g.raw(['push', '-u', 'origin', 'main']);
  return { originDir, workDir, mainTip, g };
}

// Build a repo with a local "main" branch and an origin remote that has NO branches yet
// (nothing pushed). Fetching a branch then fails with a plain "couldn't find remote ref"
// rather than an auth-style error, so the local-ref fallback path can be tested without
// tripping gitFetch's interactive credential prompt.
async function setupWithEmptyOrigin(base: string): Promise<{ workDir: string; mainTip: string; g: SimpleGit }> {
  const originDir = path.join(base, 'origin.git');
  await fs.ensureDir(originDir);
  await simpleGit(originDir).raw(['init', '--bare']);

  const workDir = path.join(base, 'work');
  const g = await initRepo(workDir);
  const mainTip = await commitFile(workDir, 'README.md', '# test\n', 'chore: initial commit');
  await g.raw(['branch', '-M', 'main']);
  await g.addRemote('origin', originDir.replace(/\\/g, '/')); // remote exists, but nothing pushed
  return { workDir, mainTip, g };
}

async function currentBranch(dir: string): Promise<string> {
  return (await simpleGit(dir).revparse(['--abbrev-ref', 'HEAD'])).trim();
}

async function headHash(dir: string): Promise<string> {
  return (await simpleGit(dir).revparse(['HEAD'])).trim();
}

afterEach(async () => {
  process.chdir(originalCwd);
  while (sandboxes.length) {
    const dir = sandboxes.pop();
    if (dir) {
      // best-effort: leftover git worktree handles on Windows can briefly lock files
      try {
        await fs.remove(dir);
      } catch {
        /* ignore cleanup failures */
      }
    }
  }
});

describe('listGitWorktrees()', () => {
  it('returns the main worktree with its branch and path', async () => {
    const base = await makeSandbox('wt-list');
    const { workDir } = await setupWithOrigin(base);
    process.chdir(workDir);

    const worktrees = await listGitWorktrees();
    expect(worktrees).to.have.lengthOf(1);
    expect(worktrees[0].branch).to.equal('main');
    expect(path.resolve(worktrees[0].path)).to.equal(path.resolve(workDir));
    expect(worktrees[0].head).to.be.a('string').with.length.greaterThan(0);
  });

  it('lists every attached worktree with its checked-out branch', async () => {
    const base = await makeSandbox('wt-list-multi');
    const { workDir } = await setupWithOrigin(base);
    const linkedDir = path.join(base, 'linked');
    await simpleGit(workDir).raw(['worktree', 'add', '-b', 'feature/linked', linkedDir, 'main']);
    process.chdir(workDir);

    const worktrees = await listGitWorktrees();
    const branches = worktrees.map((w) => w.branch).sort();
    expect(branches).to.deep.equal(['feature/linked', 'main']);
    const linked = worktrees.find((w) => w.branch === 'feature/linked');
    expect(linked, 'linked worktree should be listed').to.not.be.undefined;
    expect(path.resolve(linked!.path)).to.equal(path.resolve(linkedDir));
  });

  it('leaves branch undefined for a detached-HEAD worktree', async () => {
    const base = await makeSandbox('wt-detached');
    const { workDir, mainTip } = await setupWithOrigin(base);
    const detachedDir = path.join(base, 'detached');
    await simpleGit(workDir).raw(['worktree', 'add', '--detach', detachedDir, mainTip]);
    process.chdir(workDir);

    const worktrees = await listGitWorktrees();
    const detached = worktrees.find((w) => path.resolve(w.path) === path.resolve(detachedDir));
    expect(detached, 'detached worktree should be listed').to.not.be.undefined;
    expect(detached!.branch).to.be.undefined;
    expect(detached!.head).to.equal(mainTip);
  });
});

describe('getBranchWorktreePath()', () => {
  it('returns null for a branch checked out in the current worktree', async () => {
    const base = await makeSandbox('wt-path-current');
    const { workDir } = await setupWithOrigin(base);
    process.chdir(workDir);

    expect(await getBranchWorktreePath('main')).to.be.null;
  });

  it('returns the path of another worktree where the branch is checked out', async () => {
    const base = await makeSandbox('wt-path-other');
    const { workDir } = await setupWithOrigin(base);
    const linkedDir = path.join(base, 'linked');
    await simpleGit(workDir).raw(['worktree', 'add', '-b', 'feature/elsewhere', linkedDir, 'main']);
    process.chdir(workDir);

    const result = await getBranchWorktreePath('feature/elsewhere');
    expect(result, 'branch checked out elsewhere should resolve to a path').to.not.be.null;
    expect(path.resolve(result!)).to.equal(path.resolve(linkedDir));
  });

  it('returns null for a branch that is not checked out anywhere', async () => {
    const base = await makeSandbox('wt-path-none');
    const { workDir, g } = await setupWithOrigin(base);
    await g.raw(['branch', 'feature/unused', 'main']); // exists but checked out nowhere
    process.chdir(workDir);

    expect(await getBranchWorktreePath('feature/unused')).to.be.null;
    expect(await getBranchWorktreePath('does-not-exist')).to.be.null;
  });
});

describe('assertBranchNotInOtherWorktree()', () => {
  it('resolves silently when the branch is free or checked out in the current worktree', async () => {
    const base = await makeSandbox('assert-free');
    const { workDir, g } = await setupWithOrigin(base);
    await g.raw(['branch', 'feature/free', 'main']); // exists but checked out nowhere
    process.chdir(workDir);

    // main is checked out here (current worktree) => allowed; feature/free is free => allowed
    await assertBranchNotInOtherWorktree('main');
    await assertBranchNotInOtherWorktree('feature/free');
    await assertBranchNotInOtherWorktree('does-not-exist');
  });

  it('throws a clear worktree error when the branch is checked out in another worktree', async () => {
    const base = await makeSandbox('assert-busy');
    const { workDir, g } = await setupWithOrigin(base);
    const linkedDir = path.join(base, 'linked');
    await g.raw(['worktree', 'add', '-b', 'feature/busy', linkedDir, 'main']);
    process.chdir(workDir);

    let err: Error | undefined;
    try {
      await assertBranchNotInOtherWorktree('feature/busy');
    } catch (e) {
      err = e as Error;
    }
    expect(err, 'expected assertBranchNotInOtherWorktree to throw').to.be.instanceOf(Error);
    expect(err!.message).to.match(/worktree/i);
    expect(err!.message).to.contain('feature/busy');
  });
});

describe('createWorkBranchFromTarget()', () => {
  it('creates the new branch from origin/<target> with no upstream tracking', async () => {
    const base = await makeSandbox('cwbft-new');
    const { workDir, mainTip } = await setupWithOrigin(base);
    process.chdir(workDir);

    await createWorkBranchFromTarget('feature/new', 'main');

    expect(await currentBranch(workDir)).to.equal('feature/new');
    expect(await headHash(workDir)).to.equal(mainTip);
    // --no-track => the branch must not have an upstream until work:save pushes it with -u
    const upstream = (
      await simpleGit(workDir).raw(['for-each-ref', '--format=%(upstream)', 'refs/heads/feature/new'])
    ).trim();
    expect(upstream).to.equal('');
  });

  it('creates the branch even when the target branch is checked out in another worktree', async () => {
    const base = await makeSandbox('cwbft-target-busy');
    const { workDir, mainTip, g } = await setupWithOrigin(base);
    // Move off main, then check main out in a separate worktree (the scenario this change fixes)
    await g.checkout(['-b', 'scratch']);
    const linkedDir = path.join(base, 'linked');
    await g.raw(['worktree', 'add', linkedDir, 'main']);
    process.chdir(workDir);

    await createWorkBranchFromTarget('feature/from-busy-target', 'main');

    expect(await currentBranch(workDir)).to.equal('feature/from-busy-target');
    expect(await headHash(workDir)).to.equal(mainTip);
  });

  it('refuses when the work branch is already checked out in another worktree', async () => {
    const base = await makeSandbox('cwbft-dup');
    const { workDir, g } = await setupWithOrigin(base);
    const linkedDir = path.join(base, 'linked');
    await g.raw(['worktree', 'add', '-b', 'feature/dup', linkedDir, 'main']);
    process.chdir(workDir);

    let err: Error | undefined;
    try {
      await createWorkBranchFromTarget('feature/dup', 'main');
    } catch (e) {
      err = e as Error;
    }
    expect(err, 'expected createWorkBranchFromTarget to throw').to.be.instanceOf(Error);
    expect(err!.message).to.match(/worktree/i);
    // It must not have switched the current worktree away from its branch
    expect(await currentBranch(workDir)).to.equal('main');
  });

  it('resumes an existing local branch instead of recreating it from the target', async () => {
    const base = await makeSandbox('cwbft-resume-local');
    const { workDir, mainTip, g } = await setupWithOrigin(base);
    await g.checkout(['-b', 'feature/resume', 'main']);
    const resumeTip = await commitFile(workDir, 'work.txt', 'in progress\n', 'feat: wip');
    await g.checkout('main');
    process.chdir(workDir);

    await createWorkBranchFromTarget('feature/resume', 'main');

    expect(await currentBranch(workDir)).to.equal('feature/resume');
    // Resumed at its own tip, NOT reset to the target tip
    expect(await headHash(workDir)).to.equal(resumeTip);
    expect(resumeTip).to.not.equal(mainTip);
  });

  it('resumes a branch that exists only on origin', async () => {
    const base = await makeSandbox('cwbft-resume-remote');
    const { workDir, g } = await setupWithOrigin(base);
    await g.checkout(['-b', 'feature/remote-only', 'main']);
    const remoteTip = await commitFile(workDir, 'remote.txt', 'remote work\n', 'feat: remote wip');
    await g.raw(['push', 'origin', 'feature/remote-only']);
    await g.checkout('main');
    await g.raw(['branch', '-D', 'feature/remote-only']); // gone locally, still on origin
    process.chdir(workDir);

    await createWorkBranchFromTarget('feature/remote-only', 'main');

    expect(await currentBranch(workDir)).to.equal('feature/remote-only');
    expect(await headHash(workDir)).to.equal(remoteTip);
  });

  it('falls back to the local target ref when origin has no matching branch', async () => {
    const base = await makeSandbox('cwbft-fallback-local');
    const { workDir, mainTip } = await setupWithEmptyOrigin(base);
    process.chdir(workDir);

    await createWorkBranchFromTarget('feature/local', 'main');

    expect(await currentBranch(workDir)).to.equal('feature/local');
    expect(await headHash(workDir)).to.equal(mainTip);
  });

  it('throws when the target branch exists neither locally nor on origin', async () => {
    const base = await makeSandbox('cwbft-no-target');
    const { workDir } = await setupWithEmptyOrigin(base);
    process.chdir(workDir);

    let err: Error | undefined;
    try {
      await createWorkBranchFromTarget('feature/x', 'ghost-branch');
    } catch (e) {
      err = e as Error;
    }
    expect(err, 'expected createWorkBranchFromTarget to throw').to.be.instanceOf(Error);
    expect(err!.message).to.match(/ghost-branch/);
  });
});

describe('getGitDeltaScope() worktree fallback', () => {
  it('computes the delta against origin/<target> when the local target ref is checked out elsewhere', async () => {
    const base = await makeSandbox('delta-fallback');
    const { workDir, mainTip, g } = await setupWithOrigin(base);
    // Create the current branch with one extra commit ahead of main
    await g.checkout(['-b', 'feature', 'main']);
    const featureTip = await commitFile(workDir, 'feature.txt', 'change\n', 'feat: a change');
    // Check main out in another worktree so fetching into the local main ref is refused,
    // forcing getGitDeltaScope onto the origin/<target> fallback path.
    const linkedDir = path.join(base, 'linked');
    await g.raw(['worktree', 'add', linkedDir, 'main']);
    process.chdir(workDir);

    const scope = await getGitDeltaScope('feature', 'main');

    expect(scope.fromCommit).to.equal(mainTip); // merge-base of origin/main and feature
    expect(scope.toCommit, 'toCommit should be the latest commit on feature').to.not.be.null;
    expect(scope.toCommit!.hash).to.equal(featureTip);
    expect(scope.logResult.total).to.equal(1); // exactly one commit ahead of the target
  });
});
