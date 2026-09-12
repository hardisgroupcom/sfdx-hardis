/*
 * Git side of hardis:work:backpromote. The backpromote branch `backpromote/<parent>/<sandbox>` is a
 * child of the parent branch that only holds the manual merges of a backpromote: it is fetched at
 * every run, rebuilt on the parent head, checked out for the deployment, and pushed when it holds
 * merges. It records no history: the history lives in the Pull Request comments.
 */
import { SfError } from '@salesforce/core';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { MetadataResolver, RegistryAccess, VirtualTreeContainer } from '@salesforce/source-deploy-retrieve';
import fs from './fsUtils.js';
import { createTempDir, getGitRepoRoot, git } from './index.js';
import { callSfdxGitDelta } from './gitUtils.js';
import { parsePackageXmlFile } from './xmlUtils.js';
import { getReportDirectory } from '../../config/index.js';
import { userChangesOutsideReports } from './promotionCreateUtils.js';
import { backpromoteCacheRoot } from './backpromotePlanUtils.js';
import { buildTwoWayMergeWithMarkers, countConflictMarkerBlocks, normalizeRepoPath, toMetadataKey } from './backpromoteRules.js';

const gitRootByCwd = new Map<string, string>();

/** The repository root of the working directory, resolved once per directory: every path the command handles is relative to it */
function gitRoot(): string {
  const cwd = process.cwd();
  let root = gitRootByCwd.get(cwd);
  if (!root) {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true, cwd });
    root = result.status === 0 && (result.stdout || '').trim() ? path.resolve((result.stdout || '').trim()) : cwd;
    gitRootByCwd.set(cwd, root);
  }
  return root;
}

function runGit(args: string[], options: { cwd?: string; input?: string } = {}) {
  // Run from the repository root (the command may be started from a sub-folder, and every path it
  // handles is root-relative); quotepath off: a non-ASCII file name is printed as it is
  return spawnSync('git', ['-c', 'core.quotepath=off', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024, cwd: gitRoot(), ...options });
}

function runGitOrFail(args: string[]): string {
  const result = runGit(args);
  if (result.error || result.status !== 0) {
    throw new SfError(`[Backpromote] git ${args.join(' ')} failed: ${(result.stderr || result.stdout || result.error?.message || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

function gitLines(args: string[]): string[] {
  const result = runGit(args);
  return result.status === 0 ? (result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '') : [];
}

// ---- Refs ----

export function fetchOrigin(): void {
  const result = runGit(['fetch', '--prune', 'origin']);
  if (result.status !== 0) {
    throw new SfError(`[Backpromote] git fetch failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
}

export function remoteBranchExists(branch: string): boolean {
  return runGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}^{commit}`]).status === 0;
}

export function localBranchExists(branch: string): boolean {
  return runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]).status === 0;
}

/** The parent branch as the remote has it: a developer never updates their local copy of a major branch */
export function resolveBackpromoteParentRef(parentBranch: string): string {
  return remoteBranchExists(parentBranch) ? `origin/${parentBranch}` : parentBranch;
}

export function revParse(ref: string): string | null {
  const result = runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return result.status === 0 ? (result.stdout || '').trim() || null : null;
}

export function headCommit(): string {
  return runGitOrFail(['rev-parse', 'HEAD']);
}

export function currentBranchName(): string {
  return runGitOrFail(['rev-parse', '--abbrev-ref', 'HEAD']);
}

export function gitUserName(): string {
  const result = runGit(['config', 'user.name']);
  return result.status === 0 ? (result.stdout || '').trim() : '';
}

/** True when the ref already contains the commit */
export function isAncestor(commit: string, ref: string): boolean {
  return runGit(['merge-base', '--is-ancestor', commit, ref]).status === 0;
}

/** Files changed between two commits, as repository paths */
export function changedFilesBetween(from: string, to: string): string[] {
  return gitLines(['diff', '--name-only', from, to]).map(normalizeRepoPath);
}

/** The content of a file at a ref, null when the file does not exist there */
export function fileAtRef(ref: string, file: string): string | null {
  const result = runGit(['show', `${ref}:${normalizeRepoPath(file)}`]);
  return result.status === 0 ? result.stdout : null;
}

/** The files under a folder at a ref */
export function listFilesAtRef(ref: string, folder: string): string[] {
  return gitLines(['ls-tree', '-r', '--name-only', ref, '--', normalizeRepoPath(folder)]).map(normalizeRepoPath);
}

/** The first-parent commits of a range that touched the given files, newest first */
export function commitsTouchingFiles(from: string, to: string, files: string[]): string[] {
  if (files.length === 0) {
    return [];
  }
  return gitLines(['log', '--first-parent', '--format=%H', `${from}..${to}`, '--', ...files.map(normalizeRepoPath)]);
}

// ---- Working tree ----

/**
 * Files with uncommitted changes, apart from the reports sfdx-hardis writes inside the repository:
 * the merge prompt of a previous run must not block the run that finishes the merge.
 */
export async function listUncommittedFiles(): Promise<string[]> {
  const status = await git().status();
  const reportDirectory = path.basename(await getReportDirectory());
  return userChangesOutsideReports(status.files || [], reportDirectory).map((file) => normalizeRepoPath(file.path));
}

/** Commit every change of the working tree. Returns the committed files, empty when there was nothing. */
export async function commitAllChanges(message: string): Promise<string[]> {
  const files = await listUncommittedFiles();
  if (files.length === 0) {
    return [];
  }
  runGitOrFail(['add', '-A', '--', ...files]);
  runGitOrFail(['commit', '-q', '-m', message]);
  return files;
}

/** Stash the working tree (untracked files included) under a message the panel can find again */
export function stashWorkingTree(message: string): boolean {
  const before = gitLines(['stash', 'list']).length;
  const result = runGit(['stash', 'push', '--include-untracked', '-m', message]);
  if (result.status !== 0) {
    throw new SfError(`[Backpromote] git stash failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return gitLines(['stash', 'list']).length > before;
}

export function commitFiles(files: string[], message: string): string {
  runGitOrFail(['add', '--', ...files.map(normalizeRepoPath)]);
  runGitOrFail(['commit', '-q', '-m', message]);
  return headCommit();
}

// ---- The backpromote branch ----

export interface BackpromoteBranchState {
  name: string;
  existsOnOrigin: boolean;
  head: string | null;
  /** Files of the manual merge commits the branch holds beyond the parent head */
  pendingMerges: string[];
}

/** The files of the commits a ref holds beyond the parent head: the manual merges */
export function filesOfCommitsBeyond(parentRef: string, ref: string): string[] {
  const files = new Set<string>();
  for (const commit of gitLines(['rev-list', `${parentRef}..${ref}`])) {
    for (const file of gitLines(['diff-tree', '--no-commit-id', '--name-only', '-r', commit])) {
      files.add(normalizeRepoPath(file));
    }
  }
  return [...files].sort();
}

/** What origin holds for the backpromote branch, without touching the checkout */
export function inspectBackpromoteBranch(branch: string, parentRef: string): BackpromoteBranchState {
  const existsOnOrigin = remoteBranchExists(branch);
  const head = existsOnOrigin ? revParse(`origin/${branch}`) : null;
  const pendingMerges = head ? filesOfCommitsBeyond(parentRef, head) : [];
  return { name: branch, existsOnOrigin, head, pendingMerges };
}

/**
 * Check the backpromote branch out, built on the parent head: origin is the source of truth (the
 * local copy is thrown away when they diverge), and the manual merge commits it holds are carried
 * over to the current parent head with a cherry-pick. A merge the parent branch changed again since
 * cannot be carried over: it is dropped, and the comment row that lists it as pending makes the next
 * plan offer the file again.
 */
export function checkoutBackpromoteBranch(branch: string, parentRef: string): { droppedMerges: string[]; carriedCommits: number } {
  const parentHead = revParse(parentRef);
  if (!parentHead) {
    throw new SfError(`[Backpromote] Unknown parent ref ${parentRef}`);
  }
  // A local copy of the branch may hold merge commits that never reached origin (a run whose push
  // was rejected, a branch checked out then left): they are kept, and the commits origin holds
  // beyond them are picked on top, so that nothing committed on either side is lost
  if (localBranchExists(branch)) {
    runGitOrFail(['checkout', '-q', '-f', branch]);
    if (remoteBranchExists(branch)) {
      for (const commit of gitLines(['rev-list', '--reverse', `HEAD..origin/${branch}`])) {
        if (runGit(['cherry-pick', '--allow-empty', '--keep-redundant-commits', commit]).status !== 0) {
          runGit(['cherry-pick', '--abort']);
          runGit(['reset', '-q', '--hard', 'HEAD']);
        }
      }
    }
  } else {
    const startPoint = remoteBranchExists(branch) ? `origin/${branch}` : parentHead;
    runGitOrFail(['checkout', '-q', '-B', branch, startPoint]);
  }
  return rebuildBackpromoteBranchOnParent(parentRef);
}

/**
 * Rebuild the checked-out backpromote branch on the current parent head: reset, then cherry-pick
 * the commits it held beyond the previous parent head. Also used when the checkout was already on
 * the branch (the command leaves it there after every run) and the parent branch moved since.
 */
export function rebuildBackpromoteBranchOnParent(parentRef: string): { droppedMerges: string[]; carriedCommits: number } {
  const parentHead = revParse(parentRef);
  if (!parentHead) {
    throw new SfError(`[Backpromote] Unknown parent ref ${parentRef}`);
  }
  const mergeCommits = gitLines(['rev-list', '--reverse', `${parentHead}..HEAD`]);
  if (mergeCommits.length === 0) {
    if (!isAncestor(parentHead, 'HEAD')) {
      runGitOrFail(['reset', '-q', '--hard', parentHead]);
    }
    return { droppedMerges: [], carriedCommits: 0 };
  }
  runGitOrFail(['reset', '-q', '--hard', parentHead]);
  const droppedMerges: string[] = [];
  let carriedCommits = 0;
  for (const commit of mergeCommits) {
    const pick = runGit(['cherry-pick', '--allow-empty', '--keep-redundant-commits', commit]);
    if (pick.status === 0) {
      carriedCommits++;
      continue;
    }
    droppedMerges.push(...gitLines(['diff-tree', '--no-commit-id', '--name-only', '-r', commit]).map(normalizeRepoPath));
    runGit(['cherry-pick', '--abort']);
    runGit(['reset', '-q', '--hard', 'HEAD']);
  }
  return { droppedMerges: [...new Set(droppedMerges)], carriedCommits };
}

/** Push the backpromote branch. A rejected lease means someone else pushed merges for the same sandbox meanwhile. */
export function pushBackpromoteBranch(branch: string): { pushed: boolean; rejected: boolean; error: string | null } {
  const result = runGit(['push', '--force-with-lease', '--set-upstream', 'origin', `${branch}:${branch}`]);
  if (result.status === 0) {
    return { pushed: true, rejected: false, error: null };
  }
  const output = (result.stderr || result.stdout || '').trim();
  return { pushed: false, rejected: /rejected|stale info|fetch first/i.test(output), error: output };
}

/**
 * Delete the backpromote branch on origin and locally. The checkout leaves it first when it is on
 * it: back to the branch the run came from when it still exists, else detached on the parent head.
 * The pending merges are abandoned on purpose, so the checkout is forced.
 */
export function deleteBackpromoteBranch(branch: string, parentRef: string, returnBranch: string | null = null): { deletedOnOrigin: boolean; deletedLocally: boolean } {
  let deletedOnOrigin = false;
  if (remoteBranchExists(branch)) {
    deletedOnOrigin = runGit(['push', 'origin', '--delete', branch]).status === 0;
  }
  if (currentBranchName() === branch) {
    if (returnBranch && returnBranch !== branch && localBranchExists(returnBranch)) {
      runGitOrFail(['checkout', '-q', '-f', returnBranch]);
    } else {
      runGitOrFail(['checkout', '-q', '-f', '--detach', parentRef]);
    }
  }
  const deletedLocally = localBranchExists(branch) ? runGit(['branch', '-D', branch]).status === 0 : false;
  return { deletedOnOrigin, deletedLocally };
}

// ---- Merges ----

/**
 * Write a merged file with conflict markers in the working tree. Three-way through `git merge-file`
 * when a base exists (the sandbox already received a backpromote), two-way otherwise. Returns the
 * number of conflict blocks left in the file.
 */
export async function writeMergedFile(options: {
  absolutePath: string;
  sandboxContent: string;
  parentContent: string;
  baseContent: string | null;
  labels: { sandbox: string; parent: string; base: string };
}): Promise<{ conflictBlocks: number; threeWay: boolean }> {
  await fs.ensureDir(path.dirname(options.absolutePath));
  if (options.baseContent === null) {
    const merged = buildTwoWayMergeWithMarkers(options.sandboxContent, options.parentContent, options.labels);
    await fs.writeFile(options.absolutePath, merged.content, 'utf8');
    return { conflictBlocks: merged.conflictBlocks, threeWay: false };
  }
  const workDir = await createTempDir();
  const ours = path.join(workDir, 'sandbox');
  const base = path.join(workDir, 'base');
  const theirs = path.join(workDir, 'parent');
  await fs.writeFile(ours, options.sandboxContent, 'utf8');
  await fs.writeFile(base, options.baseContent, 'utf8');
  await fs.writeFile(theirs, options.parentContent, 'utf8');
  const result = runGit(['merge-file', '-p', '-L', options.labels.sandbox, '-L', options.labels.base, '-L', options.labels.parent, ours, base, theirs]);
  // Exit code = number of conflicts (0 when clean); anything else (255 for a binary file, a missing
  // input) is an error, and its empty output must never be written over the file
  const conflicts = result.status ?? -1;
  if (result.error || conflicts < 0 || conflicts > 200 || (conflicts > 0 && !(result.stdout || '').includes('<<<<<<<'))) {
    throw new SfError(`[Backpromote] git merge-file failed: ${(result.stderr || result.error?.message || `exit code ${result.status}`).trim()}`);
  }
  await fs.writeFile(options.absolutePath, result.stdout || '', 'utf8');
  return { conflictBlocks: countConflictMarkerBlocks(result.stdout || ''), threeWay: true };
}

/** Files still holding conflict markers, with their count */
export async function listFilesWithConflictMarkers(files: Iterable<string>): Promise<Array<{ path: string; conflictBlocks: number }>> {
  const gitRoot = path.resolve((await getGitRepoRoot()).trim());
  const withMarkers: Array<{ path: string; conflictBlocks: number }> = [];
  for (const file of files) {
    const absolute = path.resolve(gitRoot, file);
    if (!fs.existsSync(absolute)) {
      continue;
    }
    const count = countConflictMarkerBlocks(await fs.readFile(absolute, 'utf8'));
    if (count > 0) {
      withMarkers.push({ path: normalizeRepoPath(file), conflictBlocks: count });
    }
  }
  return withMarkers;
}

// ---- Delta ----

export interface BackpromoteDelta {
  /** Type:Name keys the window deploys */
  items: string[];
  /** Type:Name keys the window deletes */
  deletions: string[];
  packageXml: string;
  destructiveXml: string | null;
}

async function readPackageContent(file: string): Promise<Record<string, string[]>> {
  if (!fs.existsSync(file)) {
    return {};
  }
  return ((await parsePackageXmlFile(file)) || {}) as Record<string, string[]>;
}

/**
 * What a commit range deploys and deletes, from sfdx-git-delta. The delta of a fixed range never
 * changes, so it is cached in the temporary folder: the plan and the run ask for the same one.
 */
export async function computeBackpromoteDelta(from: string, to: string): Promise<BackpromoteDelta> {
  const gitRoot = path.resolve((await getGitRepoRoot()).trim()).toLowerCase();
  let fingerprint = 5381;
  for (let index = 0; index < gitRoot.length; index++) {
    fingerprint = ((fingerprint * 33) ^ gitRoot.charCodeAt(index)) >>> 0;
  }
  const fromCommit = runGitOrFail(['rev-parse', from]);
  const toCommit = runGitOrFail(['rev-parse', to]);
  const outputDir = path.join(backpromoteCacheRoot(), 'delta', fingerprint.toString(16), `${fromCommit.substring(0, 12)}..${toCommit.substring(0, 12)}`);
  const packageXml = path.join(outputDir, 'package', 'package.xml');
  const destructiveXml = path.join(outputDir, 'destructiveChanges', 'destructiveChanges.xml');
  if (!fs.existsSync(packageXml)) {
    const workDir = await createTempDir();
    const deltaResult = await callSfdxGitDelta(fromCommit, toCommit, workDir);
    if (deltaResult?.status !== 0) {
      throw new SfError(`[Backpromote] sfdx-git-delta failed between ${fromCommit.substring(0, 7)} and ${toCommit.substring(0, 7)}: ${JSON.stringify(deltaResult)}`);
    }
    await fs.ensureDir(outputDir);
    await fs.copy(workDir, outputDir, { overwrite: true });
  }
  const items = await readPackageContent(packageXml);
  const deletions = await readPackageContent(destructiveXml);
  const keysOf = (content: Record<string, string[]>) => Object.keys(content).flatMap((type) => (content[type] || []).map((member) => toMetadataKey(type, member)));
  return {
    items: keysOf(items),
    deletions: keysOf(deletions),
    packageXml,
    destructiveXml: fs.existsSync(destructiveXml) && keysOf(deletions).length > 0 ? destructiveXml : null,
  };
}

/**
 * The Type:Name keys each repository path belongs to, resolved with the Salesforce registry over a
 * virtual tree: the files need not exist in the checkout, so the plan works from any branch. A
 * file that is not Salesforce metadata maps to nothing.
 */
export function resolveFilesToMetadataKeys(files: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const normalized = files.map((file) => path.normalize(file));
  if (normalized.length === 0) {
    return result;
  }
  const tree = VirtualTreeContainer.fromFilePaths(normalized);
  const resolver = new MetadataResolver(new RegistryAccess(), tree, false);
  for (let index = 0; index < files.length; index++) {
    try {
      const components = resolver.getComponentsFromPath(normalized[index]);
      const keys = [...new Set(components.map((component) => toMetadataKey(component.type.name, component.fullName)))];
      if (keys.length > 0) {
        result.set(normalizeRepoPath(files[index]), keys);
      }
    } catch {
      // Not a Salesforce metadata file
    }
  }
  return result;
}

/**
 * The files of each item of the window at the parent head: the changed files that resolve to the
 * item, and for a bundle (a folder named after the item) every file of the folder, so that the
 * comparison sees the whole bundle.
 */
export function collectItemFiles(items: string[], changedFiles: string[], parentRef: string): Map<string, string[]> {
  const keysByFile = resolveFilesToMetadataKeys(changedFiles);
  const filesByItem = new Map<string, Set<string>>();
  for (const key of items) {
    filesByItem.set(key, new Set());
  }
  for (const [file, keys] of keysByFile) {
    for (const key of keys) {
      const owner = filesByItem.get(key) || matchDecomposedParent(key, filesByItem);
      if (owner) {
        owner.add(file);
      }
    }
  }
  for (const [key, files] of filesByItem) {
    const name = key.substring(key.indexOf(':') + 1).split('.').pop() || '';
    for (const file of [...files]) {
      const segments = file.split('/');
      const folderIndex = segments.lastIndexOf(name);
      // A bundle folder named after the item, directly under a bundle directory (lwc/myComponent,
      // aura/myComponent, staticresources/myResource...): never an ancestor folder that happens to
      // carry the item name (an item named "main" must not take the whole package directory)
      if (folderIndex > 0 && folderIndex < segments.length - 1 && BUNDLE_DIRECTORIES.has(segments[folderIndex - 1])) {
        for (const bundleFile of listFilesAtRef(parentRef, segments.slice(0, folderIndex + 1).join('/'))) {
          files.add(bundleFile);
        }
      }
    }
  }
  return new Map([...filesByItem].map(([key, files]) => [key, [...files].sort()]));
}

/** Source directories whose children are bundle folders named after the item */
const BUNDLE_DIRECTORIES = new Set(['lwc', 'aura', 'staticresources', 'experiences', 'waveTemplates', 'digitalExperiences', 'documents', 'contentassets']);

// A decomposed child (CustomField Account.Name) resolves to itself; a file of a parent-only type
// (CustomObject Account) resolves to the parent. When the delta lists the child and the file
// resolves to the parent, the child owns the file.
function matchDecomposedParent(key: string, filesByItem: Map<string, Set<string>>): Set<string> | null {
  const name = key.substring(key.indexOf(':') + 1);
  for (const [candidate, files] of filesByItem) {
    const candidateName = candidate.substring(candidate.indexOf(':') + 1);
    if (candidateName.startsWith(`${name}.`)) {
      return files;
    }
  }
  return null;
}
