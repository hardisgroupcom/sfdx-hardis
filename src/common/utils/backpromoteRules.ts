/*
 * Pure rules of hardis:work:backpromote: branch naming, sandbox naming, which orgs and parent
 * branches may take part, how the flags are read, the history walk over the "Backpromotes" comment
 * rows, the two-way merge with markers, and the command and coding agent prompt the VS Code panel
 * and the terminal share. No I/O here.
 */

import { diffLines } from 'diff';
import { isRetrofit } from './orgConfigUtils.js';
import { isPromotionBranchName } from './promotionBranchUtils.js';

/** What to deploy for a file whose sandbox version differs from the parent branch version */
export type BackpromoteDiffChoice = 'git' | 'org' | 'merge';
export const BACKPROMOTE_DIFF_CHOICES: BackpromoteDiffChoice[] = ['git', 'org', 'merge'];

export type BackpromoteTargetOrgRefusal = { reason: 'production' } | { reason: 'majorOrg'; branchName: string };

export type BackpromoteCurrentBranchKind = 'majorBranch' | 'promotionBranch' | 'retrofitBranch' | 'backpromoteBranch' | 'userStoryBranch';

export const BACKPROMOTE_BRANCH_PREFIX = 'backpromote/';

// ---- Keys and flags ----

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
 * The decisions of --on-diff, written `<file path>=git|org|merge`. A file path can hold an `=`
 * (rare, but allowed by Salesforce for report folders): the choice is read from the end.
 */
export function parseDiffDecisions(values: string[] | undefined | null): {
  decisions: Map<string, BackpromoteDiffChoice>;
  invalid: string[];
} {
  const decisions = new Map<string, BackpromoteDiffChoice>();
  const invalid: string[] = [];
  for (const raw of values || []) {
    const value = String(raw || '').trim();
    const separator = value.lastIndexOf('=');
    const choice = separator >= 0 ? value.substring(separator + 1).trim().toLowerCase() : '';
    const file = separator > 0 ? value.substring(0, separator).trim() : '';
    if (!file || !BACKPROMOTE_DIFF_CHOICES.includes(choice as BackpromoteDiffChoice)) {
      invalid.push(value);
      continue;
    }
    decisions.set(normalizeRepoPath(file), choice as BackpromoteDiffChoice);
  }
  return { decisions, invalid };
}

/** A repository path as git prints it: forward slashes, no leading ./ */
export function normalizeRepoPath(file: string): string {
  return (file || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
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

/** Type:Name keys of a package.xml content */
export function packageContentToMetadataKeys(content: Record<string, string[]> | null | undefined): string[] {
  return Object.keys(content || {}).flatMap((type) => (content![type] || []).map((member) => toMetadataKey(type, member)));
}

/**
 * The keys a package-no-overwrite.xml holds back: an exact Type:Name, or every member of a type
 * when the manifest names the type with a `*` wildcard.
 */
export function filterNoOverwriteKeys(keys: string[], noOverwrite: Record<string, string[]> | null | undefined): string[] {
  if (!noOverwrite) {
    return [];
  }
  return keys.filter((key) => {
    const parsed = parseMetadataKey(key);
    if (!parsed) {
      return false;
    }
    const members = noOverwrite[parsed.type] || [];
    return members.includes('*') || members.includes(parsed.name);
  });
}

// ---- Branches ----

/** backpromote/<parent branch>/<sandbox name>: the parent branch may hold slashes, the sandbox name never */
export function buildBackpromoteBranchName(parentBranch: string, sandboxName: string): string {
  return `${BACKPROMOTE_BRANCH_PREFIX}${parentBranch}/${sandboxName}`;
}

export function parseBackpromoteBranchName(branch: string): { parentBranch: string; sandboxName: string } | null {
  const value = branch || '';
  if (!value.startsWith(BACKPROMOTE_BRANCH_PREFIX)) {
    return null;
  }
  const rest = value.substring(BACKPROMOTE_BRANCH_PREFIX.length);
  const separator = rest.lastIndexOf('/');
  if (separator <= 0 || separator === rest.length - 1) {
    return null;
  }
  return { parentBranch: rest.substring(0, separator), sandboxName: rest.substring(separator + 1) };
}

export function isBackpromoteBranchName(branch: string): boolean {
  return parseBackpromoteBranchName(branch) !== null;
}

/**
 * What a branch is. The DevOps Pipeline, the release notes and the promotion candidates ignore the
 * technical branches: a promotion branch carries User Stories from one major branch to the next, a
 * retrofit branch carries a major branch down to another one, a backpromote branch holds the manual
 * merges of a backpromote to one sandbox.
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
  if (isBackpromoteBranchName(branch)) {
    return 'backpromoteBranch';
  }
  return 'userStoryBranch';
}

/**
 * The parent branches a backpromote may come from: the development branch, then the branches of
 * `availableTargetBranches`, in that order and without duplicates. Nothing else, whatever
 * config/branches declares.
 */
export function listAllowedBackpromoteParentBranches(config: { developmentBranch?: string | null; availableTargetBranches?: string[] | null } | null | undefined): string[] {
  const branches: string[] = [];
  const add = (branch: unknown) => {
    const value = typeof branch === 'string' ? branch.trim() : '';
    if (value && !branches.includes(value)) {
      branches.push(value);
    }
  };
  add(config?.developmentBranch);
  for (const branch of config?.availableTargetBranches || []) {
    add(branch);
  }
  return branches;
}

/** Null when the parent branch is allowed, else the list of the allowed branches to name in the message */
export function findBackpromoteParentBranchRefusal(parentBranch: string, allowedBranches: string[]): { allowedBranches: string[] } | null {
  const branches = (allowedBranches || []).filter((branch) => !!branch);
  return branches.includes(parentBranch) ? null : { allowedBranches: branches };
}

// ---- Target org ----

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
  const parts = value.substring(at + 1).split('.');
  // production usernames are user@company.com: a sandbox adds one more part
  if (parts.length < 3) {
    return null;
  }
  return { base: parts.slice(0, -1).join('.'), sandbox: parts[parts.length - 1] };
}

/**
 * Short name of a sandbox, used in the backpromote branch name and in the comment rows: the part of
 * the instance URL between `--` and `.sandbox` (`mycompany--dev1.sandbox.my.salesforce.com` gives
 * `dev1`), else the sandbox part of the username, else the org id. Lower case, only characters a
 * branch name accepts.
 */
export function deriveSandboxName(options: { instanceUrl: string; username: string; orgId: string; override?: string | null }): string {
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  if (options.override && clean(options.override)) {
    return clean(options.override);
  }
  const host = (options.instanceUrl || '').replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  const firstLabel = host.split('.')[0] || '';
  const doubleDash = firstLabel.indexOf('--');
  if (doubleDash > 0 && doubleDash < firstLabel.length - 2) {
    return clean(firstLabel.substring(doubleDash + 2));
  }
  const sandbox = parseSandboxOfUsername(options.username || '');
  if (sandbox) {
    return clean(sandbox.sandbox);
  }
  return clean(options.orgId || '') || 'org';
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

// ---- History walk over the "Backpromotes" comment rows ----

export interface BackpromoteHistoryCandidate<TRow> {
  /** The merged Pull Requests of one first-parent commit of the parent branch (usually one) */
  pullRequestNumbers: number[];
  /** The sandbox rows found in the "Backpromotes" comments of those Pull Requests, all sandboxes and org ids */
  rows: TRow[];
}

export interface BackpromoteHistoryVerdict<TRow> {
  /** The row for this sandbox name and org id, when the candidate was backpromoted to it */
  row: TRow | null;
  /** A row exists for this sandbox name with another org id: the sandbox was refreshed since */
  beforeRefresh: boolean;
}

/**
 * The verdict of each candidate, newest first, and where the default window starts. The walk stops
 * at the first candidate holding a row for this sandbox name and org id: it and every older one
 * count as backpromoted, and the default start is the candidate merged right after it. Candidates
 * after the stop are not looked at (their rows are given as they are, usually empty because the
 * caller stopped reading comments too).
 */
export function walkBackpromoteHistory<TRow extends { sandboxName: string; orgId: string }>(
  candidatesNewestFirst: Array<BackpromoteHistoryCandidate<TRow>>,
  sandboxName: string,
  orgId: string,
): { verdicts: Array<BackpromoteHistoryVerdict<TRow>>; foundIndex: number; defaultStartIndex: number | null } {
  const verdicts: Array<BackpromoteHistoryVerdict<TRow>> = [];
  let foundIndex = -1;
  for (let index = 0; index < candidatesNewestFirst.length; index++) {
    const rows = candidatesNewestFirst[index].rows || [];
    const row = rows.find((entry) => entry.sandboxName === sandboxName && entry.orgId === orgId) || null;
    const beforeRefresh = row === null && rows.some((entry) => entry.sandboxName === sandboxName && entry.orgId !== orgId);
    verdicts.push({ row, beforeRefresh });
    if (row && foundIndex === -1) {
      foundIndex = index;
    }
  }
  // Newest first: the candidate merged right after the found one sits just before it in the list
  const defaultStartIndex = foundIndex === -1 ? null : foundIndex === 0 ? null : foundIndex - 1;
  return { verdicts, foundIndex, defaultStartIndex };
}

// ---- Conflicts and merges ----

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

/**
 * A two-way merge: the sandbox version and the parent branch version side by side, with conflict
 * markers around every block that differs. Used when the sandbox never received a backpromote, so
 * there is no common base to run a real three-way merge from. Lines equal on both sides are kept
 * once. Returns the merged text and the number of conflict blocks.
 */
export function buildTwoWayMergeWithMarkers(
  sandboxContent: string,
  parentContent: string,
  labels: { sandbox: string; parent: string },
): { content: string; conflictBlocks: number } {
  const normalize = (text: string) => (text || '').replace(/\r\n/g, '\n');
  const changes = diffLines(normalize(sandboxContent), normalize(parentContent));
  const output: string[] = [];
  let conflictBlocks = 0;
  let index = 0;
  while (index < changes.length) {
    const change = changes[index];
    if (!change.added && !change.removed) {
      output.push(change.value);
      index++;
      continue;
    }
    // A differing block: what the sandbox has (removed), then what the parent branch has (added)
    let sandboxSide = '';
    let parentSide = '';
    while (index < changes.length && (changes[index].added || changes[index].removed)) {
      if (changes[index].removed) {
        sandboxSide += changes[index].value;
      } else {
        parentSide += changes[index].value;
      }
      index++;
    }
    const endsWithNewline = (text: string) => text === '' || text.endsWith('\n');
    output.push(`<<<<<<< ${labels.sandbox}\n`);
    output.push(sandboxSide + (endsWithNewline(sandboxSide) ? '' : '\n'));
    output.push('=======\n');
    output.push(parentSide + (endsWithNewline(parentSide) ? '' : '\n'));
    output.push(`>>>>>>> ${labels.parent}\n`);
    conflictBlocks++;
  }
  return { content: output.join(''), conflictBlocks };
}

/** Whether two file contents are the same once line endings and trailing blank lines are ignored */
export function sameFileContent(a: string, b: string): boolean {
  const normalize = (text: string) => (text || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
  return normalize(a) === normalize(b);
}

/** Number of lines that differ between two contents (added plus removed), for the plan */
export function countDifferingLines(a: string, b: string): number {
  const normalize = (text: string) => (text || '').replace(/\r\n/g, '\n');
  return diffLines(normalize(a), normalize(b))
    .filter((change) => change.added || change.removed)
    .reduce((total, change) => total + (change.count || 0), 0);
}

const BINARY_EXTENSIONS = new Set(['zip', 'jar', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'pdf', 'woff', 'woff2', 'ttf', 'eot', 'mp3', 'mp4', 'gz', 'tgz', 'bin', 'exe', 'dll', 'swf']);

/** A file the comparison must not open as text: a static resource archive, an image, a font... */
export function isBinaryMetadataFile(file: string): boolean {
  const name = normalizeRepoPath(file).split('/').pop() || '';
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return BINARY_EXTENSIONS.has(extension);
}

/**
 * The metadata items a file belongs to: the item whose source file it is, or whose bundle folder
 * (Lightning Web Component, Aura, static resource, experience bundle...) contains it.
 */
export function itemsOfFile(file: string, itemPaths: Map<string, string | null>): string[] {
  const path = normalizeRepoPath(file);
  const keys: string[] = [];
  for (const [key, itemPath] of itemPaths) {
    if (!itemPath) {
      continue;
    }
    const normalized = normalizeRepoPath(itemPath);
    if (normalized === path) {
      keys.push(key);
      continue;
    }
    // A bundle: the meta file sits next to the file, or in an ancestor folder
    const folder = normalized.substring(0, normalized.lastIndexOf('/') + 1);
    if (folder && path.startsWith(folder) && !/\.\w+-meta\.xml$/.test(path)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * The tail of a source path after its package directory and the `main/default` folder, so that a
 * file of the repository and the same file retrieved into another folder can be matched:
 * `force-app/main/default/classes/A.cls` and `out/main/default/classes/A.cls` both give
 * `classes/A.cls`.
 */
export function sourcePathTail(file: string, packageDirectories: string[] = []): string {
  let value = normalizeRepoPath(file);
  const mainDefault = value.indexOf('/main/default/');
  if (mainDefault >= 0) {
    return value.substring(mainDefault + '/main/default/'.length);
  }
  if (value.startsWith('main/default/')) {
    return value.substring('main/default/'.length);
  }
  for (const directory of packageDirectories.map(normalizeRepoPath).filter((directory) => directory !== '')) {
    if (value.startsWith(`${directory}/`)) {
      value = value.substring(directory.length + 1);
      break;
    }
  }
  return value;
}

// ---- Command and prompt ----

function quoteArgument(value: string): string {
  if (/^[A-Za-z0-9_.@:/=-]+$/.test(value)) {
    return value;
  }
  // Reports, Dashboards and Email Templates of the default folder are named unfiled$public: inside
  // double quotes a shell would expand that dollar sign. Single quotes are literal in bash and in
  // PowerShell, the two shells the VS Code extension opens.
  if (value.includes('$') && !value.includes("'")) {
    return `'${value}'`;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

export interface BackpromoteRunCommandOptions {
  mode: 'auto' | 'agent' | 'plan' | 'prepare';
  parentBranch: string;
  targetOrg?: string | null;
  fromPullRequest?: number | null;
  runId?: string | null;
  excludeMetadata?: string[];
  diffDecisions?: Map<string, BackpromoteDiffChoice> | Record<string, BackpromoteDiffChoice>;
  diffDefault?: BackpromoteDiffChoice | null;
  actions?: string[] | null;
  skipActions?: boolean;
  skipDestructive?: boolean;
  confirmActions?: string[];
  json?: boolean;
}

/** The command matching a set of decisions, as the panel, the merge prompt and the JSON give it */
export function buildBackpromoteRunCommand(options: BackpromoteRunCommandOptions): string {
  const parts = ['sf hardis:work:backpromote', `--${options.mode}`];
  if (options.targetOrg) {
    parts.push(`--target-org ${quoteArgument(options.targetOrg)}`);
  }
  parts.push(`--parent-branch ${quoteArgument(options.parentBranch)}`);
  if (options.fromPullRequest && options.fromPullRequest > 0) {
    parts.push(`--from-pull-request ${options.fromPullRequest}`);
  }
  if (options.runId) {
    parts.push(`--run-id ${quoteArgument(options.runId)}`);
  }
  for (const key of options.excludeMetadata || []) {
    parts.push(`--exclude-metadata ${quoteArgument(key)}`);
  }
  const decisions = options.diffDecisions instanceof Map ? [...options.diffDecisions.entries()] : Object.entries(options.diffDecisions || {});
  for (const [file, choice] of decisions) {
    parts.push(`--on-diff ${quoteArgument(`${file}=${choice}`)}`);
  }
  if (options.diffDefault && options.diffDefault !== 'git') {
    parts.push(`--on-diff-default ${options.diffDefault}`);
  }
  if (options.skipDestructive) {
    parts.push('--skip-destructive');
  }
  if (options.skipActions) {
    parts.push('--skip-actions');
  } else if (options.actions && options.actions.length > 0) {
    parts.push(`--actions ${options.actions.map(quoteArgument).join(',')}`);
  }
  for (const actionId of options.confirmActions || []) {
    parts.push(`--confirm-action ${quoteArgument(actionId)}`);
  }
  if (options.json) {
    parts.push('--json');
  }
  return parts.join(' ');
}

export interface BackpromoteMergePromptFile {
  /** Repository path of the file holding the markers, in the backpromote branch checkout */
  path: string;
  absolutePath: string;
  conflictBlocks: number;
  /** Absolute paths of the three versions kept in the cache (base is null for a two-way merge) */
  versions: { base: string | null; sandbox: string | null; parentHead: string | null };
  pullRequests: number[];
}

/**
 * One prompt per run to paste into a coding agent (Claude Code, GitHub Copilot, Codex...): every
 * prepared file with its versions, what each side of a marker is, the Pull Requests behind the
 * parent branch side, the rules of a Salesforce metadata merge, and the command to run once no
 * marker is left. The agent commits nothing outside agent mode: the backpromote commits the files
 * itself and asks for one commit message body naming each file.
 */
export function buildBackpromoteMergePrompt(options: {
  parentBranch: string;
  backpromoteBranch: string;
  sandboxName: string;
  files: BackpromoteMergePromptFile[];
  pullRequests: Array<{ id: number; title: string; webUrl?: string }>;
  nextCommand: string;
  agentMode: boolean;
}): string {
  const lines: string[] = [];
  lines.push(`You are working in a Salesforce DX git repository managed with sfdx-hardis. The checkout is on the branch \`${options.backpromoteBranch}\`, a technical branch created from \`${options.parentBranch}\` for the backpromote of the sandbox \`${options.sandboxName}\`.`);
  lines.push('');
  lines.push(`A backpromote deploys into the sandbox \`${options.sandboxName}\` what the team merged in \`${options.parentBranch}\`. For the files below, the sandbox holds a version that differs from the \`${options.parentBranch}\` version, and the developer chose to merge the two rather than to overwrite one with the other. Each file was written with conflict markers: your job is to solve them so that both versions are kept.`);
  lines.push('');
  lines.push('## Files to merge');
  lines.push('');
  for (const file of options.files) {
    lines.push(`- \`${file.path}\` (${file.conflictBlocks} conflict block(s)), absolute path \`${file.absolutePath}\``);
    if (file.versions.sandbox) {
      lines.push(`  - sandbox version: \`${file.versions.sandbox}\``);
    }
    if (file.versions.parentHead) {
      lines.push(`  - ${options.parentBranch} version: \`${file.versions.parentHead}\``);
    }
    if (file.versions.base) {
      lines.push(`  - common base (the version at the start of the window, both sides were changed from it): \`${file.versions.base}\``);
    }
    if (file.pullRequests.length > 0) {
      lines.push(`  - changed in ${options.parentBranch} by the Pull Request(s) ${file.pullRequests.map((number) => `#${number}`).join(', ')}`);
    }
  }
  lines.push('');
  lines.push('## How to read a conflict');
  lines.push('');
  lines.push(`- Between \`<<<<<<< sandbox\` and \`=======\` (or \`|||||||\` when a base is shown): the version of the sandbox \`${options.sandboxName}\`, which may hold work done directly in the org.`);
  lines.push(`- Between \`=======\` and \`>>>>>>> ${options.parentBranch}\`: what the team merged in \`${options.parentBranch}\`.`);
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
  lines.push(`1. Keep both intents when they touch different parts. For shared configuration (layouts, profiles, permission sets, settings) prefer the \`${options.parentBranch}\` version, and never remove an org-only element the sandbox work still needs.`);
  lines.push('2. Salesforce metadata files are XML: the result must be well-formed, keep one entry per API name (no duplicated `<fullName>`, `<fields>`, `<labels>`, `<members>`...), keep the existing element order and indentation, and keep the XML declaration and namespace untouched.');
  lines.push('3. Only change the conflicting lines. Do not reformat the files and do not touch other files.');
  lines.push('4. Leave no marker: `<<<<<<<`, `|||||||`, `=======` and `>>>>>>>` lines must all be gone.');
  lines.push(options.agentMode
    ? '5. Do not commit, do not push and do not deploy: the command below commits the merged files in the backpromote branch, checks them and deploys them.'
    : '5. Do not commit, do not push and do not deploy: the developer reviews the result, then the Backpromote button (or the command below) commits the merged files in the backpromote branch and deploys them.');
  lines.push('');
  lines.push('## Once done');
  lines.push('');
  lines.push('Report, for each file, what you kept from each side in one sentence: this is the body of the commit message of the merge. Then run, or let the developer run:');
  lines.push('');
  lines.push('```');
  lines.push(options.nextCommand);
  lines.push('```');
  return lines.join('\n');
}
