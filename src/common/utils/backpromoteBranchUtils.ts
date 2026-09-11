/*
 * Git side of hardis:work:backpromote: where a run works. A backpromote never works on a major branch.
 * When the current branch cannot receive it, the run creates a local backpromote/<parent>/<date> branch
 * from the remote parent branch, works there, and brings the user back to the branch they started
 * from. That branch is kept when it holds merged files (committed on it), deleted when it holds nothing.
 */
import { SfError } from '@salesforce/core';
import c from 'chalk';
import { spawnSync } from 'child_process';
import * as path from 'path';
import fs from './fsUtils.js';
import { createTempDir, getGitRepoRoot, git, uxLog } from './index.js';
import { getSfdxProjectPackageDirectories } from './projectUtils.js';
import { buildBackpromoteBranchName } from './backpromoteSelectionUtils.js';
import { t } from './i18n.js';

// Recorded in the git config of a backpromote branch: where to come back, and its parent branch
const RETURN_BRANCH_KEY = 'sfdxHardisBackpromoteReturnBranch';
const PARENT_BRANCH_KEY = 'sfdxHardisBackpromoteParentBranch';

function runGit(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync('git', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024, ...options });
}

function runGitOrFail(args: string[]): string {
  const result = runGit(args);
  if (result.error || result.status !== 0) {
    throw new SfError(`[Backpromote] git ${args.join(' ')} failed: ${(result.stderr || result.error?.message || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

/** What a previous run recorded on a backpromote branch it created, nulls on any other branch */
export function readBackpromoteBranchInfo(branch: string): { returnBranch: string | null; parentBranch: string | null } {
  const read = (key: string): string | null => {
    if (!branch) {
      return null;
    }
    const result = runGit(['config', '--get', `branch.${branch}.${key}`]);
    const value = result.status === 0 ? (result.stdout || '').trim() : '';
    return value || null;
  };
  return { returnBranch: read(RETURN_BRANCH_KEY), parentBranch: read(PARENT_BRANCH_KEY) };
}

/** True when the branch already contains the latest commit of the parent branch ref */
export function isBranchUpToDateWith(parentRef: string, currentBranch: string): boolean {
  const parentHead = runGit(['rev-parse', '--verify', '--quiet', parentRef]);
  const mergeBase = runGit(['merge-base', parentRef, currentBranch]);
  return parentHead.status === 0 && mergeBase.status === 0 && (parentHead.stdout || '').trim() === (mergeBase.stdout || '').trim();
}

/**
 * Create and check out a new local backpromote branch from the parent branch ref, and record where
 * the run brings the user back. It does not track the parent branch, so a push from it can never
 * reach a major branch.
 */
export async function createBackpromoteBranch(parentBranch: string, parentRef: string, returnBranch: string, commandThis: any): Promise<string> {
  const existingBranches = (await git().branchLocal()).all;
  const branch = buildBackpromoteBranchName(parentBranch, new Date(), existingBranches);
  uxLog(
    'action',
    commandThis,
    c.cyan(t('backpromoteCreatingBranch', { branch: c.green(branch), parentBranch: c.green(parentBranch), returnBranch: c.green(returnBranch) }))
  );
  runGitOrFail(['checkout', '-q', '--no-track', '-b', branch, parentRef]);
  runGitOrFail(['config', `branch.${branch}.${RETURN_BRANCH_KEY}`, returnBranch]);
  runGitOrFail(['config', `branch.${branch}.${PARENT_BRANCH_KEY}`, parentBranch]);
  return branch;
}

/**
 * Leave a backpromote branch at the end of a run:
 * - a prepared merge keeps the user on it, to solve the merge there;
 * - deployed merged files are committed on it first, and the branch is kept;
 * - uncommitted changes left (a merge whose deployment failed) keep the user on it;
 * - otherwise the user goes back to the return branch, and a branch holding no commit of its own is deleted.
 */
export async function leaveBackpromoteBranch(options: {
  branch: string;
  returnBranch: string;
  parentRef: string;
  outcome: 'mergePrepared' | 'deployed' | 'notDeployed';
  mergedFiles: string[];
  commitMessage: string;
  listUncommittedFiles: () => Promise<string[]>;
  commandThis: any;
}): Promise<void> {
  const { branch, returnBranch, commandThis } = options;
  if (options.outcome === 'mergePrepared') {
    uxLog('action', commandThis, c.yellow(t('backpromoteStayOnBranchToMerge', { branch, returnBranch })));
    return;
  }
  let committedMergedFiles = false;
  if (options.outcome === 'deployed' && options.mergedFiles.length > 0) {
    const commit = runGit(['commit', '-q', '-m', options.commitMessage, '--', ...options.mergedFiles]);
    const commitOutput = `${commit.stdout || ''}${commit.stderr || ''}`;
    // A merge whose result is identical to what the branch already holds leaves nothing to commit,
    // and git answers 1: that is not a failure, and must not keep the user on a temporary branch
    const nothingToCommit = /nothing to commit|no changes added to commit|nothing added to commit/i.test(commitOutput);
    if ((commit.error || commit.status !== 0) && !nothingToCommit) {
      uxLog('warning', commandThis, c.yellow(t('backpromoteBranchCommitFailed', { branch, message: (commit.stderr || commit.stdout || commit.error?.message || '').trim() })));
      return;
    }
    if (!nothingToCommit) {
      committedMergedFiles = true;
      uxLog('action', commandThis, c.cyan(t('backpromoteBranchMergedFilesCommitted', { branch: c.green(branch) })));
    }
  }
  const uncommittedFiles = await options.listUncommittedFiles();
  if (uncommittedFiles.length > 0) {
    uxLog('warning', commandThis, c.yellow(t('backpromoteStayOnBranchWithChanges', { branch, returnBranch, files: uncommittedFiles.join(', ') })));
    return;
  }
  runGitOrFail(['checkout', '-q', returnBranch]);
  uxLog('action', commandThis, c.cyan(t('backpromoteBackToBranch', { branch: c.green(returnBranch) })));
  // The merged files are committed on the backpromote branch, and the User Story branch still holds
  // the version without the merge: say how to bring them over, or the next deployment from git
  // overwrites in the org what the merge had just kept
  if (committedMergedFiles) {
    const files = options.mergedFiles
      .map((file) => path.relative(process.cwd(), path.resolve(file)).split(path.sep).join('/'))
      .join(' ');
    uxLog('action', commandThis, c.yellow(t('backpromoteBringMergedFilesToUserStory', { branch, returnBranch, command: `git checkout ${branch} -- ${files}` })));
  }
  const ownCommits = runGit(['rev-list', '--count', `${options.parentRef}..${branch}`]);
  if (ownCommits.status === 0 && (ownCommits.stdout || '').trim() === '0') {
    runGit(['branch', '-q', '-D', branch]);
    uxLog('log', commandThis, c.grey(t('backpromoteBranchDeleted', { branch })));
  } else {
    uxLog('log', commandThis, c.grey(t('backpromoteBranchKept', { branch })));
  }
}

/**
 * The package directories of a git ref, written into a temporary folder: a plan reads the files of the
 * parent branch without checking it out. A temporary index keeps the index of the repository untouched.
 * A package directory missing from the ref is left out.
 */
export async function exportBranchPackageDirectories(ref: string, commandThis?: any): Promise<Array<{ path: string; fullPath: string }>> {
  const exportDir = await createTempDir();
  const gitRoot = realPath(path.resolve((await getGitRepoRoot()).trim()));
  const indexFile = path.join(exportDir, '.backpromote-index');
  const exported: Array<{ path: string; fullPath: string }> = [];
  for (const packageDirectory of await getSfdxProjectPackageDirectories()) {
    // Both sides go through realpath: a workspace opened through a symbolic link or a Windows
    // junction gives a package directory outside the git root, and the relative path would then
    // climb out of the repository. git would refuse it, and the plan would silently compare the org
    // with the files of the checked out branch instead of the ones of the parent branch.
    const repoPath = path.relative(gitRoot, realPath(path.resolve(packageDirectory.fullPath))).split(path.sep).join('/');
    const result = repoPath.startsWith('..')
      ? { status: 1, stderr: `${packageDirectory.path} is outside the git repository` } as any
      : runGit(['--work-tree', exportDir, 'checkout', ref, '--', repoPath], {
        cwd: gitRoot,
        env: { ...process.env, GIT_INDEX_FILE: indexFile },
      });
    if (result.status === 0) {
      exported.push({ path: packageDirectory.path, fullPath: path.join(exportDir, repoPath) });
    } else if (commandThis !== undefined) {
      uxLog('warning', commandThis, c.yellow(t('backpromoteParentFilesNotRead', { directory: packageDirectory.path, ref, message: (result.stderr || '').trim() })));
    }
  }
  return exported;
}

/** The real location of a path, following symbolic links and Windows junctions */
function realPath(value: string): string {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
  } catch {
    return value;
  }
}
