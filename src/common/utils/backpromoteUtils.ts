/* jscpd:ignore-start */
import { SfError } from '@salesforce/core';
import c from 'chalk';
import * as Diff from 'diff';
import fs from './fsUtils.js';
import * as path from 'path';
import {
  createTempDir,
  execCommand,
  git,
  isCI,
  uxLog,
} from './index.js';
import { buildOrgManifest } from './deployUtils.js';
import { analyzeDeployErrorLogs } from './deployTips.js';
import { getConfig, getEnvVar } from '../../config/index.js';
import { GitProvider } from '../gitProvider/index.js';
// callSfdxGitDelta is used by the command file directly

import { countPackageXmlItems, isPackageXmlEmpty, parsePackageXmlFile, writePackageXmlFile } from './xmlUtils.js';
import { generateCsvFile, generateReportPath, uxLogTableWithReport } from './filesUtils.js';
import { generatePdfFileFromMarkdown } from './markdownUtils.js';
import { prompts } from './prompts.js';
import { ActionsProvider, PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { authOrg } from './authUtils.js';
import { findUserByUsernameLike } from './orgUtils.js';
import { MetadataUtils } from '../metadata-utils/index.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { parsePromotionBranchName } from './promotionBranchUtils.js';
import { guessBackpromoteParentBranch } from './backpromoteSelectionUtils.js';
import { readBackpromoteBranchInfo } from './backpromoteBranchUtils.js';
import { DEV_SANDBOXES_BRANCH_NAME, evaluateActionBranchFilter } from './actionUtils.js';
import { createBlankSfdxProject } from './projectUtils.js';
import { OrgDiffItem, WebSocketClient } from '../websocketClient.js';
import { t } from './i18n.js';

// ---- Interfaces ----

/** A first-parent commit on the parent branch, with its associated/inherited PRs */
export interface BackpromotePrGroup {
  /** The first-parent commit on the parent branch (what the user selects from) */
  commit: {
    hash: string;
    message: string;
    author: string;
    date: string;
  };
  /** PRs associated with this commit (direct merge or inherited through multi-hop merges) */
  associatedPrs: Array<{
    id: number;
    title: string;
    author: string;
    webUrl: string;
    sourceBranch: string;
  }>;
  /** PR-scoped configs for deployment actions and test classes (merged from all associated PRs) */
  prConfigs: Array<{ config: any; prId: number; prTitle: string }>;
}

export interface OrgConflictItem {
  metadataType: string;
  metadataName: string;
  status: 'modified' | 'added' | 'deleted' | 'unchanged';
  localPath: string;
  /** Path to the file retrieved from the org (left side of a visual diff). May be empty for items that don't have an org-side file. */
  orgPath: string;
  diffPreview: string;
  diffMarkdown: string;
  hasOrgChanges: boolean;
}

// ---- Resolve parent branch ----

export async function resolveParentBranch(
  commandThis: any,
  flagOverride: string | null,
  agentMode: boolean,
  currentBranch: string,
): Promise<string> {
  if (flagOverride) {
    uxLog('action', commandThis, c.cyan(t('backpromoteParentBranchAutoSelected', { parentBranch: c.green(flagOverride) })));
    return flagOverride;
  }
  const config = await getConfig('project');
  const userConfig = await getConfig('user');
  const majorOrgs = await listMajorOrgs();
  const recommendedBranch = guessBackpromoteParentBranch({
    currentBranch,
    // The branch that the current feature branch was created from (set by work:new)
    originBranch: userConfig?.localStorageBranchTargets?.[currentBranch] || null,
    backpromoteParentBranch: readBackpromoteBranchInfo(currentBranch).parentBranch,
    majorBranches: majorOrgs.map((org: any) => org.branchName).filter(Boolean),
    developmentBranch: config.developmentBranch || null,
  });

  if (agentMode || isCI) {
    uxLog('action', commandThis, c.cyan(t('backpromoteParentBranchAutoSelected', { parentBranch: c.green(recommendedBranch) })));
    return recommendedBranch;
  }
  // Interactive: let user choose from major org branches (+ developmentBranch)
  const majorBranchNames = new Set(majorOrgs.map((org: any) => org.branchName).filter(Boolean));
  // Also include developmentBranch even if it's not a major org
  if (config.developmentBranch) {
    majorBranchNames.add(config.developmentBranch);
  }

  const branchChoices: any[] = [];
  // Add recommended branch first
  if (majorBranchNames.has(recommendedBranch)) {
    branchChoices.push({
      title: `${recommendedBranch} (${t('recommended')})`,
      value: recommendedBranch,
    });
  }
  // Add remaining major branches
  for (const branchName of majorBranchNames) {
    if (branchName !== recommendedBranch) {
      branchChoices.push({ title: branchName, value: branchName });
    }
  }
  const branchRes = await prompts({
    type: 'select',
    message: c.cyanBright(t('backpromoteSelectParentBranch')),
    description: t('backpromoteSelectParentBranch'),
    name: 'value',
    choices: branchChoices,
  });
  return branchRes.value || recommendedBranch;
}

// ---- List first-parent commits with associated PRs ----

/**
 * A merge commit that resolves to no Pull Request number is represented by a "virtual" Pull
 * Request built from its source branch, so the work still shows up. It must be added at most once
 * per group, and never when a real Pull Request of that same branch is already in the group: a
 * branch merged twice (a re-merge, a fix pushed after the first merge) would otherwise be listed
 * once with its number and once as an unusable "-" row.
 */
export function shouldAddVirtualPullRequest(
  associatedPrs: Array<{ sourceBranch?: string }>,
  seenPrIds: Set<number>,
  sourceBranch: string
): boolean {
  if (!sourceBranch || seenPrIds.has(0)) {
    return false;
  }
  return !associatedPrs.some((pr) => (pr.sourceBranch || '').toLowerCase() === sourceBranch.toLowerCase());
}

/**
 * `<child> <parent> <parent>...` lines of `git rev-list --parents`, as a map.
 */
export function parseCommitParents(revListOutput: string): Map<string, string[]> {
  const parents = new Map<string, string[]>();
  for (const line of (revListOutput || '').split('\n')) {
    const hashes = line.trim().split(/\s+/).filter((hash) => hash.length > 0);
    if (hashes.length > 0) {
      parents.set(hashes[0], hashes.slice(1));
    }
  }
  return parents;
}

/**
 * The commits each first-parent commit of a branch brought in.
 *
 * Walking the graph, not comparing dates: a cherry-picked commit keeps the author date it had on
 * the branch it came from, so it lands out of order. Attributing it by date gives it to whichever
 * merge happens to bracket that date, which for a promotion branch is the wrong one: the stories
 * of a promotion end up counted under the merge before it, and the merge that really carried them
 * ends up empty. Promotion branches are made of nothing but cherry-picks, so this is the normal
 * case, not an edge case.
 *
 * A commit shared by two merges belongs to the older one, which is why the first-parent commits
 * are walked oldest first.
 *
 * `extraBoundaries` are commits that stop the walk without getting a list of their own: a vehicle
 * merge opened up into the commits it brought in is no longer a candidate, but it must not be
 * swallowed by the merge that follows it either.
 */
export function attributeCommitsToFirstParents<T extends { hash: string }>(
  firstParentCommits: T[],
  allCommits: T[],
  parentsByHash: Map<string, string[]>,
  extraBoundaries: Set<string> = new Set(),
): Map<string, T[]> {
  const commitByHash = new Map(allCommits.map((commit) => [commit.hash, commit]));
  const positionByHash = new Map(allCommits.map((commit, index) => [commit.hash, index]));
  const firstParentShas = new Set([...firstParentCommits.map((commit) => commit.hash), ...extraBoundaries]);
  const assigned = new Set<string>();
  const result = new Map<string, T[]>();
  for (const mergeCommit of firstParentCommits) {
    const collected: T[] = [];
    const queue: string[] = [mergeCommit.hash];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const hash = queue.shift() as string;
      if (visited.has(hash)) {
        continue;
      }
      visited.add(hash);
      // Another first-parent commit owns its own side of the history, and a commit already
      // attributed belongs to the older merge that brought it in
      if ((hash !== mergeCommit.hash && firstParentShas.has(hash)) || assigned.has(hash)) {
        continue;
      }
      const commit = commitByHash.get(hash);
      if (!commit) {
        continue; // outside the window being listed
      }
      collected.push(commit);
      assigned.add(hash);
      for (const parentHash of parentsByHash.get(hash) || []) {
        queue.push(parentHash);
      }
    }
    // Back to the order of `git log`, which the Pull Request matching below relies on
    collected.sort((a, b) => (positionByHash.get(a.hash) ?? 0) - (positionByHash.get(b.hash) ?? 0));
    result.set(mergeCommit.hash, collected);
  }
  return result;
}

/** How many times a vehicle merge may be opened up again: integration -> uat -> preprod is 2 */
const MAX_VEHICLE_SPLIT_DEPTH = 5;

/**
 * The branches a merge commit merged in, as far as they can be read: the message ("Merge branch
 * 'X' into Y" for git and GitLab, "Merge pull request #N from org/X" for GitHub) and the source
 * branch of the Pull Request the merge commit closed.
 *
 * Only the merge commit itself is looked at, never the commits it brought in: a feature branch
 * that synced with its major branch before being merged holds such a merge, and reading it here
 * would turn the feature into a vehicle.
 */
export function mergedSourceBranches(
  commit: { hash: string; message: string },
  mergeCommitToPr: Map<string, number>,
  prDetailsMap: Map<number, any>,
): string[] {
  const branches: string[] = [];
  const messageBranch = extractSourceBranchFromMessage(commit.message);
  if (messageBranch) {
    branches.push(messageBranch);
  }
  const gitHubMatch = commit.message.match(/Merge pull request #\d+ from (\S+)/);
  if (gitHubMatch) {
    // owner/branch, and a branch name can hold slashes of its own
    const parts = gitHubMatch[1].split('/');
    branches.push(parts.length > 1 ? parts.slice(1).join('/') : gitHubMatch[1]);
  }
  // Azure DevOps writes the same sentence without the # and with the target branch after it, and
  // the source branch is given as it is, with no owner in front
  const azureMatch = commit.message.match(/Merge pull request \d+ from (\S+) into \S+/);
  if (azureMatch) {
    branches.push(azureMatch[1]);
  }
  const prNumber = mergeCommitToPr.get(commit.hash) ?? extractPrNumbersFromMessage(commit.message)[0];
  const pullRequest = prNumber ? prDetailsMap.get(prNumber) : null;
  if (pullRequest?.sourceBranch) {
    branches.push(pullRequest.sourceBranch);
  }
  return [...new Set(branches.filter((branch) => branch))];
}

/**
 * Whether a merge only moves other merges: a major branch merged into the next one
 * (integration -> uat), or a promotion branch merged into its target.
 */
export function isVehicleMerge(branches: string[], majorBranchNames: string[]): boolean {
  const majorBranches = new Set((majorBranchNames || []).map((branch) => (branch || '').toLowerCase()).filter((branch) => branch));
  return branches.some(
    (branch) => majorBranches.has(branch.toLowerCase()) || parsePromotionBranchName(branch) !== null
  );
}

/**
 * Replace every vehicle merge of a first-parent list by the first-parent commits it brought in.
 *
 * A promotion cherry-picks one candidate at a time, and a candidate is a first-parent commit of
 * the source branch. On a pipeline where User Stories are merged into `integration` and
 * `integration` is then merged into `uat`, every first-parent commit of `uat` is one of those
 * major-to-major merges: the whole promotion window is a single row, and picking one User Story
 * carries every story merged in the same sync. Opening the vehicle up gives back one row per
 * User Story, each cherry-picking its own merge commit.
 *
 * The list stays in `git log` order (newest first), the sub-commits taking the place of the
 * vehicle they came from. The loop runs again over what it produced, so a promotion merged into
 * `integration` and carried to `uat` by a sync is opened up in turn. Only a merge with exactly two
 * parents is opened up: an octopus merge would lose every side but the second one.
 */
export async function splitVehicleMerges<T extends { hash: string; message: string }>(
  firstParentCommits: T[],
  majorBranchNames: string[],
  parentsByHash: Map<string, string[]>,
  windowHashes: Set<string>,
  vehicleBranchesOf: (commit: T) => string[],
  logFirstParents: (fromCommit: string, toCommit: string) => Promise<T[]>,
): Promise<T[]> {
  let current = firstParentCommits;
  for (let depth = 0; depth < MAX_VEHICLE_SPLIT_DEPTH; depth++) {
    let changed = false;
    const next: T[] = [];
    for (const commit of current) {
      const parents = parentsByHash.get(commit.hash) || [];
      if (parents.length !== 2 || !isVehicleMerge(vehicleBranchesOf(commit), majorBranchNames)) {
        next.push(commit);
        continue;
      }
      const subCommits = await logFirstParents(parents[0], parents[1]);
      // A back-merge from the target branch opens up into commits that sit before the merge base,
      // outside the window being listed: nothing is known about them, and they are already in the
      // target branch anyway. The vehicle stays whole rather than becoming a page of dead rows.
      if (subCommits.length === 0 || subCommits.some((subCommit) => !windowHashes.has(subCommit.hash))) {
        next.push(commit);
        continue;
      }
      changed = true;
      next.push(...subCommits);
    }
    current = next;
    if (!changed) {
      break;
    }
  }
  return current;
}

export async function listMergedPrsWithCommits(
  parentBranch: string,
  currentBranch: string,
  sinceCommit: string | null,
  commandThis: any,
  options: { splitVehicleMergesFrom?: string[] } = {},
): Promise<BackpromotePrGroup[]> {
  uxLog('action', commandThis, c.cyan(t('backpromoteListingMergedPrs', { parentBranch: c.green(parentBranch) })));

  // Get first-parent commits on the parent branch (only direct merges/commits, not inherited ones)
  let firstParentLog;
  try {
    if (sinceCommit) {
      firstParentLog = await git().log(['--first-parent', `${sinceCommit}..${parentBranch}`]);
    } else {
      // No starting point: show recent history (50 commits)
      firstParentLog = await git().log(['--first-parent', '-n', '50', parentBranch]);
    }
  } catch {
    return [];
  }
  if (!firstParentLog || firstParentLog.all.length === 0) {
    return [];
  }

  // For each first-parent commit, discover the associated/inherited PRs
  // by looking at ALL commits reachable from it (not just first-parent)
  const allCommitsLog = sinceCommit
    ? await git().log([`${sinceCommit}..${parentBranch}`]).catch(() => null)
    : await git().log(['-n', '500', parentBranch]).catch(() => null);
  const allCommits = [...(allCommitsLog?.all || [])];

  // The parent of every commit of the window, in one call: which merge brought a commit in is a
  // question about the graph, and answering it from the dates is wrong for cherry-picks.
  const revListArgs = sinceCommit
    ? ['rev-list', '--parents', `${sinceCommit}..${parentBranch}`]
    : ['rev-list', '--parents', '-n', '500', parentBranch];
  const parentsByHash = parseCommitParents(await git().raw(revListArgs).catch(() => ''));

  // Discover PRs from all commits using the three strategies
  const prNumbersFromCommits = extractPrNumbersFromCommits(allCommits);
  const commitShaSet = new Set(allCommits.map((c) => c.hash));
  const sourceBranchesFromCommits = extractSourceBranchesFromCommits(allCommits);

  // Fetch merged PRs from git provider
  const gitProvider = await GitProvider.getInstance();
  const prDetailsMap = new Map<number, any>();
  const mergeCommitToPr = new Map<string, number>();
  const sourceBranchToPr = new Map<string, number>();

  if (gitProvider) {
    try {
      const allMergedPrs = (await gitProvider.listPullRequests({ status: 'merged' })) || [];
      for (const pr of allMergedPrs) {
        const prNum = pr.idNumber;
        if (!prNum) continue;
        const matchedByMessage = prNumbersFromCommits.has(prNum);
        const mergeSha = pr.mergeCommitSha;
        const matchedByMergeCommit = mergeSha && commitShaSet.has(mergeSha);
        const matchedBySourceBranch = pr.sourceBranch && sourceBranchesFromCommits.has(pr.sourceBranch);

        if (matchedByMessage || matchedByMergeCommit || matchedBySourceBranch) {
          prDetailsMap.set(prNum, pr);
          if (mergeSha) mergeCommitToPr.set(mergeSha, prNum);
          if (pr.sourceBranch) sourceBranchToPr.set(pr.sourceBranch, prNum);
        }
      }
    } catch (e) {
      uxLog('warning', commandThis, c.yellow(`[Backpromote] Unable to list pull requests: ${(e as Error).message}`));
    }
  }

  // A merge that only moves other merges (integration -> uat, a promotion merged into its target)
  // is opened up into the commits it brought in, so a promotion can carry one User Story instead
  // of a whole sync window. Only promotion:create asks for it, backpromote keeps its own grouping.
  const splitFrom = options.splitVehicleMergesFrom;
  const vehicleMergeHashes = new Set<string>();
  let firstParentNewestFirst = [...firstParentLog.all];
  if (splitFrom) {
    const windowHashes = new Set(allCommits.map((commit) => commit.hash));
    firstParentNewestFirst = await splitVehicleMerges(
      firstParentNewestFirst,
      splitFrom,
      parentsByHash,
      windowHashes,
      (commit) => mergedSourceBranches(commit, mergeCommitToPr, prDetailsMap),
      async (fromCommit, toCommit) => {
        const log = await git().log(['--first-parent', `${fromCommit}..${toCommit}`]).catch(() => null);
        return [...(log?.all || [])];
      },
    );
    const keptHashes = new Set(firstParentNewestFirst.map((commit) => commit.hash));
    for (const commit of firstParentLog.all) {
      if (!keptHashes.has(commit.hash)) {
        vehicleMergeHashes.add(commit.hash);
      }
    }
  }

  // The commits each candidate brought in, read from the graph (see attributeCommitsToFirstParents).
  // The vehicle merges that were opened up still stop the walk: their own message names the sync,
  // not a User Story, and it must not be attributed to the merge that follows them.
  const childCommitsByMerge = attributeCommitsToFirstParents(
    [...firstParentNewestFirst].reverse(),
    allCommits,
    parentsByHash,
    vehicleMergeHashes,
  );

  // Build groups: one per first-parent commit, with associated PRs as details
  const firstParentCommits = [...firstParentNewestFirst].reverse(); // Chronological order
  const prGroups: BackpromotePrGroup[] = [];

  for (const commit of firstParentCommits) {

    // The commits this merge brought in, read from the graph (see attributeCommitsToFirstParents)
    const childCommits = childCommitsByMerge.get(commit.hash) || [commit];

    // Discover associated PRs from child commits
    const associatedPrs: BackpromotePrGroup['associatedPrs'] = [];
    const seenPrIds = new Set<number>();
    const prConfigs: BackpromotePrGroup['prConfigs'] = [];

    for (const childCommit of childCommits) {
      let prNum: number | null = null;
      const prNumbersInMsg = extractPrNumbersFromMessage(childCommit.message);
      if (prNumbersInMsg.length > 0) prNum = prNumbersInMsg[0];
      if (prNum === null && mergeCommitToPr.has(childCommit.hash)) prNum = mergeCommitToPr.get(childCommit.hash)!;
      const sourceBranch = extractSourceBranchFromMessage(childCommit.message);
      if (prNum === null && sourceBranch && sourceBranchToPr.has(sourceBranch)) prNum = sourceBranchToPr.get(sourceBranch)!;

      if (prNum !== null && !seenPrIds.has(prNum)) {
        seenPrIds.add(prNum);
        const prDetail = prDetailsMap.get(prNum);
        const prTitle = prDetail?.title || `PR #${prNum}`;
        associatedPrs.push({
          id: prNum,
          title: prTitle,
          author: prDetail?.authorName || childCommit.author_name,
          webUrl: prDetail?.webUrl || '',
          sourceBranch: prDetail?.sourceBranch || sourceBranch || '',
        });
        const prConfig = await loadPrConfig(prNum);
        if (prConfig) prConfigs.push({ config: prConfig, prId: prNum, prTitle });
      } else if (sourceBranch && shouldAddVirtualPullRequest(associatedPrs, seenPrIds, sourceBranch)) {
        // Virtual PR from source branch name
        const titleMatch = childCommit.message.match(/^(.+?)\s*Merge branch/);
        const title = titleMatch ? titleMatch[1].trim() : sourceBranch;
        seenPrIds.add(0);
        associatedPrs.push({
          id: 0,
          title: title || sourceBranch,
          author: childCommit.author_name,
          webUrl: '',
          sourceBranch,
        });
      }
    }

    prGroups.push({
      commit: {
        hash: commit.hash,
        message: commit.message,
        author: commit.author_name,
        date: commit.date,
      },
      associatedPrs,
      prConfigs,
    });
  }

  return prGroups;
}

// Extract all source branch names from merge commit messages
function extractSourceBranchesFromCommits(commits: Array<{ message: string }>): Set<string> {
  const branches = new Set<string>();
  for (const commit of commits) {
    const branch = extractSourceBranchFromMessage(commit.message);
    if (branch) {
      branches.add(branch);
    }
  }
  return branches;
}

// Extract source branch name from a merge commit message.
// GitLab: "TITLE Merge branch 'feature/FOO' into 'TARGET'"
// Git merge: "Merge branch 'feature/FOO' into TARGET"
// Also handles: "Merge commit 'SHA' into BRANCH"
function extractSourceBranchFromMessage(message: string): string | null {
  // Match "Merge branch 'BRANCH_NAME' into"
  const branchMatch = message.match(/Merge branch '([^']+)' into/);
  if (branchMatch) {
    return branchMatch[1];
  }
  return null;
}

// Extract all PR/MR numbers referenced in commit messages
function extractPrNumbersFromCommits(commits: Array<{ message: string }>): Set<number> {
  const prNumbers = new Set<number>();
  for (const commit of commits) {
    for (const num of extractPrNumbersFromMessage(commit.message)) {
      prNumbers.add(num);
    }
  }
  return prNumbers;
}

// Extract PR/MR numbers from a single commit message.
// Matches patterns like: #123, Merge pull request #123, !123 (GitLab MR syntax)
function extractPrNumbersFromMessage(message: string): number[] {
  const numbers: number[] = [];
  // GitHub: "Merge pull request #123" or just "#123" in the message
  // GitLab: "Merge branch ... into ... See merge request org/repo!123"
  // Azure DevOps: "Merged PR 123:"
  const patterns = [
    /Merge pull request #(\d+)/g,
    /See merge request [^!]*!(\d+)/g,
    /Merged PR (\d+)/g,
    // Azure DevOps completing a Pull Request without fast-forward, which is what keeps the -x
    // trailers of a cherry-pick: "Merge pull request 52 from feature/X into integration", with no #
    /Merge pull request (\d+) from \S+ into \S+/g,
    // Generic #NNN reference (but avoid matching issue numbers in the middle of words)
    /(?:^|\s)#(\d+)(?:\s|$|[,.):])/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      const num = parseInt(match[1], 10);
      if (num > 0) {
        numbers.push(num);
      }
    }
  }
  return [...new Set(numbers)];
}

// Load PR-scoped config file if it exists
async function loadPrConfig(prId: number): Promise<any | null> {
  const prConfigFile = path.join('scripts', 'actions', `.sfdx-hardis.${prId}.yml`);
  if (!fs.existsSync(prConfigFile)) {
    return null;
  }
  try {
    const yaml = await import('js-yaml');
    return yaml.load(await fs.readFile(prConfigFile, 'utf-8'));
  } catch {
    return null;
  }
}

// ---- Detect org conflicts ----

export interface OrgConflictResult {
  conflicts: OrgConflictItem[];
  success: boolean;
  errorMessage?: string;
  /** Temp directory holding org-retrieved files. Kept alive after detection so VS Code can use it for visual diffs. */
  tmpRetrieveDir?: string;
  /** Path of an empty placeholder file used as the right side of the diff for "deleted locally" conflicts. */
  emptyPlaceholderPath?: string;
  /** Type:Name items of the delta that do not exist in the org yet */
  notInOrgKeys?: string[];
}

export async function detectOrgConflicts(
  deltaPackageXml: string,
  targetUsername: string,
  commandThis: any,
  debugMode: boolean,
  // Where the local files are read, when they are not the checked out ones (a plan for a parent branch)
  localPackageDirectories: Array<{ path: string; fullPath: string }> = [],
): Promise<OrgConflictResult> {
  uxLog('action', commandThis, c.cyan(t('backpromoteDetectingOrgConflicts')));

  // The temp dir is intentionally NOT cleaned at the end of this function:
  // org-retrieved files must remain on disk so VS Code can keep displaying
  // them in the side-by-side diff editor opened by promptOpenVisualDiffsInVsCode.
  const tmpRetrieveDir = await createTempDir();
  const conflicts: OrgConflictItem[] = [];
  let emptyPlaceholderPath: string | undefined;

  // First, filter the delta package.xml to only include items that exist in the org.
  // This prevents retrieve failures caused by metadata types or members not present in the target sandbox.
  const filteredPackageXml = path.join(tmpRetrieveDir, 'filtered-package.xml');
  const { packageXml: packageXmlForRetrieve, notInOrgKeys } = await filterPackageXmlToOrgAvailable(deltaPackageXml, filteredPackageXml, targetUsername, commandThis);

  if (!packageXmlForRetrieve) {
    return { conflicts, success: true, tmpRetrieveDir, notInOrgKeys }; // Nothing to retrieve
  }

  // Create a blank sfdx project in the temp directory so the retrieve command works
  await createBlankSfdxProject(tmpRetrieveDir);
  const blankProjectDir = path.join(tmpRetrieveDir, 'sfdx-hardis-blank-project');

  // Retrieve filtered metadata from the org into the blank project
  let retrieveSuccess = false;
  let retrieveError = '';
  try {
    const retrieveCmd = `sf project retrieve start -x "${packageXmlForRetrieve}" -o ${targetUsername} --output-dir "${blankProjectDir}" --wait 60 --json`;
    const result = await execCommand(retrieveCmd, commandThis, {
      fail: true,
      output: debugMode,
      debug: debugMode,
      cwd: blankProjectDir,
    });
    retrieveSuccess = result.status === 0 || !result.stderr;
    if (!retrieveSuccess) {
      retrieveError = result.stderr || result.stdout || 'Unknown error';
    }
  } catch (e) {
    retrieveError = (e as Error).message;
  }

  if (!retrieveSuccess) {
    uxLog('error', commandThis, c.red(t('backpromoteConflictDetectionFailed')));
    uxLog('error', commandThis, c.red(retrieveError));
    return { conflicts, success: false, errorMessage: retrieveError, tmpRetrieveDir, notInOrgKeys };
  }

  uxLog("action", commandThis, c.cyan(t('backpromoteComparingWithLocal')));

  // Parse the delta package.xml to know which metadata items to check
  const deltaContent = await parsePackageXmlFile(deltaPackageXml);
  const retrievePackageDir = [{ fullPath: path.resolve(blankProjectDir), path: blankProjectDir }];

  // Walk through retrieved metadata and compare with local
  for (const metadataType of Object.keys(deltaContent)) {
    const members = deltaContent[metadataType];
    // Locate the local and the retrieved source files of all the members in a single pass each,
    // instead of walking the package directories once per member
    const localFileByMember = await MetadataUtils.findMetaFilesFromTypeAndNames(metadataType, members, localPackageDirectories);
    const retrievedFileByMember = await MetadataUtils.findMetaFilesFromTypeAndNames(
      metadataType,
      members,
      retrievePackageDir
    );
    for (const member of members) {
      // Find the local file using existing utility
      const localFile = localFileByMember.get(member) ?? null;
      // Find the retrieved (org) file in the temp directory
      const retrievedFile = retrievedFileByMember.get(member) ?? null;

      if (!retrievedFile || !fs.existsSync(retrievedFile)) {
        continue; // Metadata not in org, nothing to compare
      }

      let status: OrgConflictItem['status'] = 'unchanged';
      let diffPreview = '';
      let diffMarkdown = '';
      let hasOrgChanges = false;

      if (!localFile || !fs.existsSync(localFile)) {
        status = 'deleted';
        hasOrgChanges = true;
        diffPreview = t('backpromoteFileExistsInOrgNotLocal');
        diffMarkdown = `> ${t('backpromoteFileExistsInOrgNotLocal')}\n`;
        // Lazily create a single empty placeholder file used as the "right" side
        // of the visual diff in VS Code for items that don't exist locally.
        if (!emptyPlaceholderPath) {
          emptyPlaceholderPath = path.join(tmpRetrieveDir, '.empty');
          await fs.writeFile(emptyPlaceholderPath, '', 'utf-8');
        }
      } else {
        const orgContentRaw = await fs.readFile(retrievedFile, 'utf-8');
        const localContentRaw = await fs.readFile(localFile, 'utf-8');

        // Normalize content before comparing: unify line endings, trim trailing whitespace per line
        const orgContent = normalizeForDiff(orgContentRaw);
        const localContent = normalizeForDiff(localContentRaw);

        // Compute diff ignoring whitespace differences. Whitespace-only diffs
        // (indentation, leading/trailing spaces) must not count as a conflict.
        const diffResult = Diff.diffLines(orgContent, localContent, { ignoreWhitespace: true });
        const hasRealChanges = diffResult.some((p) => p.added || p.removed);

        if (hasRealChanges) {
          status = 'modified';
          hasOrgChanges = true;

          // Build short preview from first changed lines
          const previewParts: string[] = [];
          for (const part of diffResult) {
            if (previewParts.length >= 5) break;
            if (part.added) {
              previewParts.push(`+${part.value.split('\n')[0]}`);
            } else if (part.removed) {
              previewParts.push(`-${part.value.split('\n')[0]}`);
            }
          }
          diffPreview = previewParts.join(' | ');
          const totalChanges = diffResult.filter((p) => p.added || p.removed).length;
          if (totalChanges > 5) {
            diffPreview += ` ... (+${totalChanges - 5} more)`;
          }

          // Build markdown with git-diff style: show only a few context lines around changes
          const contextLines = 3;
          diffMarkdown = buildDiffMarkdown(diffResult, contextLines);
        }
      }

      if (hasOrgChanges) {
        conflicts.push({
          metadataType,
          metadataName: member,
          status,
          localPath: localFile || '',
          orgPath: retrievedFile,
          diffPreview,
          diffMarkdown,
          hasOrgChanges,
        });
      }
    }
  }

  if (conflicts.length > 0) {
    uxLog('warning', commandThis, c.yellow(t('backpromoteOrgConflictsFound', { count: conflicts.length })));
  } else {
    uxLog('action', commandThis, c.green(t('backpromoteNoOrgConflicts')));
  }

  return { conflicts, success: true, tmpRetrieveDir, emptyPlaceholderPath, notInOrgKeys };
}

// ---- Generate conflict report ----

export async function generateConflictReport(
  conflicts: OrgConflictItem[],
  commandThis: any,
): Promise<{ excelPath: string; pdfPath: string | false }> {
  uxLog('action', commandThis, c.cyan(t('backpromoteGeneratingConflictReport')));
  const getConflictStatusLabel = (status: OrgConflictItem['status']) => {
    if (status === 'modified') {
      return t('backpromoteConflictStatusModifiedInOrg');
    }
    if (status === 'deleted') {
      return t('backpromoteConflictStatusDeletedLocally');
    }
    return status;
  };

  // CSV/Excel report
  const reportData = conflicts.map((item) => ({
    'Metadata Type': item.metadataType,
    'Name': item.metadataName,
    'Status': getConflictStatusLabel(item.status),
    'Diff Preview': item.diffPreview,
    'Local Path': item.localPath,
  }));

  const csvPath = await generateReportPath('backpromote-conflicts', '', {
    withDate: true,
    withBranchName: true,
    fileExtension: 'csv',
  });
  const csvResult = await generateCsvFile(reportData, csvPath, {
    fileTitle: t('backpromoteConflictReportTitle'),
  });
  const excelPath = csvResult?.xlsxFile || csvPath;
  uxLog('log', commandThis, c.cyan(t('backpromoteConflictReportGenerated', { excelPath: c.bold(excelPath) })));

  // Markdown -> PDF report
  const mdPath = csvPath.replace('.csv', '.md');
  let mdContent = `# ${t('backpromoteConflictReportTitle')}\n\n`;
  mdContent += `${t('backpromoteConflictReportGeneratedAt', { date: new Date().toISOString() })}\n\n`;
  mdContent += `**${conflicts.length}** ${t('backpromoteConflictReportSummary')}\n\n`;

  // Summary table with hyperlinks to details
  mdContent += `| # | ${t('backpromoteConflictReportTypeLabel')} | ${t('backpromoteConflictReportNameLabel')} | ${t('backpromoteConflictReportStatusLabel')} |\n`;
  mdContent += `|---|------|------|--------|\n`;
  for (let i = 0; i < conflicts.length; i++) {
    const item = conflicts[i];
    const anchor = `${item.metadataType.toLowerCase()}-${item.metadataName.toLowerCase()}`.replace(/[^a-z0-9-]/g, '-');
    const itemStatusLabel = getConflictStatusLabel(item.status);
    mdContent += `| ${i + 1} | ${item.metadataType} | [${item.metadataName}](#${anchor}) | ${itemStatusLabel} |\n`;
  }
  mdContent += '\n---\n\n';

  // Detailed diffs
  for (const item of conflicts) {
    const itemStatusLabel = getConflictStatusLabel(item.status);
    mdContent += `## ${item.metadataType}/${item.metadataName}\n\n`;
    mdContent += `**${t('backpromoteConflictReportStatusLabel')}:** ${itemStatusLabel} | **${t('backpromoteConflictReportPathLabel')}:** \`${item.localPath}\`\n\n`;
    if (item.diffMarkdown) {
      mdContent += item.diffMarkdown + '\n';
    }
    mdContent += '---\n\n';
  }

  await fs.writeFile(mdPath, mdContent, 'utf-8');
  // Try to generate PDF (5 min timeout for large reports), fall back to markdown if it fails
  uxLog('log', commandThis, c.grey(t('backpromoteStartingReportGeneration')));
  let pdfPath: string | false = false;
  try {
    pdfPath = await generatePdfFileFromMarkdown(mdPath, { timeoutMs: 300000 });
  } catch (e) {
    uxLog('warning', commandThis, c.yellow(`[Backpromote] PDF generation failed: ${(e as Error).message}`));
  }
  if (pdfPath) {
    uxLog('log', commandThis, c.cyan(t('backpromoteConflictReportPdfGenerated', { pdfPath: c.bold(pdfPath) })));
    WebSocketClient.sendReportFileMessage(pdfPath, t('backpromoteConflictReportPdfLabel'), 'report');
    uxLog('action', commandThis, c.yellow(t('backpromoteOpenReportToCheckOverwrites')));
  } else {
    WebSocketClient.sendReportFileMessage(mdPath, t('backpromoteConflictReportTitle') + ' (MD)', 'report');
    uxLog('action', commandThis, c.yellow(t('backpromoteOpenReportToCheckOverwrites')));
  }

  return { excelPath, pdfPath };
}

// ---- Prompt to open visual diffs in VS Code ----

export async function promptOpenVisualDiffsInVsCode(
  conflicts: OrgConflictItem[],
  emptyPlaceholderPath: string | undefined,
  commandThis: any,
  agentMode: boolean,
): Promise<boolean> {
  if (agentMode || isCI) {
    return false;
  }
  if (conflicts.length === 0) {
    return false;
  }
  if (!WebSocketClient.isAlive()) {
    return false;
  }

  const confirmRes = await prompts({
    type: 'confirm',
    name: 'value',
    message: c.cyanBright(t('backpromoteOpenVisualDiffsInVsCodePrompt')),
    description: t('backpromoteOpenVisualDiffsInVsCodePrompt'),
    initial: true,
  });

  if (confirmRes.value !== true) {
    uxLog('action', commandThis, c.cyan(t('backpromoteVisualDiffsSkippedByUser')));
    return false;
  }

  const diffs: OrgDiffItem[] = [];
  let placeholder = emptyPlaceholderPath;
  for (const item of conflicts) {
    if (item.status === 'added' && item.localPath) {
      // File exists locally but not in org - show empty left side vs local file
      if (!placeholder) {
        placeholder = path.join(path.dirname(item.localPath), '.empty');
        await fs.writeFile(placeholder, '', 'utf-8');
      }
      diffs.push({
        leftPath: placeholder,
        rightPath: item.localPath,
        title: t('backpromoteVisualDiffTitleAddedLocally', {
          type: item.metadataType,
          name: item.metadataName,
        }),
        metadataType: item.metadataType,
        metadataName: item.metadataName,
        status: 'added',
      });
    } else if (item.status === 'deleted' && item.orgPath) {
      // File exists in org but not locally - show org file vs empty right side
      if (!placeholder) {
        placeholder = path.join(path.dirname(item.orgPath), '.empty');
        await fs.writeFile(placeholder, '', 'utf-8');
      }
      diffs.push({
        leftPath: item.orgPath,
        rightPath: placeholder,
        title: t('backpromoteVisualDiffTitleDeletedLocally', {
          type: item.metadataType,
          name: item.metadataName,
        }),
        metadataType: item.metadataType,
        metadataName: item.metadataName,
        status: 'deleted',
      });
    } else if (item.status === 'modified' && item.orgPath && item.localPath) {
      diffs.push({
        leftPath: item.orgPath,
        rightPath: item.localPath,
        title: t('backpromoteVisualDiffTitleModified', {
          type: item.metadataType,
          name: item.metadataName,
        }),
        metadataType: item.metadataType,
        metadataName: item.metadataName,
        status: 'modified',
      });
    }
  }

  if (diffs.length === 0) {
    return false;
  }

  WebSocketClient.sendVscodeDiffMessage(diffs);
  uxLog('action', commandThis, c.cyan(t('backpromoteVisualDiffsOpenedInVsCode', { count: diffs.length })));
  return true;
}

// ---- Prompt metadata validation ----

export async function promptMetadataValidation(
  deltaPackageXml: string,
  destructiveChangesXml: string | null,
  conflicts: OrgConflictItem[],
  commandThis: any,
  agentMode: boolean,
  instanceUrl: string = '',
  diffsShownInVsCode: boolean = false,
): Promise<{ validatedPackageXml: string; validatedDestructiveXml: string | null }> {
  const deltaContent = await parsePackageXmlFile(deltaPackageXml);

  // Build flat list of items
  const allItems: Array<{ type: string; member: string; hasConflict: boolean }> = [];
  for (const mdType of Object.keys(deltaContent)) {
    for (const member of deltaContent[mdType]) {
      const conflict = conflicts.find((c) => c.metadataType === mdType && c.metadataName === member);
      allItems.push({ type: mdType, member, hasConflict: !!conflict });
    }
  }

  if (allItems.length === 0) {
    uxLog('action', commandThis, c.cyan(t('backpromoteNoDelta')));
    return { validatedPackageXml: deltaPackageXml, validatedDestructiveXml: destructiveChangesXml };
  }

  uxLog('log', commandThis, c.cyan(t('backpromoteDeltaSummary', {
    addedModified: allItems.length,
    deleted: destructiveChangesXml && fs.existsSync(destructiveChangesXml) ? await countPackageXmlItems(destructiveChangesXml) : 0,
  })));

  // Display items table (skipped when diffs are already shown in VS Code)
  if (!diffsShownInVsCode) {
    const tableData = allItems.map((item) => ({
      'Type': item.type,
      'Name': item.member,
      'Conflict': item.hasConflict ? `⚠️ ${t('backpromoteModifiedInOrg')}` : '-',
    }));
    await uxLogTableWithReport(commandThis, tableData, ['Type', 'Name', 'Conflict'], {
      fileNamePrefix: 'backpromote-delta-items',
      fileTitle: 'Backpromote delta items',
    });
  }

  if (agentMode || isCI) {
    // In agent mode, deploy everything
    return { validatedPackageXml: deltaPackageXml, validatedDestructiveXml: destructiveChangesXml };
  }

  // Interactive: let user deselect items
  const choices = allItems.map((item) => ({
    title: `${item.type}/${item.member}${item.hasConflict ? ` \u26a0\ufe0f (${t('backpromoteModifiedInOrg')})` : ''}`,
    value: `${item.type}::${item.member}`,
    selected: true,
  }));

  const selectRes = await prompts({
    type: 'multiselect',
    name: 'value',
    message: c.cyanBright(t('backpromoteSelectMetadataToDeploy', { instanceUrl })),
    description: t('backpromoteSelectMetadataToDeploy', { instanceUrl }),
    choices,
  });

  const selectedSet = new Set<string>(selectRes.value || allItems.map((i) => `${i.type}::${i.member}`));

  // Build filtered package.xml
  const filteredContent: Record<string, string[]> = {};
  for (const item of allItems) {
    const key = `${item.type}::${item.member}`;
    if (selectedSet.has(key)) {
      if (!filteredContent[item.type]) {
        filteredContent[item.type] = [];
      }
      filteredContent[item.type].push(item.member);
    }
  }

  const validatedPackageXml = deltaPackageXml.replace('package.xml', 'package-validated.xml');
  await writePackageXmlFile(validatedPackageXml, filteredContent);

  return { validatedPackageXml, validatedDestructiveXml: destructiveChangesXml };
}

// ---- Prompt after conflict detection failure ----

export async function promptConfirmContinueAfterConflictFailure(
  errorMessage: string,
  commandThis: any,
): Promise<boolean> {
  uxLog('error', commandThis, c.red(t('backpromoteConflictDetectionFailed')));
  uxLog('error', commandThis, c.red(errorMessage));
  uxLog('warning', commandThis, c.yellow(t('backpromoteConflictDetectionFailedExplain')));

  const confirmRes = await prompts({
    type: 'confirm',
    name: 'value',
    message: c.cyanBright(t('backpromoteConflictDetectionFailedContinue')),
    description: t('backpromoteConflictDetectionFailedContinue'),
    initial: false,
  });

  return confirmRes.value === true;
}

// ---- Handle destructive changes ----

export async function confirmDestructiveChanges(
  destructiveChangesXml: string,
  commandThis: any,
  agentMode: boolean,
): Promise<boolean> {
  if (!fs.existsSync(destructiveChangesXml) || await isPackageXmlEmpty(destructiveChangesXml)) {
    return false;
  }

  const destructiveContent = await parsePackageXmlFile(destructiveChangesXml);
  let totalItems = 0;
  const items: Array<{ Type: string; Name: string }> = [];
  for (const mdType of Object.keys(destructiveContent)) {
    for (const member of destructiveContent[mdType]) {
      items.push({ Type: mdType, Name: member });
      totalItems++;
    }
  }

  uxLog('warning', commandThis, c.yellow(t('backpromoteDestructiveChangesWarning', { count: totalItems })));
  await uxLogTableWithReport(commandThis, items, ['Type', 'Name'], {
    fileNamePrefix: 'backpromote-destructive-changes',
    fileTitle: 'Backpromote destructive changes',
  });

  if (agentMode || isCI) {
    uxLog('warning', commandThis, c.yellow(t('backpromoteDestructiveChangesAutoConfirmed')));
    return true;
  }

  const confirmRes = await prompts({
    type: 'confirm',
    name: 'value',
    message: c.cyanBright(t('backpromoteConfirmDestructiveChanges')),
    description: t('backpromoteConfirmDestructiveChanges'),
    initial: false,
  });

  return confirmRes.value === true;
}

// ---- Deploy metadata ----

export async function deployBackpromoteMetadata(
  packageXmlFile: string,
  destructiveChangesFile: string | null,
  targetUsername: string,
  testClasses: string[],
  commandThis: any,
  debugMode: boolean,
  agentMode: boolean = false,
): Promise<void> {
  if (!fs.existsSync(packageXmlFile) || await isPackageXmlEmpty(packageXmlFile)) {
    // Check if we have destructive changes only
    if (!destructiveChangesFile || !fs.existsSync(destructiveChangesFile) || await isPackageXmlEmpty(destructiveChangesFile)) {
      uxLog('action', commandThis, c.cyan(t('backpromoteNoDelta')));
      return;
    }
  }

  const itemCount = fs.existsSync(packageXmlFile) ? await countPackageXmlItems(packageXmlFile) : 0;
  uxLog('action', commandThis, c.cyan(t('backpromoteDeploying', { count: itemCount })));

  const testLevel = testClasses.length > 0 ? 'RunSpecifiedTests' : 'NoTestRun';
  if (testClasses.length > 0) {
    uxLog('log', commandThis, c.grey(t('backpromoteTestClassesFromPrs', { classes: testClasses.join(', ') })));
  }

  const deployCmd =
    `sf project deploy start` +
    ` --manifest "${packageXmlFile}"` +
    ' --ignore-warnings' +
    ' --ignore-conflicts' +
    ` --test-level ${testLevel}` +
    (testClasses.length > 0 ? ` --tests ${testClasses.join(',')}` : '') +
    (destructiveChangesFile && fs.existsSync(destructiveChangesFile) ? ` --post-destructive-changes "${destructiveChangesFile}"` : '') +
    ` -o ${targetUsername}` +
    ` --wait ${getEnvVar('SFDX_DEPLOY_WAIT_MINUTES') || '120'}` +
    ' --json';

  const result = await runDeploy(deployCmd, testLevel, commandThis, debugMode);

  // If deployment failed because of test classes or coverage, offer to retry without tests
  if (!result.success && testClasses.length > 0 && (result.hasTestFailures || result.hasCoverageFailures)) {
    uxLog('warning', commandThis, c.yellow(t('backpromoteDeployTestFailure')));
    let retryWithoutTests = agentMode; // Agent mode: auto-retry without tests
    if (!retryWithoutTests && !isCI) {
      const retryRes = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyanBright(t('backpromoteRetryWithoutTests')),
        description: t('backpromoteRetryWithoutTests'),
        initial: true,
      });
      retryWithoutTests = retryRes.value === true;
    }
    if (retryWithoutTests) {
      uxLog('action', commandThis, c.cyan(t('backpromoteRetryingWithoutTests')));
      const noTestCmd =
        `sf project deploy start` +
        ` --manifest "${packageXmlFile}"` +
        ' --ignore-warnings' +
        ' --ignore-conflicts' +
        ' --test-level NoTestRun' +
        (destructiveChangesFile && fs.existsSync(destructiveChangesFile) ? ` --post-destructive-changes "${destructiveChangesFile}"` : '') +
        ` -o ${targetUsername}` +
        ` --wait ${getEnvVar('SFDX_DEPLOY_WAIT_MINUTES') || '120'}` +
        ' --json';
      const retryResult = await runDeploy(noTestCmd, 'NoTestRun', commandThis, debugMode);
      await writeDeployReport(retryResult, targetUsername, itemCount, 'NoTestRun', [], packageXmlFile, destructiveChangesFile, commandThis);
      if (!retryResult.success) {
        throw new SfError(t('backpromoteDeployFailed'));
      }
      uxLog('warning', commandThis, c.yellow(t('backpromoteDeploySuccessButFixTests')));
      uxLog('action', commandThis, c.green(t('backpromoteDeploySuccess', { count: itemCount })));
      return;
    }
  }

  await writeDeployReport(result, targetUsername, itemCount, testLevel, testClasses, packageXmlFile, destructiveChangesFile, commandThis);

  if (!result.success) {
    throw new SfError(t('backpromoteDeployFailed'));
  }

  uxLog('action', commandThis, c.green(t('backpromoteDeploySuccess', { count: itemCount })));
}

// ---- Deploy helpers ----

interface DeployResult {
  success: boolean;
  output: string;
  hasTestFailures: boolean;
  hasCoverageFailures: boolean;
}

async function runDeploy(
  deployCmd: string,
  _testLevel: string,
  commandThis: any,
  debugMode: boolean,
): Promise<DeployResult> {
  try {
    const deployResult = await execCommand(deployCmd, commandThis, {
      fail: true,
      output: true,
      debug: debugMode,
    });
    return { success: true, output: deployResult.stdout || '', hasTestFailures: false, hasCoverageFailures: false };
  } catch (e) {
    const output = ((e as any).stdout || '') + ((e as any).stderr || '');
    const { errLog, failedTests, errorsAndTips } = await analyzeDeployErrorLogs(output, true, { label: 'backpromote' });
    uxLog('error', commandThis, c.red(t('backpromoteDeployFailed')));
    uxLog('error', commandThis, c.red('\n' + errLog));
    const hasTestFailures = (failedTests || []).length > 0;
    const hasCoverageFailures = (errorsAndTips || []).some(
      (item: any) => item?.tip?.label === 'CodeCoverageWarning'
    );
    return { success: false, output, hasTestFailures, hasCoverageFailures };
  }
}

async function writeDeployReport(
  result: { success: boolean; output: string },
  targetUsername: string,
  itemCount: number,
  testLevel: string,
  testClasses: string[],
  packageXmlFile: string,
  destructiveChangesFile: string | null,
  commandThis: any,
): Promise<void> {
  const reportPath = await generateReportPath('backpromote-deploy', '', {
    withDate: true,
    withBranchName: true,
    fileExtension: 'log',
  });
  const reportContent = [
    'Backpromote Deployment Report',
    `Date: ${new Date().toISOString()}`,
    `Target org: ${targetUsername}`,
    `Status: ${result.success ? 'SUCCESS' : 'FAILED'}`,
    `Items: ${itemCount}`,
    `Test level: ${testLevel}`,
    testClasses.length > 0 ? `Test classes: ${testClasses.join(', ')}` : '',
    `Package XML: ${packageXmlFile}`,
    destructiveChangesFile ? `Destructive changes: ${destructiveChangesFile}` : '',
    '',
    '--- Deployment output ---',
    result.output,
  ].filter(Boolean).join('\n');
  await fs.writeFile(reportPath, reportContent, 'utf-8');
  uxLog('log', commandThis, c.grey(t('backpromoteDeployReportSaved', { reportPath })));
  WebSocketClient.sendReportFileMessage(reportPath, t('backpromoteDeployReportLabel'), 'report');
}

// ---- Execute deployment actions ----

export type BackpromoteActionCandidate = PrePostCommand & { prLabel: string; prId: number; commitHash: string };

/**
 * The deployment actions of the given groups for one phase. Actions not meant for developer
 * sandboxes are dropped: there is no Pull Request comment here to carry a skipped row. An invalid
 * definition (both filter lists set) is a warning rather than a failure: backpromote is an
 * interactive developer command, not a pipeline gate.
 */
export function collectBackpromoteActions(
  selectedPrs: BackpromotePrGroup[],
  currentBranch: string,
  phase: 'commandsPreDeploy' | 'commandsPostDeploy',
  commandThis: any,
): BackpromoteActionCandidate[] {
  const allActions: BackpromoteActionCandidate[] = [];
  // A backpromote always deploys to a developer sandbox, so branch filters are evaluated against
  // the dev-sandboxes virtual name (the feature branch name stays eligible too).
  const targetBranchCandidates = [DEV_SANDBOXES_BRANCH_NAME, currentBranch];
  for (const prGroup of selectedPrs) {
    for (const { config: prConfig, prId, prTitle } of prGroup.prConfigs) {
      const commands = prConfig[phase];
      if (!Array.isArray(commands)) continue;
      const prLabel = prId > 0 ? `#${prId} - ${prTitle}` : prTitle;
      for (const cmd of commands) {
        const branchFilterVerdict = evaluateActionBranchFilter(cmd, targetBranchCandidates);
        if (branchFilterVerdict.run === false) {
          if (branchFilterVerdict.invalid) {
            uxLog('warning', commandThis, c.yellow(`[Backpromote] ${cmd.label}: ${branchFilterVerdict.reason}`));
          } else {
            uxLog('log', commandThis, c.grey(`[Backpromote] ${t('backpromoteActionSkippedBranchFilter', { label: cmd.label })}`));
          }
          continue;
        }
        if (allActions.some((action) => action.id === cmd.id)) {
          continue;
        }
        allActions.push({ ...cmd, prLabel, prId, commitHash: prGroup.commit.hash });
      }
    }
  }
  return allActions;
}

/**
 * What an action run leaves in the backpromote state. A manual action only prints its instructions:
 * recording it as a success would make the next run skip it as already done, while nobody did it.
 */
export function backpromoteActionStatusFromResult(result: { statusCode?: string } | void | null): BackpromoteActionEntry['status'] {
  switch (result?.statusCode) {
    case 'manual':
      return 'manual';
    case 'failed':
      return 'failed';
    case 'skipped':
    case 'not-run':
      return 'skipped';
    default:
      return 'success';
  }
}

export async function executeBackpromoteActions(
  selectedPrs: BackpromotePrGroup[],
  currentBranch: string,
  phase: 'commandsPreDeploy' | 'commandsPostDeploy',
  targetUsername: string,
  conn: any,
  commandThis: any,
  agentMode: boolean,
  options: {
    actionIds?: string[] | null;
    skipActions?: boolean;
    nonInteractive?: boolean;
    /** Actions that already ran successfully in the target org (from the Pull Request comments): id -> date */
    actionsDoneInOrg?: Map<string, string>;
    /** Receives the result of each action, to be recorded in the Pull Request comments */
    recordActionResult?: (entry: BackpromoteActionEntry) => void;
  } = {},
): Promise<void> {
  if (options.skipActions === true) {
    return;
  }
  const allActions = collectBackpromoteActions(selectedPrs, currentBranch, phase, commandThis);

  if (allActions.length === 0) {
    return;
  }

  const phaseLabel = phase === 'commandsPreDeploy' ? t('actionWhenPreDeploy') : t('actionWhenPostDeploy');
  uxLog('action', commandThis, c.cyan(t('backpromoteExecutingActions', { count: allActions.length })));

  const manualActions: Array<{ id: string; label: string; username: string; prLabel: string; prId: number }> = [];
  const actionsDoneInOrg = options.actionsDoneInOrg || new Map<string, string>();
  const recordActionResult = options.recordActionResult || (() => undefined);

  // Let the user select which actions to run (already-executed ones are deselected by default)
  let selectedActionIds: Set<string>;
  if (options.actionIds) {
    // Explicit selection (--actions): run exactly those, whatever ran before
    const availableIds = new Set(allActions.map((action) => action.id));
    selectedActionIds = new Set<string>(options.actionIds.filter((id) => availableIds.has(id)));
  } else if (!agentMode && !isCI && !options.nonInteractive) {
    const actionChoices = allActions.map((action) => {
      const doneDate = actionsDoneInOrg.get(action.id);
      const alreadyDone = !!doneDate;
      const suffix = alreadyDone ? ` (${t('backpromoteActionAlreadyDone', { date: formatShortDate(doneDate as string) })})` : '';
      return {
        title: `[${phaseLabel}] ${action.label} (${action.prLabel})${suffix}`,
        value: action.id,
        selected: !alreadyDone,
      };
    });
    const selectRes = await prompts({
      type: 'multiselect',
      name: 'value',
      message: c.cyanBright(t('backpromoteSelectActions', { phase: phaseLabel })),
      description: t('backpromoteSelectActions', { phase: phaseLabel }),
      choices: actionChoices,
    });
    selectedActionIds = new Set<string>(selectRes.value || []);
  } else {
    // Agent mode: auto-exclude already-executed actions
    selectedActionIds = new Set<string>(allActions.filter((action) => !actionsDoneInOrg.has(action.id)).map((action) => action.id));
    // Log skipped actions
    for (const action of allActions) {
      if (!selectedActionIds.has(action.id)) {
        uxLog('log', commandThis, c.grey(`[Backpromote] ${t('backpromoteSkippingActionAlreadyExecutedOn', { label: action.label, date: actionsDoneInOrg.get(action.id) || '' })}`));
      }
    }
  }

  if (selectedActionIds.size === 0) {
    uxLog('action', commandThis, c.cyan(`[Backpromote] ${t('backpromoteNoPhaseActionsSelected', { phase: phaseLabel })}`));
    return;
  }

  uxLog('action', commandThis, c.cyan(t('backpromoteExecutingActions', { count: selectedActionIds.size })));

  // Store connection for actions that need it
  globalThis.jsForceConn = conn;

  for (const action of allActions) {
    if (!selectedActionIds.has(action.id)) {
      continue;
    }

    let actionStatus: BackpromoteActionEntry['status'] = 'failed';

    if (action.customUsername) {
      // Try LoginAs
      const user = await findUserByUsernameLike(action.customUsername, conn);
      if (!user) {
        uxLog('warning', commandThis, c.yellow(t('backpromoteActionLoginAsFailed', {
          username: action.customUsername,
          label: action.label,
        })));
        manualActions.push({ id: action.id, label: action.label, username: action.customUsername, prLabel: action.prLabel, prId: action.prId });
        actionStatus = 'manual';
      } else {
        try {
          const instanceUrl = conn.instanceUrl;
          const authResult = await authOrg('', { forceUsername: user.Username, instanceUrl, setDefault: false });
          if (authResult === true) {
            uxLog('log', commandThis, c.green(t('backpromoteActionLoginAsSuccess', { username: user.Username, label: action.label })));
            const actionInstance = await ActionsProvider.buildActionInstance(action);
            actionInstance.customUsernameToUse = user.Username;
            try {
              uxLog('action', commandThis, c.cyan(t('backpromoteRunningAction', { label: action.label })));
              actionStatus = backpromoteActionStatusFromResult(await actionInstance.run(action));
              if (actionStatus === 'success') {
                uxLog('success', commandThis, c.green(`[Backpromote] ${t('backpromoteActionCompletedSuccessfully', { label: action.label })}`));
              }
            } catch (e) {
              uxLog('error', commandThis, c.red(`[Backpromote] ${t('backpromoteActionFailedWithMessage', { label: action.label, message: (e as Error).message })}`));
            }
          } else {
            uxLog('warning', commandThis, c.yellow(t('backpromoteActionLoginAsFailed', { username: user.Username, label: action.label })));
            manualActions.push({ id: action.id, label: action.label, username: action.customUsername, prLabel: action.prLabel, prId: action.prId });
            actionStatus = 'manual';
          }
        } catch {
          uxLog('warning', commandThis, c.yellow(t('backpromoteActionLoginAsFailed', { username: action.customUsername, label: action.label })));
          manualActions.push({ id: action.id, label: action.label, username: action.customUsername, prLabel: action.prLabel, prId: action.prId });
          actionStatus = 'manual';
        }
      }
    } else {
      // Execute directly
      const actionInstance = await ActionsProvider.buildActionInstance(action);
      if (actionInstance) {
        try {
          uxLog('action', commandThis, c.cyan(t('backpromoteRunningAction', { label: action.label })));
          actionStatus = backpromoteActionStatusFromResult(await actionInstance.run(action));
          if (actionStatus === 'success') {
            uxLog('success', commandThis, c.green(`[Backpromote] ${t('backpromoteActionCompletedSuccessfully', { label: action.label })}`));
          }
        } catch (e) {
          uxLog('error', commandThis, c.red(`[Backpromote] ${t('backpromoteActionFailedWithMessage', { label: action.label, message: (e as Error).message })}`));
        }
      }
    }

    // Recorded in the Pull Request comment of the action's Pull Request, for this org
    recordActionResult({
      actionId: action.id,
      actionLabel: action.label,
      prId: action.prId,
      status: actionStatus,
      date: new Date().toISOString(),
    });
  }

  // Handle manual actions with one-by-one validation
  if (manualActions.length > 0 && !agentMode && !isCI) {
    uxLog('action', commandThis, c.cyan(t('backpromoteManualActionsRequired', { count: manualActions.length })));
    for (const manualAction of manualActions) {
      const actionRes = await prompts({
        type: 'text',
        name: 'value',
        message: c.cyanBright(t('backpromoteManualActionPrompt', {
          label: manualAction.label,
          username: manualAction.username,
        })),
        description: t('backpromoteManualActionPrompt', {
          label: manualAction.label,
          username: manualAction.username,
        }),
      });
      if (actionRes.value === 's' || actionRes.value === 'S') {
        uxLog('action', commandThis, c.cyan(t('backpromoteManualActionSkipped', { label: manualAction.label })));
      } else {
        uxLog('action', commandThis, c.cyan(t('backpromoteManualActionCompleted', { label: manualAction.label })));
        recordActionResult({
          actionId: manualAction.id,
          actionLabel: manualAction.label,
          prId: manualAction.prId,
          status: 'success',
          date: new Date().toISOString(),
        });
      }
    }
  } else if (manualActions.length > 0) {
    // In agent mode, just log the manual actions
    uxLog('warning', commandThis, c.yellow(t('backpromoteManualActionsRequired', { count: manualActions.length })));
    for (const manualAction of manualActions) {
      uxLog('warning', commandThis, c.yellow(t('backpromoteActionRequiresLoginAs', {
        label: manualAction.label,
        username: manualAction.username,
      })));
    }
  }
}

// ---- Deployment action results (recorded in the Pull Request comments) ----

export interface BackpromoteActionEntry {
  actionId: string;
  actionLabel: string;
  prId: number;
  status: 'success' | 'failed' | 'warning' | 'manual' | 'skipped';
  date: string;
}

// ---- Collect test classes from PRs ----

export function collectTestClassesFromPrs(selectedPrs: BackpromotePrGroup[]): string[] {
  const testClasses: string[] = [];
  for (const prGroup of selectedPrs) {
    for (const { config: prConfig } of prGroup.prConfigs) {
      if (prConfig?.deploymentApexTestClasses && Array.isArray(prConfig.deploymentApexTestClasses)) {
        testClasses.push(...prConfig.deploymentApexTestClasses);
      }
    }
  }
  // Deduplicate
  return [...new Set(testClasses)];
}

// ---- Filter package.xml to org-available items ----

async function filterPackageXmlToOrgAvailable(
  deltaPackageXml: string,
  outputPackageXml: string,
  targetUsername: string,
  commandThis: any,
): Promise<{ packageXml: string | null; notInOrgKeys: string[] }> {
  const deltaContent = await parsePackageXmlFile(deltaPackageXml);
  if (Object.keys(deltaContent).length === 0) {
    return { packageXml: null, notInOrgKeys: [] };
  }

  // Build a full org manifest to know what metadata exists in the target sandbox
  const orgManifestPath = await buildOrgManifest(targetUsername, null, null, { excludePackages: true, logType: "log" });
  const orgContent = await parsePackageXmlFile(orgManifestPath);

  // Intersect: keep only delta items that exist in the org
  const filteredContent: Record<string, string[]> = {};
  const filteredOutItems: Array<{ Type: string; Name: string }> = [];
  let remainingCount = 0;

  for (const metadataType of Object.keys(deltaContent)) {
    const orgMembers = new Set<string>(orgContent[metadataType] || []);
    for (const member of deltaContent[metadataType]) {
      if (orgMembers.has(member)) {
        if (!filteredContent[metadataType]) {
          filteredContent[metadataType] = [];
        }
        filteredContent[metadataType].push(member);
        remainingCount++;
      } else {
        filteredOutItems.push({ Type: metadataType, Name: member });
      }
    }
  }

  // Display filtered-out items
  if (filteredOutItems.length > 0) {
    uxLog('log', commandThis, c.grey(t('backpromoteFilteredOutItems', { count: filteredOutItems.length })));
    await uxLogTableWithReport(commandThis, filteredOutItems, ['Type', 'Name'], {
      fileNamePrefix: 'backpromote-filtered-out-items',
      fileTitle: 'Backpromote filtered out items',
    });
  }
  uxLog('log', commandThis, c.grey(t('backpromoteFilteredRemainingItems', { count: remainingCount })));
  const notInOrgKeys = filteredOutItems.map((item) => `${item.Type}:${item.Name}`);

  if (Object.keys(filteredContent).length === 0) {
    return { packageXml: null, notInOrgKeys };
  }

  await writePackageXmlFile(outputPackageXml, filteredContent);
  return { packageXml: outputPackageXml, notInOrgKeys };
}

// ---- Helper: format date ----

// Build markdown diff output showing only a few context lines around each change
function buildDiffMarkdown(diffResult: Diff.Change[], contextLines: number): string {
  // Flatten all parts into tagged lines
  const taggedLines: Array<{ tag: '+' | '-' | ' '; text: string }> = [];
  for (const part of diffResult) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    const tag = part.added ? '+' : part.removed ? '-' : ' ';
    for (const line of lines) {
      taggedLines.push({ tag: tag as '+' | '-' | ' ', text: line });
    }
  }

  // Determine which lines to show: changed lines + contextLines before/after
  const showLine = new Array(taggedLines.length).fill(false);
  for (let i = 0; i < taggedLines.length; i++) {
    if (taggedLines[i].tag !== ' ') {
      const from = Math.max(0, i - contextLines);
      const to = Math.min(taggedLines.length - 1, i + contextLines);
      for (let j = from; j <= to; j++) {
        showLine[j] = true;
      }
    }
  }

  // Build output with "..." separators between non-contiguous shown regions
  let md = '```diff\n';
  let lastShownIndex = -2;
  for (let i = 0; i < taggedLines.length; i++) {
    if (!showLine[i]) continue;
    if (lastShownIndex >= 0 && i - lastShownIndex > 1) {
      md += '  ...\n';
    }
    const { tag, text } = taggedLines[i];
    md += `${tag} ${text}\n`;
    lastShownIndex = i;
  }
  md += '```\n';
  return md;
}

// Normalize content for diff comparison: unify line endings, trim trailing whitespace per line
function normalizeForDiff(content: string): string {
  return content
    .replace(/\r\n/g, '\n')   // CRLF -> LF
    .replace(/\r/g, '\n')     // CR -> LF
    .split('\n')
    .map((line) => line.trimEnd()) // Trim trailing whitespace per line
    .join('\n')
    .trimEnd() + '\n';        // Ensure single trailing newline
}

function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toISOString().split('T')[0];
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const date = d.toISOString().split('T')[0];
    const time = d.toISOString().split('T')[1].substring(0, 5);
    return `${date} ${time}`;
  } catch {
    return dateStr;
  }
}
/* jscpd:ignore-end */
