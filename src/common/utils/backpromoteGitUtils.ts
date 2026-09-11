/*
 * Git side of hardis:work:backpromote. A backpromote is a git merge of the parent branch into the
 * User Story branch, followed by the deployment of what that merge brought in. The pre-merge commit
 * is kept in a ref of the repository while a merge waits for its conflicts to be solved, so the next
 * run finishes it and deploys the right delta.
 */
import { SfError } from '@salesforce/core';
import { spawnSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import fs from './fsUtils.js';
import { createTempDir, getGitRepoRoot, git } from './index.js';
import { callSfdxGitDelta } from './gitUtils.js';
import { parsePackageXmlFile } from './xmlUtils.js';
import { getReportDirectory } from '../../config/index.js';
import { userChangesOutsideReports } from './promotionCreateUtils.js';
import { MetadataUtils } from '../metadata-utils/index.js';
import { BackpromoteConflictChoice, countConflictMarkerBlocks, normalizeRepoPath, parseMetadataKey, toMetadataKey } from './backpromoteRules.js';

/** Where the pre-merge commit is kept while a backpromote merge waits for its conflicts */
const BASE_REF = 'refs/sfdx-hardis/backpromote-base';

function runGit(args: string[], options: { cwd?: string } = {}) {
  return spawnSync('git', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024, ...options });
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

/**
 * The parent branch as the remote has it. A developer merges `origin/integration` into their branch
 * and never updates their local `integration`: listing the local branch would find nothing new.
 */
export function resolveBackpromoteParentRef(parentBranch: string): string {
  const remoteRef = `origin/${parentBranch}`;
  return runGit(['rev-parse', '--verify', '--quiet', `${remoteRef}^{commit}`]).status === 0 ? remoteRef : parentBranch;
}

export function headCommit(): string {
  return runGitOrFail(['rev-parse', 'HEAD']);
}

export function mergeBaseOf(refA: string, refB: string): string | null {
  const result = runGit(['merge-base', refA, refB]);
  return result.status === 0 ? (result.stdout || '').trim() || null : null;
}

/** True when the branch already contains the commit (nothing to bring in) */
export function isAncestor(commit: string, ref: string): boolean {
  return runGit(['merge-base', '--is-ancestor', commit, ref]).status === 0;
}

/** Files changed between two commits, as repository paths */
export function changedFilesBetween(from: string, to: string): string[] {
  return gitLines(['diff', '--name-only', from, to]).map(normalizeRepoPath);
}

// ---- The merge kept between two runs ----

export function readBackpromoteBase(): string | null {
  const result = runGit(['rev-parse', '--verify', '--quiet', BASE_REF]);
  return result.status === 0 ? (result.stdout || '').trim() || null : null;
}

export function saveBackpromoteBase(commit: string): void {
  runGitOrFail(['update-ref', BASE_REF, commit]);
}

export function clearBackpromoteBase(): void {
  runGit(['update-ref', '-d', BASE_REF]);
}

/** A merge is waiting for its conflicts to be solved */
export function isMergeInProgress(): boolean {
  return runGit(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']).status === 0;
}

/** The commit a waiting merge is merging: the parent branch as it was when the merge started */
export function readMergeHead(): string | null {
  const result = runGit(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']);
  return result.status === 0 ? (result.stdout || '').trim() || null : null;
}

/** The files git could not merge on its own */
export function listConflictedFiles(): string[] {
  return gitLines(['diff', '--name-only', '--diff-filter=U']).map(normalizeRepoPath);
}

/**
 * Merge the parent branch into the current branch. Returns the files git could not merge: when there
 * are none the merge commit exists already, otherwise the merge waits with MERGE_HEAD set.
 */
export function mergeParentBranch(parentRef: string, parentBranch: string): { conflicted: string[]; merged: boolean } {
  const result = runGit(['merge', '--no-edit', '-m', `chore(sfdx-hardis): backpromote ${parentBranch} into the User Story branch`, parentRef]);
  if (result.status === 0) {
    return { conflicted: [], merged: true };
  }
  const conflicted = listConflictedFiles();
  if (conflicted.length === 0) {
    throw new SfError(`[Backpromote] git merge ${parentRef} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return { conflicted, merged: false };
}

/**
 * Apply a decision to a conflicting file. overwrite takes the parent branch version, keep takes the
 * developer's version (their branch, holding what their org had), merge leaves the markers for a
 * manual resolution. A file only one side still has (modified on one side, deleted on the other) is
 * removed when the kept side deleted it.
 */
export function applyConflictDecision(file: string, choice: BackpromoteConflictChoice): void {
  if (choice === 'merge') {
    return;
  }
  const side = choice === 'overwrite' ? '--theirs' : '--ours';
  const checkout = runGit(['checkout', side, '--', file]);
  if (checkout.status !== 0) {
    // The kept side does not have the file: it is deleted
    runGit(['rm', '-q', '--force', '--', file]);
    return;
  }
  runGitOrFail(['add', '--', file]);
}

/** Files still holding conflict markers, as "path (count)" */
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

/** Stage the solved files and create the merge commit git prepared */
export function commitMerge(files: string[]): void {
  if (files.length > 0) {
    runGitOrFail(['add', '--', ...files]);
  }
  runGitOrFail(['commit', '-q', '--no-edit']);
}

export function abortMerge(): void {
  runGit(['merge', '--abort']);
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

// ---- Delta ----

export interface BackpromoteDelta {
  /** Type:Name -> true, what the range deploys */
  items: string[];
  /** Type:Name keys the range deletes */
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
 * changes, so it is cached in the temporary folder: the plan, the run and a run finishing a merge
 * all ask for the same one.
 */
export async function computeBackpromoteDelta(from: string, to: string): Promise<BackpromoteDelta> {
  const gitRoot = path.resolve((await getGitRepoRoot()).trim()).toLowerCase();
  let fingerprint = 5381;
  for (let index = 0; index < gitRoot.length; index++) {
    fingerprint = ((fingerprint * 33) ^ gitRoot.charCodeAt(index)) >>> 0;
  }
  const fromCommit = runGitOrFail(['rev-parse', from]);
  const toCommit = runGitOrFail(['rev-parse', to]);
  const outputDir = path.join(os.tmpdir(), 'sfdx-hardis-backpromote-delta', fingerprint.toString(16), `${fromCommit.substring(0, 12)}-${toCommit.substring(0, 12)}`);
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

/** Local source file of each Type:Name item (repository path), or null when it cannot be found */
export async function findItemPaths(keys: Iterable<string>): Promise<Map<string, string | null>> {
  const gitRoot = path.resolve((await getGitRepoRoot()).trim());
  const namesByType = new Map<string, string[]>();
  for (const key of keys) {
    const parsed = parseMetadataKey(key);
    if (parsed) {
      namesByType.set(parsed.type, [...(namesByType.get(parsed.type) || []), parsed.name]);
    }
  }
  const files = new Map<string, string | null>();
  for (const [type, names] of namesByType) {
    const found = await MetadataUtils.findMetaFilesFromTypeAndNames(type, names);
    for (const name of names) {
      const file = found.get(name) ?? null;
      files.set(toMetadataKey(type, name), file && fs.existsSync(file) ? normalizeRepoPath(path.relative(gitRoot, path.resolve(file))) : null);
    }
  }
  return files;
}
