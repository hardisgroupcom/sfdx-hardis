/*
 * Pure rules of hardis:work:backpromote: which branches and orgs may receive a backpromote, how the
 * flags are read, which files of a merge may conflict, and the command and coding agent prompt the
 * VS Code panel and the terminal share. No I/O here.
 */

import { isRetrofit } from './orgConfigUtils.js';
import { isPromotionBranchName, parsePromotionBranchName } from './promotionBranchUtils.js';

export type BackpromoteConflictChoice = 'overwrite' | 'merge' | 'keep';
export const BACKPROMOTE_CONFLICT_CHOICES: BackpromoteConflictChoice[] = ['overwrite', 'merge', 'keep'];

export type BackpromoteTargetOrgRefusal = { reason: 'production' } | { reason: 'majorOrg'; branchName: string };

export type BackpromoteCurrentBranchKind = 'majorBranch' | 'promotionBranch' | 'retrofitBranch' | 'userStoryBranch';

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
 * The decisions of --on-conflict, written `<file path>=overwrite|merge|keep`. A file path can hold
 * an `=` (rare, but allowed by Salesforce for report folders): the choice is read from the end.
 */
export function parseConflictDecisions(values: string[] | undefined | null): {
  decisions: Map<string, BackpromoteConflictChoice>;
  invalid: string[];
} {
  const decisions = new Map<string, BackpromoteConflictChoice>();
  const invalid: string[] = [];
  for (const raw of values || []) {
    const value = String(raw || '').trim();
    const separator = value.lastIndexOf('=');
    const choice = separator >= 0 ? value.substring(separator + 1).trim().toLowerCase() : '';
    const file = separator > 0 ? value.substring(0, separator).trim() : '';
    if (!file || !BACKPROMOTE_CONFLICT_CHOICES.includes(choice as BackpromoteConflictChoice)) {
      invalid.push(value);
      continue;
    }
    decisions.set(normalizeRepoPath(file), choice as BackpromoteConflictChoice);
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

// ---- Branches ----

/**
 * What the current branch is. Only a User Story branch can receive a backpromote: a major branch is
 * deployed by the CI/CD pipeline, a promotion branch only carries User Stories from one major branch
 * to the next and a retrofit branch carries a major branch down to another one.
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

/**
 * The parent branch a backpromote comes from when none is given: the branch the User Story was
 * created from (hardis:work:new), the source branch of a promotion branch, then its target branch,
 * then the development branch.
 */
export function guessBackpromoteParentBranch(options: {
  currentBranch: string;
  originBranch: string | null;
  majorBranches: string[];
  developmentBranch: string | null;
}): string {
  if (options.originBranch) {
    return options.originBranch;
  }
  const majorBranches = options.majorBranches || [];
  const promotion = parsePromotionBranchName(options.currentBranch);
  if (promotion && majorBranches.includes(promotion.sourceBranch)) {
    return promotion.sourceBranch;
  }
  if (promotion && majorBranches.includes(promotion.targetBranch)) {
    return promotion.targetBranch;
  }
  return options.developmentBranch || majorBranches[0] || 'integration';
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

// ---- Conflicts ----

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

export interface BackpromotePredictedConflict {
  path: string;
  changedInBranch: boolean;
  changedInOrg: boolean;
}

/**
 * The files a merge of the parent branch may conflict on: changed by the Pull Requests being brought
 * in, and also changed in the User Story branch or in the org since the branches diverged. git only
 * conflicts when the same lines changed on both sides, so the run asks about fewer files than this
 * list, never about more.
 */
export function predictConflictingFiles(options: {
  parentChangedFiles: string[];
  branchChangedFiles: string[];
  orgChangedFiles: string[];
}): BackpromotePredictedConflict[] {
  const branch = new Set(options.branchChangedFiles.map(normalizeRepoPath));
  // The org preview names a bundle by its folder (lwc/myComponent), git names its files
  const org = options.orgChangedFiles.map(normalizeRepoPath).filter((file) => file !== '');
  const changedInOrg = (file: string) => org.some((orgPath) => orgPath === file || file.startsWith(`${orgPath}/`));
  return [...new Set(options.parentChangedFiles.map(normalizeRepoPath))]
    .filter((file) => branch.has(file) || changedInOrg(file))
    .sort()
    .map((file) => ({ path: file, changedInBranch: branch.has(file), changedInOrg: changedInOrg(file) }));
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

/** The run command matching the decisions of the panel, as the panel and the merge prompt give it */
export function buildBackpromoteRunCommand(options: {
  parentBranch: string;
  excludeMetadata?: string[];
  conflictDecisions?: Map<string, BackpromoteConflictChoice> | Record<string, BackpromoteConflictChoice>;
  actions?: string[] | null;
  skipActions?: boolean;
  skipDestructive?: boolean;
  noPull?: boolean;
  targetUsername?: string;
}): string {
  const parts = ['sf hardis:work:backpromote', `--parentbranch ${quoteArgument(options.parentBranch)}`, '--auto'];
  for (const key of options.excludeMetadata || []) {
    parts.push(`--exclude-metadata ${quoteArgument(key)}`);
  }
  const decisions = options.conflictDecisions instanceof Map ? [...options.conflictDecisions.entries()] : Object.entries(options.conflictDecisions || {});
  for (const [file, choice] of decisions) {
    parts.push(`--on-conflict ${quoteArgument(`${file}=${choice}`)}`);
  }
  if (options.skipDestructive) {
    parts.push('--skip-destructive');
  }
  if (options.skipActions) {
    parts.push('--skip-actions');
  } else if (options.actions && options.actions.length > 0) {
    parts.push(`--actions ${options.actions.map(quoteArgument).join(',')}`);
  }
  if (options.noPull) {
    parts.push('--no-pull');
  }
  if (options.targetUsername) {
    parts.push(`--target-org ${quoteArgument(options.targetUsername)}`);
  }
  return parts.join(' ');
}

/**
 * Prompt to paste into a coding agent (Claude Code, GitHub Copilot, Codex...) to solve the git
 * conflicts a backpromote merge left in the developer's files. Self-contained: the files, what each
 * side of a marker is, the Pull Requests behind the incoming side, the rules of a Salesforce metadata
 * merge, and what to run once no marker is left.
 */
export function buildBackpromoteMergePrompt(options: {
  parentBranch: string;
  currentBranch: string;
  orgLabel: string;
  files: Array<{ path: string; conflictBlocks: number }>;
  pullRequests: Array<{ id: number; title: string; webUrl?: string }>;
  nextCommand: string;
}): string {
  const lines: string[] = [];
  lines.push(`You are working in a Salesforce DX git repository managed with sfdx-hardis, on the branch \`${options.currentBranch}\`.`);
  lines.push('');
  lines.push(`The developer is running a backpromote: \`git merge origin/${options.parentBranch}\` brings the changes their teammates merged in \`${options.parentBranch}\` into their branch, before deploying them to their own org (\`${options.orgLabel}\`). The merge stopped on conflicts: the same lines were changed in the branch (which holds the developer's work, including the changes just pulled from their org) and in \`${options.parentBranch}\`. Your job is to solve those conflicts so that both sides are kept.`);
  lines.push('');
  lines.push('## Files to fix');
  lines.push('');
  for (const file of options.files) {
    lines.push(`- \`${file.path}\`: ${file.conflictBlocks} conflict block(s)`);
  }
  lines.push('');
  lines.push('## How to read a conflict');
  lines.push('');
  lines.push("- Between `<<<<<<< HEAD` and `=======`: the developer's version (their branch and their org).");
  lines.push(`- Between \`=======\` and \`>>>>>>> origin/${options.parentBranch}\`: what the teammates merged in \`${options.parentBranch}\`.`);
  if (options.pullRequests.length > 0) {
    lines.push('');
    lines.push(`## Pull Requests merged in ${options.parentBranch} that are being brought in`);
    lines.push('');
    for (const pr of options.pullRequests) {
      lines.push(`- ${pr.id > 0 ? `#${pr.id} ` : ''}${pr.title}${pr.webUrl ? ` (${pr.webUrl})` : ''}`);
    }
  }
  lines.push('');
  lines.push('## Rules');
  lines.push('');
  lines.push("1. Keep both intents: the developer's change and the incoming change. When they really contradict each other, keep the incoming change and write down what the developer has to redo.");
  lines.push('2. Salesforce metadata files are XML: the result must be well-formed, keep one entry per API name (no duplicated `<fullName>`, `<fields>`, `<labels>`, `<members>`...), keep the existing element order and indentation, and keep the XML declaration and namespace untouched.');
  lines.push('3. Only change the conflicting lines. Do not reformat the files and do not touch other files.');
  lines.push('4. Leave no marker: `<<<<<<<`, `=======` and `>>>>>>>` lines must all be gone.');
  lines.push('5. Do not commit, do not push and do not deploy: the developer reviews the result, then the backpromote commits the merge itself.');
  lines.push('');
  lines.push('## Once done');
  lines.push('');
  lines.push('Report, for each file, what you kept from each side in one sentence. The developer then continues with the Backpromote button of the VS Code panel, or with:');
  lines.push('');
  lines.push('```');
  lines.push(options.nextCommand);
  lines.push('```');
  return lines.join('\n');
}
