/*
 * Pure helpers of hardis:work:backpromote: which Pull Request groups the user selected, what the
 * selection deploys, whether the target org may receive a backpromote, and the coding agent prompt of
 * a merge. No I/O here, so that the terminal, the agent mode and the VS Code panel (--plan) share the
 * exact same rules. What each org already received comes from Pull Request comments
 * (backpromoteStateUtils).
 */

import { isRetrofit } from './orgConfigUtils.js';
import { isPromotionBranchName, parsePromotionBranchName } from './promotionBranchUtils.js';

export type BackpromoteGroupStatus = 'pending' | 'done';

/** The part of a BackpromotePrGroup these helpers need */
export interface BackpromoteGroupLike {
  commit: { hash: string };
  associatedPrs: Array<{ id: number }>;
}

export interface BackpromoteGroupDelta {
  hash: string;
  /** package.xml content of the group: metadata type -> members */
  items: Record<string, string[]>;
  /** destructiveChanges.xml content of the group */
  deletions: Record<string, string[]>;
}

export interface BackpromoteDeltaUnion {
  /** Type:Name -> hashes of the groups that deploy it */
  items: Map<string, string[]>;
  /** Type:Name -> hashes of the groups that delete it */
  deletions: Map<string, string[]>;
}

export type BackpromoteTargetOrgRefusal = { reason: 'production' } | { reason: 'majorOrg'; branchName: string };

/** Two commit references designate the same commit (full SHA or a prefix of at least 7 chars) */
export function isSameCommit(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a || '').trim().toLowerCase();
  const right = (b || '').trim().toLowerCase();
  if (left.length < 7 || right.length < 7) {
    return left !== '' && left === right;
  }
  return left.startsWith(right) || right.startsWith(left);
}

/** Type:Name, split on the first colon: member names can hold spaces, dots, dashes and colons */
export function parseMetadataKey(key: string): { type: string; name: string } | null {
  const value = (key || '').trim();
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }
  return { type: value.substring(0, separator).trim(), name: value.substring(separator + 1).trim() };
}

export function toMetadataKey(type: string, name: string): string {
  return `${type}:${name}`;
}

/** Values of a list flag, given once comma separated or repeated */
export function splitListFlag(value: string | string[] | undefined | null): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** Values of a Type:Name list flag. Names may hold commas, so a repeated flag keeps its value whole. */
export function splitMetadataKeysFlag(value: string | string[] | undefined | null): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const keys: string[] = [];
  for (const entry of values) {
    const text = String(entry).trim();
    if (text === '') {
      continue;
    }
    // "A:x,B:y" given once: split only on commas followed by what looks like the next Type:
    for (const part of text.split(/,(?=\s*[A-Za-z][A-Za-z0-9_]*:)/)) {
      if (part.trim() !== '') {
        keys.push(part.trim());
      }
    }
  }
  return [...new Set(keys)];
}

/**
 * Index (oldest first) of the newest group already backpromoted to the org: the listing starts after
 * it, so a project with a long history does not recompute every old merge at each run.
 */
export function findNewestDoneGroupIndex(statuses: BackpromoteGroupStatus[]): number {
  for (let index = statuses.length - 1; index >= 0; index--) {
    if (statuses[index] === 'done') {
      return index;
    }
  }
  return -1;
}

/** A --to or --from value made of digits only and short enough is a Pull Request number, not a SHA */
export function isPullRequestReference(value: string): boolean {
  return /^#?\d{1,6}$/.test((value || '').trim());
}

/** The number of a Pull Request reference, written 482 or #482, or null */
export function parsePullRequestReference(value: string): number | null {
  const text = (value || '').trim().replace(/^#/, '');
  return /^\d{1,6}$/.test(text) ? parseInt(text, 10) : null;
}

/** Pull Request numbers of a list flag, written 482 or #482 */
export function parsePullRequestNumbers(values: string[]): { ids: number[]; invalid: string[] } {
  const ids: number[] = [];
  const invalid: string[] = [];
  for (const value of values) {
    const id = parsePullRequestReference(value);
    if (id === null || id <= 0) {
      invalid.push(value);
    } else if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return { ids, invalid };
}

/**
 * Indexes (oldest first) of the groups selected by --pull-requests, --commits and --to. --to selects
 * every group still pending up to that one, never one older than the newest group already
 * backpromoted to the org. An explicit Pull Request or commit can also designate a group already
 * done, to backpromote it again.
 *
 * A Pull Request number can appear in several groups (a revert, a message quoting it, a branch
 * merged twice): only the groups still pending are taken, so an old group nobody selected, that the
 * panel never showed and the org comparison never looked at, is not deployed on the side. When every
 * group carrying the number is already done, the newest one is taken: that is the "backpromote it
 * again" case.
 */
export function resolveExplicitGroupSelection(
  groupsOldestFirst: BackpromoteGroupLike[],
  statuses: BackpromoteGroupStatus[],
  selection: { pullRequests: number[]; commits: string[]; to: string | null },
): { selected: number[]; unknownPullRequests: number[]; unknownCommits: string[] } {
  const selected = new Set<number>();
  const unknownPullRequests: number[] = [];
  const unknownCommits: string[] = [];
  const doneAnchor = findNewestDoneGroupIndex(statuses);
  for (const prNumber of selection.pullRequests) {
    const indexes = groupsOldestFirst
      .map((group, index) => (group.associatedPrs.some((pr) => pr.id === prNumber) ? index : -1))
      .filter((index) => index >= 0);
    if (indexes.length === 0) {
      unknownPullRequests.push(prNumber);
      continue;
    }
    const pending = indexes.filter((index) => statuses[index] !== 'done');
    const kept = pending.length > 0 ? pending : [indexes[indexes.length - 1]];
    kept.forEach((index) => selected.add(index));
  }
  for (const commit of selection.commits) {
    const index = groupsOldestFirst.findIndex((group) => isSameCommit(group.commit.hash, commit));
    if (index < 0) {
      unknownCommits.push(commit);
    } else {
      selected.add(index);
    }
  }
  if (selection.to) {
    const to = selection.to.trim();
    const toPullRequest = parsePullRequestReference(to);
    const toIndex = toPullRequest !== null
      ? groupsOldestFirst.findIndex((group) => group.associatedPrs.some((pr) => pr.id === toPullRequest))
      : groupsOldestFirst.findIndex((group) => isSameCommit(group.commit.hash, to));
    if (toIndex < 0) {
      if (toPullRequest !== null) {
        unknownPullRequests.push(toPullRequest);
      } else {
        unknownCommits.push(to);
      }
    } else {
      // Never reach back before the newest group the org already received: a merge with no Pull
      // Request number is never "done", so --to would redeploy every one of them at each run
      for (let index = Math.max(0, doneAnchor + 1); index <= toIndex; index++) {
        if (statuses[index] !== 'done') {
          selected.add(index);
        }
      }
    }
  }
  return { selected: [...selected].sort((a, b) => a - b), unknownPullRequests, unknownCommits };
}

/**
 * The groups a run preselects: pending ones that can be remembered once deployed.
 *
 * An org with no backpromote history at all (a new or refreshed sandbox, a scratch org, an org
 * whose history was never written) would otherwise preselect the whole window and redeploy months
 * of merges in one run: only the newest group is preselected there, and the others are listed
 * unticked, ready to be added.
 */
export function defaultGroupSelection(
  groups: Array<{ status: BackpromoteGroupStatus; trackable: boolean }>,
  options: { noHistory?: boolean } = {},
): number[] {
  const pending = groups.map((group, index) => (group.status === 'pending' && group.trackable ? index : -1)).filter((index) => index >= 0);
  if (options.noHistory === true && pending.length > 0) {
    return [pending[pending.length - 1]];
  }
  return pending;
}

/**
 * The commit the three-way merge of an item changed in the org starts from: what the org received
 * last, which is the newest group already backpromoted to it before the selection.
 *
 * Taking the parent of the oldest selected group instead would put the changes of an older Pull
 * Request the org never received inside the base, and `git merge-file` reads a change present in
 * the base but missing from the org as a deletion the org made on purpose: it drops it from the
 * merged file, without a conflict marker, and the deployment silently reverts that Pull Request.
 * Everything the org has not received yet must stay on the incoming side.
 */
export function resolveBackpromoteMergeBase(options: {
  groupHashesOldestFirst: string[];
  statuses: BackpromoteGroupStatus[];
  selectedIndexes: number[];
}): string | null {
  const hashes = options.groupHashesOldestFirst || [];
  if (hashes.length === 0 || (options.selectedIndexes || []).length === 0) {
    return null;
  }
  const firstSelected = Math.min(...options.selectedIndexes);
  for (let index = Math.min(firstSelected - 1, hashes.length - 1); index >= 0; index--) {
    if (options.statuses[index] === 'done') {
      return hashes[index];
    }
  }
  // Nothing of this window reached the org: it starts just before the oldest group listed
  return `${hashes[0]}^1`;
}

/** Union of the deltas of several groups, remembering which groups deploy or delete each item */
export function unionGroupDeltas(deltas: BackpromoteGroupDelta[]): BackpromoteDeltaUnion {
  const items = new Map<string, string[]>();
  const deletions = new Map<string, string[]>();
  const add = (target: Map<string, string[]>, content: Record<string, string[]>, hash: string) => {
    for (const type of Object.keys(content || {})) {
      for (const member of content[type] || []) {
        const key = toMetadataKey(type, member);
        const hashes = target.get(key) || [];
        if (!hashes.includes(hash)) {
          hashes.push(hash);
        }
        target.set(key, hashes);
      }
    }
  };
  for (const delta of deltas) {
    add(items, delta.items, delta.hash);
    add(deletions, delta.deletions, delta.hash);
  }
  return { items, deletions };
}

/**
 * Keep the items that at least one selected group touches, then make the union agree with the
 * working tree, which is what gets deployed. The last group touching an item decides, whether it is
 * selected or not: an item deleted by a later group is not deployable any more, and a deletion
 * followed by a group that re-creates the item is not a deletion any more.
 * groupHashesOldestFirst lists every group of the union, in history order.
 */
export function selectDeltaUnion(
  union: BackpromoteDeltaUnion,
  selectedHashes: string[],
  groupHashesOldestFirst: string[],
): BackpromoteDeltaUnion {
  const touchesSelection = (hashes: string[]) => hashes.some((hash) => selectedHashes.some((selected) => isSameCommit(selected, hash)));
  const position = (hash: string) => groupHashesOldestFirst.findIndex((groupHash) => isSameCommit(groupHash, hash));
  const latest = (hashes: string[] | undefined) => Math.max(-1, ...(hashes || []).map(position));
  const items = new Map<string, string[]>();
  const deletions = new Map<string, string[]>();
  for (const [key, hashes] of union.items) {
    if (touchesSelection(hashes) && latest(hashes) >= latest(union.deletions.get(key))) {
      items.set(key, hashes);
    }
  }
  for (const [key, hashes] of union.deletions) {
    if (touchesSelection(hashes) && latest(hashes) > latest(union.items.get(key))) {
      deletions.set(key, hashes);
    }
  }
  return { items, deletions };
}

/**
 * Items of the selection also changed by a pending group the user did not select: the deployment
 * reads the working tree, so they go to the org with that other change too.
 */
export function findItemsAlsoChangedByUnselected(
  selection: BackpromoteDeltaUnion,
  selectedHashes: string[],
  waitingHashes: string[],
): string[] {
  const unselectedWaiting = waitingHashes.filter((hash) => !selectedHashes.some((selected) => isSameCommit(selected, hash)));
  return [...selection.items.entries()]
    .filter(([, hashes]) => hashes.some((hash) => unselectedWaiting.some((waiting) => isSameCommit(waiting, hash))))
    .map(([key]) => key)
    .sort();
}

/** package.xml content (type -> sorted members) of a list of Type:Name keys */
export function metadataKeysToPackageContent(keys: Iterable<string>): Record<string, string[]> {
  const content: Record<string, string[]> = {};
  for (const key of keys) {
    const parsed = parseMetadataKey(key);
    if (!parsed) {
      continue;
    }
    content[parsed.type] = content[parsed.type] || [];
    if (!content[parsed.type].includes(parsed.name)) {
      content[parsed.type].push(parsed.name);
    }
  }
  for (const type of Object.keys(content)) {
    content[type].sort();
  }
  return content;
}

/**
 * The sandbox a Salesforce username belongs to: every user of a sandbox has the username they have
 * in production with `.<sandbox name>` appended, so `ci@acme.com.uat` and `dev@acme.com.uat` are two
 * users of the same UAT sandbox. Null for a production username.
 */
export function parseSandboxOfUsername(username: string): { base: string; sandbox: string } | null {
  const value = (username || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0) {
    return null;
  }
  const domain = value.substring(at + 1);
  const parts = domain.split('.');
  // production usernames are user@company.com: a sandbox adds one more part
  if (parts.length < 3) {
    return null;
  }
  return { base: parts.slice(0, -1).join('.'), sandbox: parts[parts.length - 1] };
}

/**
 * Why a backpromote must not deploy to this org, or null when it may. Only developer sandboxes and
 * scratch orgs receive a backpromote: a production org, or the org of a major branch, is deployed by
 * the CI/CD pipeline. A major org matches on its username, on the sandbox that username belongs to
 * (a developer signed into the UAT sandbox with their own user is still in UAT), or on its instance
 * URL unless that URL is the generic test.salesforce.com login.
 */
export function findBackpromoteTargetOrgRefusal(options: {
  isSandbox: boolean;
  username: string;
  instanceUrl: string;
  majorOrgs: Array<{ branchName?: string; targetUsername?: string; instanceUrl?: string }>;
}): BackpromoteTargetOrgRefusal | null {
  const normalizeUrl = (url: string | undefined) => (url || '').trim().toLowerCase().replace(/\/+$/, '');
  const username = (options.username || '').trim().toLowerCase();
  const instanceUrl = normalizeUrl(options.instanceUrl);
  const sandbox = parseSandboxOfUsername(username);
  const majorOrg = (options.majorOrgs || []).find((org) => {
    const majorUsername = (org.targetUsername || '').trim().toLowerCase();
    if (username !== '' && majorUsername === username) {
      return true;
    }
    // Same sandbox as the major org, with another user: the config instanceUrl of a major sandbox
    // is often the generic login URL, which never matches, so the username is the only evidence
    const majorSandbox = parseSandboxOfUsername(majorUsername);
    if (sandbox && majorSandbox && sandbox.base === majorSandbox.base && sandbox.sandbox === majorSandbox.sandbox) {
      return true;
    }
    const orgUrl = normalizeUrl(org.instanceUrl);
    return orgUrl !== '' && orgUrl === instanceUrl && !orgUrl.includes('test.salesforce.com');
  });
  if (majorOrg) {
    return { reason: 'majorOrg', branchName: majorOrg.branchName || '' };
  }
  if (options.isSandbox !== true) {
    return { reason: 'production' };
  }
  return null;
}

export type BackpromoteCurrentBranchKind = 'majorBranch' | 'promotionBranch' | 'retrofitBranch' | 'userStoryBranch';

/**
 * What the current branch is. Only a User Story branch can receive a backpromote itself: a major
 * branch is deployed by the CI/CD pipeline, a promotion branch only carries User Stories from one
 * major branch to the next and a retrofit branch carries a major branch down to another one.
 */
export function classifyBackpromoteCurrentBranch(currentBranch: string, majorBranches: string[]): BackpromoteCurrentBranchKind {
  const branch = currentBranch || '';
  if ((majorBranches || []).includes(branch)) {
    return 'majorBranch';
  }
  if (isPromotionBranchName(branch)) {
    return 'promotionBranch';
  }
  if (isRetrofit(branch)) {
    return 'retrofitBranch';
  }
  return 'userStoryBranch';
}

/**
 * The major branches a backpromote may come from, when the parent branch is not one of them. A
 * project declaring no major branch at all gives nothing to compare with: its parent branch is accepted.
 */
export function findBackpromoteParentBranchRefusal(parentBranch: string, majorBranches: string[]): { majorBranches: string[] } | null {
  const branches = (majorBranches || []).filter((branch) => !!branch);
  return branches.length > 0 && !branches.includes(parentBranch) ? { majorBranches: branches } : null;
}

export interface BackpromoteWorkingBranch {
  /**
   * currentBranch: the run works on the checked out branch.
   * newBackpromoteBranch: it works on a new local backpromote/<parent>/<date> branch created from the
   * remote parent branch.
   */
  mode: 'currentBranch' | 'newBackpromoteBranch';
  /** userStoryBranch and backpromoteBranch stay on the current branch, the others get a new one */
  reason:
  | 'userStoryBranch'
  | 'backpromoteBranch'
  | 'backpromoteBranchBehind'
  | 'majorBranch'
  | 'promotionBranch'
  | 'retrofitBranch'
  | 'notUpToDate'
  | 'solvedMerge';
  /** The branch the run brings the user back to, null when it stays on the current branch */
  returnBranch: string | null;
  /**
   * Set when the run must list and deploy what the resumed backpromote branch holds instead of the
   * newer remote parent branch: its working tree is the one being deployed.
   */
  listFromCurrentBranch?: boolean;
  /** Why the run cannot start at all, for the currentBranch check of the plan */
  refusal?: { reason: 'backpromoteBranchOtherParent'; parentBranch: string } | null;
}

/**
 * Where a backpromote works. It stays on a User Story branch that already contains the latest commit
 * of the parent branch, and on a backpromote branch a previous run created (a merge to finish).
 * Anything else, a major, promotion or retrofit branch, or a User Story branch behind its parent
 * branch, gets a new local backpromote branch from the remote parent branch: a run never works on a
 * major branch, so nothing can be committed there by accident.
 */
export function decideBackpromoteWorkingBranch(options: {
  currentBranch: string;
  parentBranch: string;
  majorBranches: string[];
  upToDate: boolean;
  /** The return branch a previous run recorded on the current branch, when it created it */
  backpromoteReturnBranch: string | null;
  /** The parent branch a previous run recorded on the current branch, when it created it */
  backpromoteParentBranch?: string | null;
  /** A merge written by a previous run is waiting in the working tree (--merged-metadata) */
  hasSolvedMerge?: boolean;
}): BackpromoteWorkingBranch {
  if (options.backpromoteReturnBranch) {
    // A backpromote branch was created from one parent branch and carries its files: asking for
    // another one would deploy the files of the first from a branch named after it
    if (options.backpromoteParentBranch && options.backpromoteParentBranch !== options.parentBranch) {
      return {
        mode: 'currentBranch',
        reason: 'backpromoteBranch',
        returnBranch: options.backpromoteReturnBranch,
        refusal: { reason: 'backpromoteBranchOtherParent', parentBranch: options.backpromoteParentBranch },
      };
    }
    // Teammates merged since the branch was created: what it holds is what its working tree
    // deploys, so the run lists that state instead of the newer remote parent branch
    return options.upToDate
      ? { mode: 'currentBranch', reason: 'backpromoteBranch', returnBranch: options.backpromoteReturnBranch }
      : { mode: 'currentBranch', reason: 'backpromoteBranchBehind', returnBranch: options.backpromoteReturnBranch, listFromCurrentBranch: true };
  }
  const kind = options.currentBranch === options.parentBranch ? 'majorBranch' : classifyBackpromoteCurrentBranch(options.currentBranch, options.majorBranches);
  if (kind !== 'userStoryBranch') {
    return { mode: 'newBackpromoteBranch', reason: kind, returnBranch: options.currentBranch };
  }
  // A solved merge lives in the working tree of this branch: moving to another branch would carry
  // it over, or lose it, and the merge was computed against what this branch holds
  if (options.hasSolvedMerge === true) {
    return { mode: 'currentBranch', reason: options.upToDate ? 'userStoryBranch' : 'solvedMerge', returnBranch: null };
  }
  if (!options.upToDate) {
    return { mode: 'newBackpromoteBranch', reason: 'notUpToDate', returnBranch: options.currentBranch };
  }
  return { mode: 'currentBranch', reason: 'userStoryBranch', returnBranch: null };
}

/**
 * The parent branch a backpromote comes from when none is given: the parent branch of a backpromote
 * branch, the branch the User Story was created from (hardis:work:new), the current branch when it is
 * a major branch, the source branch of a promotion branch (where its stories were merged, as for the
 * developer orgs), then its target branch, then the development branch.
 */
export function guessBackpromoteParentBranch(options: {
  currentBranch: string;
  originBranch: string | null;
  backpromoteParentBranch: string | null;
  majorBranches: string[];
  developmentBranch: string | null;
}): string {
  if (options.backpromoteParentBranch) {
    return options.backpromoteParentBranch;
  }
  if (options.originBranch) {
    return options.originBranch;
  }
  const majorBranches = options.majorBranches || [];
  if (majorBranches.includes(options.currentBranch)) {
    return options.currentBranch;
  }
  const promotion = parsePromotionBranchName(options.currentBranch);
  if (promotion && majorBranches.includes(promotion.sourceBranch)) {
    return promotion.sourceBranch;
  }
  if (promotion && majorBranches.includes(promotion.targetBranch)) {
    return promotion.targetBranch;
  }
  return options.developmentBranch || majorBranches[0] || 'integration';
}

/** Name of a new backpromote branch: backpromote/<parent branch>/<YYYY-MM-DD>-<HHMM> (UTC), with -2, -3... when taken */
export function buildBackpromoteBranchName(parentBranch: string, date: Date, existingBranches: string[] = []): string {
  const stamp = date.toISOString();
  const base = `backpromote/${parentBranch}/${stamp.substring(0, 10)}-${stamp.substring(11, 13)}${stamp.substring(14, 16)}`;
  const taken = new Set(existingBranches);
  if (!taken.has(base)) {
    return base;
  }
  let counter = 2;
  while (taken.has(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}

/**
 * Number of git conflict blocks left in a file content. Every marker line counts, not only the
 * opening one: a file where somebody removed the `<<<<<<<` line and left the rest still holds a
 * conflict, and deploying it would send `=======` and `>>>>>>>` lines to the org.
 */
export function countConflictMarkerBlocks(content: string): number {
  const lines = (content || '').split(/\r?\n/);
  const count = (marker: RegExp) => lines.filter((line) => marker.test(line)).length;
  return Math.max(count(/^<{7}(?!<)/), count(/^\|{7}(?!\|)/), count(/^>{7}(?!>)/));
}

function quoteArgument(value: string): string {
  return /^[A-Za-z0-9_.@:/-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

/** The run command matching a selection, as the VS Code panel and the merge prompt give it */
export function buildBackpromoteRunCommand(options: {
  parentBranch: string;
  pullRequests: number[];
  commits: string[];
  excludeMetadata?: string[];
  mergedMetadata?: string[];
  actions?: string[] | null;
  skipActions?: boolean;
  skipDestructive?: boolean;
  targetUsername?: string;
}): string {
  const parts = ['sf hardis:work:backpromote', `--parentbranch ${quoteArgument(options.parentBranch)}`];
  if (options.pullRequests.length > 0) {
    parts.push(`--pull-requests ${options.pullRequests.join(',')}`);
  }
  if (options.commits.length > 0) {
    parts.push(`--commits ${options.commits.map((commit) => commit.substring(0, 12)).join(',')}`);
  }
  for (const key of options.excludeMetadata || []) {
    parts.push(`--exclude-metadata ${quoteArgument(key)}`);
  }
  for (const key of options.mergedMetadata || []) {
    parts.push(`--merged-metadata ${quoteArgument(key)}`);
  }
  if (options.skipDestructive) {
    parts.push('--skip-destructive');
  }
  if (options.skipActions) {
    parts.push('--skip-actions');
  } else if (options.actions && options.actions.length > 0) {
    parts.push(`--actions ${options.actions.map(quoteArgument).join(',')}`);
  }
  if (options.targetUsername) {
    parts.push(`--target-org ${quoteArgument(options.targetUsername)}`);
  }
  return parts.join(' ');
}

/**
 * Prompt to paste into a coding agent (Claude Code, GitHub Copilot, Codex...) to solve the merges a
 * backpromote wrote in the developer's files. Self-contained: the three sides of each conflict, the
 * Pull Requests behind the incoming side, the rules of a Salesforce metadata merge, and what to run
 * once no marker is left.
 */
export function buildBackpromoteMergePrompt(options: {
  parentBranch: string;
  currentBranch: string;
  orgLabel: string;
  files: Array<{ key: string; localPath: string; conflictBlocks: number }>;
  pullRequests: Array<{ id: number; title: string; webUrl?: string }>;
  nextCommand: string;
}): string {
  const lines: string[] = [];
  lines.push(`You are working in a Salesforce DX git repository managed with sfdx-hardis, on the branch \`${options.currentBranch}\`.`);
  lines.push('');
  lines.push(`The developer is running a backpromote: the changes their teammates merged in \`${options.parentBranch}\` are being deployed to their own org (\`${options.orgLabel}\`). Some metadata was also changed directly in that org, and those changes are not in git yet. sfdx-hardis wrote a three-way merge of each such file, with git conflict markers where both sides changed the same lines. Your job is to solve those conflicts so that the deployment keeps both the developer's org work and the incoming changes.`);
  lines.push('');
  lines.push('## Files to fix');
  lines.push('');
  for (const file of options.files) {
    lines.push(`- \`${file.localPath}\` (${file.key}): ${file.conflictBlocks} conflict block(s)`);
  }
  lines.push('');
  lines.push('## How to read a conflict');
  lines.push('');
  lines.push(`- Between \`<<<<<<< your org\` and \`|||||||\` or \`=======\`: what is currently in the developer's org, unsaved in git.`);
  lines.push('- Between `||||||| last backpromoted` and `=======` (when present): the version both sides started from.');
  lines.push(`- Between \`=======\` and \`>>>>>>> ${options.parentBranch}\`: what the teammates merged in \`${options.parentBranch}\`.`);
  if (options.pullRequests.length > 0) {
    lines.push('');
    lines.push(`## Pull Requests merged in ${options.parentBranch} that are being backpromoted`);
    lines.push('');
    for (const pr of options.pullRequests) {
      lines.push(`- ${pr.id > 0 ? `#${pr.id} ` : ''}${pr.title}${pr.webUrl ? ` (${pr.webUrl})` : ''}`);
    }
  }
  lines.push('');
  lines.push('## Rules');
  lines.push('');
  lines.push('1. Keep both intents: the developer\'s org change and the incoming change. When they really contradict each other, keep the incoming change and write down what the developer has to redo in their org.');
  lines.push('2. Salesforce metadata files are XML: the result must be well-formed, keep one entry per API name (no duplicated `<fullName>`, `<fields>`, `<labels>`, `<members>`...), keep the existing element order and indentation, and keep the XML declaration and namespace untouched.');
  lines.push('3. Only change the conflicting lines. Do not reformat the file and do not touch other files.');
  lines.push('4. Leave no marker: `<<<<<<<`, `|||||||`, `=======` and `>>>>>>>` lines must all be gone.');
  lines.push('5. Do not commit, do not push and do not deploy: the developer reviews the result first.');
  lines.push('');
  lines.push('## Once done');
  lines.push('');
  lines.push('Report, for each file, what you kept from each side in one sentence. The developer then deploys with the Backpromote button of the VS Code panel, or with:');
  lines.push('');
  lines.push('```');
  lines.push(options.nextCommand);
  lines.push('```');
  return lines.join('\n');
}
