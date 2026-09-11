/* jscpd:ignore-start */
import { SfError } from '@salesforce/core';
import c from 'chalk';
import { spawnSync } from 'child_process';
import fs from './fsUtils.js';
import * as path from 'path';
import { execCommand, git, isCI, uxLog } from './index.js';
import { analyzeDeployErrorLogs } from './deployTips.js';
import { getConfig, getEnvVar } from '../../config/index.js';
import { GitProvider } from '../gitProvider/index.js';
import { countPackageXmlItems, isPackageXmlEmpty, parsePackageXmlFile } from './xmlUtils.js';
import { generateReportPath, uxLogTableWithReport } from './filesUtils.js';
import { prompts } from './prompts.js';
import { ActionsProvider, PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { authOrg } from './authUtils.js';
import { findUserByUsernameLike } from './orgUtils.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { parsePromotionBranchName } from './promotionBranchUtils.js';
import { guessBackpromoteParentBranch } from './backpromoteRules.js';
import { DEV_SANDBOXES_BRANCH_NAME, evaluateActionBranchFilter } from './actionUtils.js';
import { WebSocketClient } from '../websocketClient.js';
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
      // Bounded by the window being listed: asking for every merged Pull Request of the repository
      // costs one extra API call per Pull Request on some providers
      const oldestCommitDate = allCommits
        .map((commit) => new Date(commit.date))
        .filter((date) => !isNaN(date.getTime()))
        .sort((a, b) => a.getTime() - b.getTime())[0];
      const minDate = oldestCommitDate ? new Date(oldestCommitDate.getTime() - 7 * 24 * 60 * 60 * 1000) : undefined;
      const allMergedPrs = (await gitProvider.listPullRequests({ status: 'merged', ...(minDate ? { minDate } : {}) })) || [];
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
        const prConfig = await loadPrConfig(prNum, parentBranch);
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
export function extractPrNumbersFromMessage(message: string): number[] {
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

/**
 * The deployment actions and Apex test classes a Pull Request declares, read from the parent branch
 * ref rather than from the checked out branch: a backpromote runs from a User Story branch that is
 * behind the parent branch, where the file of a Pull Request merged since does not exist yet.
 */
async function loadPrConfig(prId: number, ref: string | null): Promise<any | null> {
  const repoPath = `scripts/actions/.sfdx-hardis.${prId}.yml`;
  let content: string | null = null;
  if (ref) {
    const show = spawnSync('git', ['show', `${ref}:${repoPath}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (show.status === 0) {
      content = show.stdout;
    }
  }
  if (content === null) {
    const prConfigFile = path.join('scripts', 'actions', `.sfdx-hardis.${prId}.yml`);
    if (!fs.existsSync(prConfigFile)) {
      return null;
    }
    content = await fs.readFile(prConfigFile, 'utf-8');
  }
  try {
    const yaml = await import('js-yaml');
    return yaml.load(content);
  } catch {
    return null;
  }
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
 * sandboxes are dropped. An invalid definition (both filter lists set) is a warning rather than a
 * failure: backpromote is an interactive developer command, not a pipeline gate.
 */
export function collectBackpromoteActions(
  selectedPrs: BackpromotePrGroup[],
  currentBranch: string,
  phase: 'commandsPreDeploy' | 'commandsPostDeploy',
  commandThis: any,
): BackpromoteActionCandidate[] {
  const allActions: BackpromoteActionCandidate[] = [];
  // A backpromote always deploys to a developer sandbox, so branch filters are evaluated against
  // the dev-sandboxes virtual name (the User Story branch name stays eligible too).
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

  const manualActions: Array<{ id: string; label: string; username: string; prLabel: string; prId: number }> = [];

  // Let the user select which actions to run
  let selectedActionIds: Set<string>;
  if (options.actionIds) {
    // Explicit selection (--actions): run exactly those
    const availableIds = new Set(allActions.map((action) => action.id));
    selectedActionIds = new Set<string>(options.actionIds.filter((id) => availableIds.has(id)));
  } else if (!agentMode && !isCI && !options.nonInteractive) {
    const actionChoices = allActions.map((action) => ({
      title: `[${phaseLabel}] ${action.label} (${action.prLabel})`,
      value: action.id,
      selected: true,
    }));
    const selectRes = await prompts({
      type: 'multiselect',
      name: 'value',
      message: c.cyanBright(t('backpromoteSelectActions', { phase: phaseLabel })),
      description: t('backpromoteSelectActions', { phase: phaseLabel }),
      choices: actionChoices,
    });
    selectedActionIds = new Set<string>(selectRes.value || []);
  } else {
    selectedActionIds = new Set<string>(allActions.map((action) => action.id));
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

    if (action.customUsername) {
      // Try LoginAs
      const user = await findUserByUsernameLike(action.customUsername, conn);
      if (!user) {
        uxLog('warning', commandThis, c.yellow(t('backpromoteActionLoginAsFailed', {
          username: action.customUsername,
          label: action.label,
        })));
        manualActions.push({ id: action.id, label: action.label, username: action.customUsername, prLabel: action.prLabel, prId: action.prId });
      } else {
        try {
          const instanceUrl = conn.instanceUrl;
          const authResult = await authOrg('', { forceUsername: user.Username, instanceUrl, setDefault: false });
          if (authResult === true) {
            uxLog('log', commandThis, c.green(t('backpromoteActionLoginAsSuccess', { username: user.Username, label: action.label })));
            const actionInstance = await ActionsProvider.buildActionInstance(action);
            actionInstance.customUsernameToUse = user.Username;
            await runBackpromoteAction(actionInstance, action, commandThis);
          } else {
            uxLog('warning', commandThis, c.yellow(t('backpromoteActionLoginAsFailed', { username: user.Username, label: action.label })));
            manualActions.push({ id: action.id, label: action.label, username: action.customUsername, prLabel: action.prLabel, prId: action.prId });
          }
        } catch {
          uxLog('warning', commandThis, c.yellow(t('backpromoteActionLoginAsFailed', { username: action.customUsername, label: action.label })));
          manualActions.push({ id: action.id, label: action.label, username: action.customUsername, prLabel: action.prLabel, prId: action.prId });
        }
      }
    } else {
      // Execute directly
      const actionInstance = await ActionsProvider.buildActionInstance(action);
      if (actionInstance) {
        await runBackpromoteAction(actionInstance, action, commandThis);
      }
    }
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

async function runBackpromoteAction(actionInstance: any, action: BackpromoteActionCandidate, commandThis: any): Promise<void> {
  try {
    uxLog('action', commandThis, c.cyan(t('backpromoteRunningAction', { label: action.label })));
    const result = await actionInstance.run(action);
    if (!['manual', 'failed', 'skipped', 'not-run'].includes(result?.statusCode)) {
      uxLog('success', commandThis, c.green(`[Backpromote] ${t('backpromoteActionCompletedSuccessfully', { label: action.label })}`));
    }
  } catch (e) {
    uxLog('error', commandThis, c.red(`[Backpromote] ${t('backpromoteActionFailedWithMessage', { label: action.label, message: (e as Error).message })}`));
  }
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
/* jscpd:ignore-end */
