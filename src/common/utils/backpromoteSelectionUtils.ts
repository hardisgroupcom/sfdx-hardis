/*
 * Pure helpers of hardis:work:backpromote: which Pull Request groups the user selected, what the
 * selection deploys, whether the target org may receive a backpromote, and the coding agent prompt of
 * a merge. No I/O here, so that the terminal, the agent mode and the VS Code panel (--plan) share the
 * exact same rules. What each org already received comes from Pull Request comments
 * (backpromoteStateUtils).
 */

import { isRetrofit } from './orgConfigUtils.js';
import { isPromotionBranchName } from './promotionBranchUtils.js';

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
  return /^\d{1,6}$/.test((value || '').trim());
}

/**
 * Indexes (oldest first) of the groups selected by --pull-requests, --commits and --to. --to selects
 * every group still pending up to that one. An explicit Pull Request or commit can also designate a
 * group already done, to backpromote it again.
 */
export function resolveExplicitGroupSelection(
  groupsOldestFirst: BackpromoteGroupLike[],
  statuses: BackpromoteGroupStatus[],
  selection: { pullRequests: number[]; commits: string[]; to: string | null },
): { selected: number[]; unknownPullRequests: number[]; unknownCommits: string[] } {
  const selected = new Set<number>();
  const unknownPullRequests: number[] = [];
  const unknownCommits: string[] = [];
  for (const prNumber of selection.pullRequests) {
    const indexes = groupsOldestFirst
      .map((group, index) => (group.associatedPrs.some((pr) => pr.id === prNumber) ? index : -1))
      .filter((index) => index >= 0);
    if (indexes.length === 0) {
      unknownPullRequests.push(prNumber);
    }
    indexes.forEach((index) => selected.add(index));
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
    const toIndex = isPullRequestReference(to)
      ? groupsOldestFirst.findIndex((group) => group.associatedPrs.some((pr) => pr.id === parseInt(to, 10)))
      : groupsOldestFirst.findIndex((group) => isSameCommit(group.commit.hash, to));
    if (toIndex < 0) {
      if (isPullRequestReference(to)) {
        unknownPullRequests.push(parseInt(to, 10));
      } else {
        unknownCommits.push(to);
      }
    } else {
      for (let index = 0; index <= toIndex; index++) {
        if (statuses[index] !== 'done') {
          selected.add(index);
        }
      }
    }
  }
  return { selected: [...selected].sort((a, b) => a - b), unknownPullRequests, unknownCommits };
}

/** The groups a run preselects: pending ones that can be remembered once deployed */
export function defaultGroupSelection(groups: Array<{ status: BackpromoteGroupStatus; trackable: boolean }>): number[] {
  return groups.map((group, index) => (group.status === 'pending' && group.trackable ? index : -1)).filter((index) => index >= 0);
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
 * Why a backpromote must not deploy to this org, or null when it may. Only developer sandboxes and
 * scratch orgs receive a backpromote: a production org, or the org of a major branch, is deployed by
 * the CI/CD pipeline. A major org matches on its username, or on its instance URL unless that URL is
 * the generic test.salesforce.com login.
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
  const majorOrg = (options.majorOrgs || []).find((org) => {
    if (username !== '' && (org.targetUsername || '').trim().toLowerCase() === username) {
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

export type BackpromoteBranchRefusal =
  | { reason: 'majorBranch' }
  | { reason: 'promotionBranch' }
  | { reason: 'retrofitBranch' }
  | { reason: 'sameBranch' }
  | { reason: 'parentNotMajor'; majorBranches: string[] };

/**
 * Why a backpromote must not run from this branch, or null when it may. A backpromote brings what was
 * merged in a major branch into a User Story branch created from it, so:
 * - the current branch must be a User Story branch: a major branch is deployed by the CI/CD pipeline,
 *   a promotion branch only carries User Stories from one major branch to the next (its Pull Request
 *   validates it, nothing deploys it) and a retrofit branch carries a major branch down to another one.
 *   None of them is the work of a developer, so none of them feeds a developer org.
 * - the parent branch must be a major branch (or the development branch). Pass parentBranch null to
 *   check the current branch only, before the parent branch is known. A project declaring no major
 *   branch at all gives nothing to compare with, and its parent branch is accepted.
 */
export function findBackpromoteBranchRefusal(options: {
  currentBranch: string;
  parentBranch: string | null;
  majorBranches: string[];
}): BackpromoteBranchRefusal | null {
  const currentBranch = options.currentBranch || '';
  const majorBranches = (options.majorBranches || []).filter((branch) => !!branch);
  if (majorBranches.includes(currentBranch)) {
    return { reason: 'majorBranch' };
  }
  if (isPromotionBranchName(currentBranch)) {
    return { reason: 'promotionBranch' };
  }
  if (isRetrofit(currentBranch)) {
    return { reason: 'retrofitBranch' };
  }
  if (options.parentBranch === null) {
    return null;
  }
  if (options.parentBranch === currentBranch) {
    return { reason: 'sameBranch' };
  }
  if (majorBranches.length > 0 && !majorBranches.includes(options.parentBranch)) {
    return { reason: 'parentNotMajor', majorBranches };
  }
  return null;
}

/**
 * The command creating a User Story branch that receives a backpromote from this parent branch,
 * offered when the current branch cannot receive one: it preselects the parent branch as target
 * branch and ends with a way back to the backpromote. Null without a parent branch.
 */
export function buildBackpromoteNewUserStoryCommand(parentBranch: string): string | null {
  const branch = (parentBranch || '').trim();
  return branch === '' ? null : `sf hardis:work:new --backpromote ${quoteArgument(branch)}`;
}

/** Number of git conflict blocks left in a file content */
export function countConflictMarkerBlocks(content: string): number {
  return (content || '').split(/\r?\n/).filter((line) => line.startsWith('<<<<<<< ')).length;
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
