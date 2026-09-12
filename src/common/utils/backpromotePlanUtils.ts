/*
 * The plan of hardis:work:backpromote (version 3): the JSON the command returns in every mode and
 * the VS Code Backpromote panel reads, the run state cached under a run id, and the terminal
 * prompts of the interactive mode, which fill the same options as the flags.
 */
import c from 'chalk';
import * as os from 'os';
import * as path from 'path';
import fs from './fsUtils.js';
import { uxLog } from './index.js';
import { prompts } from './prompts.js';
import { generateReportPath } from './filesUtils.js';
import { WebSocketClient } from '../websocketClient.js';
import { t } from './i18n.js';
import { BackpromoteDiffChoice } from './backpromoteRules.js';
import { BackpromoteLeftOutItem, BackpromoteSandboxRow } from './backpromoteCommentUtils.js';

export const BACKPROMOTE_PLAN_VERSION = 3;
export const BACKPROMOTE_DEFAULT_SCAN_LIMIT = 100;

export type BackpromoteStatus = 'ok' | 'blocked' | 'nothingToDo' | 'waitingForMerges' | 'conflictsRemaining' | 'refused' | 'pushRejected' | 'deployFailed';
export type BackpromoteMode = 'plan' | 'prepare' | 'run' | 'reset' | 'confirm' | 'interactive';

export interface BackpromotePlanCheck {
  id: 'gitProvider' | 'targetOrg' | 'parentBranch' | 'workingTree' | 'backpromoteBranch' | 'window';
  ok: boolean;
  message: string;
  details?: string[];
}

export interface BackpromotePlanPullRequest {
  number: number;
  title: string;
  author: string;
  mergeDate: string;
  sourceBranch: string;
  commit: string;
  webUrl: string;
  itemCount: number;
  actionCount: number;
  /** The row of this sandbox in the "Backpromotes" comment, null when the Pull Request was not backpromoted to it */
  backpromote: { date: string; user: string; status: 'complete' | 'partial'; leftOut: BackpromoteLeftOutItem[] } | null;
  /** A row exists for this sandbox name with another org id: the sandbox was refreshed since */
  beforeRefresh: boolean;
  /** Merged before the newest Pull Request backpromoted to this sandbox: counted as backpromoted, its comment was not read */
  beforeLastBackpromote: boolean;
  /** The start Pull Request of the window */
  selected: boolean;
  /** Merged after the start Pull Request (or is it): part of the window */
  inWindow: boolean;
  /** The walk of the history read its comment (false after the first hit, and beyond the scan limit) */
  scanned: boolean;
}

export interface BackpromotePlanItem {
  key: string;
  type: string;
  name: string;
  /** Repository paths of the files of the item changed in the window (bundles: every file of the bundle) */
  files: string[];
  pullRequests: number[];
  /** Listed as left out in a previous partial backpromote of this sandbox */
  excludedLastTime: boolean;
  /** Held back by package-no-overwrite.xml of the parent branch: never deployed */
  noOverwrite: boolean;
}

export interface BackpromotePlanAction {
  id: string;
  label: string;
  type: string;
  phase: 'pre' | 'post';
  context: string;
  pullRequest: number;
  /** Date of the success row of this sandbox in the "Backpromotes" comment, null when it never ran here */
  alreadyRunOn: string | null;
  manual: boolean;
  customUsername: string | null;
  /** Can run from this computer (a custom username must be authenticated locally) */
  runnable: boolean;
  runOnlyOnceByOrg: boolean;
}

export type BackpromoteComparisonStatus = 'same' | 'different' | 'missingInOrg' | 'pendingInOrg' | 'notCompared';

export interface BackpromotePlanComparison {
  /** Repository path */
  file: string;
  item: string;
  status: BackpromoteComparisonStatus;
  /** Absolute paths of the versions kept in the cache; null when the version does not exist */
  versions: { base: string | null; sandbox: string | null; parentHead: string | null };
  diffLines: number;
  pullRequests: number[];
  decision: BackpromoteDiffChoice | null;
  /** The merged file with markers was written in the backpromote branch checkout */
  prepared: boolean;
  markersRemaining: number;
  conflictPending: boolean;
  /** A three-way merge (the sandbox already received a backpromote), else two-way */
  threeWay: boolean;
}

export interface BackpromoteRunResult {
  deployed: number;
  deleted: number;
  excluded: BackpromoteLeftOutItem[];
  actions: { run: string[]; skipped: string[]; failed: string[]; pending: string[] };
  conflictPending: string[];
  commentedPullRequests: number[];
  pushed: boolean;
  pushRejected: boolean;
  deployReport: string | null;
  orgUrl: string | null;
}

export interface BackpromotePlan {
  version: typeof BACKPROMOTE_PLAN_VERSION;
  runId: string;
  mode: BackpromoteMode;
  status: BackpromoteStatus;
  message: string | null;
  targetOrg: {
    alias: string | null;
    username: string;
    instanceUrl: string;
    orgId: string;
    sandboxName: string;
    orgType: 'sandbox' | 'scratch' | 'production';
    tracksSource: boolean;
    refusal: 'production' | 'majorOrg' | null;
  };
  parentBranch: string;
  allowedParentBranches: string[];
  /** Absolute path of the git repository root: every repository path of the plan is relative to it */
  gitRoot: string;
  backpromoteBranch: { name: string; existsOnOrigin: boolean; head: string | null; pendingMerges: string[] };
  checkout: { originalBranch: string; currentBranch: string; clean: boolean; dirtyFiles: string[]; stashed: boolean; stashMessage: string | null; onBackpromoteBranch: boolean };
  pullRequests: BackpromotePlanPullRequest[];
  scan: { read: number; limit: number; found: boolean; hasMore: boolean };
  window: { fromCommit: string; toCommit: string; startPullRequest: number | null } | null;
  items: BackpromotePlanItem[];
  deletions: Array<{ key: string; type: string; name: string }>;
  actions: BackpromotePlanAction[];
  comparison: BackpromotePlanComparison[];
  checks: BackpromotePlanCheck[];
  promptFile: string | null;
  runCommand: string | null;
  result: BackpromoteRunResult | null;
}

// ---- Run state cached under the run id (R55) ----

export interface BackpromoteRunState {
  runId: string;
  createdAt: string;
  orgId: string;
  sandboxName: string;
  username: string;
  parentBranch: string;
  parentHead: string;
  backpromoteBranch: string;
  fromCommit: string | null;
  startPullRequest: number | null;
  /** The sandbox already had a row before this run: manual merges are three-way */
  historyFound: boolean;
  checkout: { originalBranch: string; stashed: boolean; stashMessage: string | null } | null;
  /** Files prepared with markers, by repository path */
  prepared: Array<{ file: string; item: string; threeWay: boolean }>;
  retrieveDir: string | null;
  comparison: BackpromotePlanComparison[];
}

export function backpromoteCacheRoot(): string {
  return path.join(os.tmpdir(), 'sfdx-hardis', 'backpromote');
}

export function newBackpromoteRunId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`;
}

function runStateFile(runId: string): string {
  return path.join(backpromoteCacheRoot(), 'runs', `${runId}.json`);
}

export async function readBackpromoteRunState(runId: string | null): Promise<BackpromoteRunState | null> {
  if (!runId || !/^[A-Za-z0-9_-]{4,64}$/.test(runId)) {
    return null;
  }
  const file = runStateFile(runId);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    return raw && typeof raw === 'object' && raw.runId === runId ? (raw as BackpromoteRunState) : null;
  } catch {
    return null;
  }
}

export async function writeBackpromoteRunState(state: BackpromoteRunState): Promise<void> {
  const file = runStateFile(state.runId);
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(state, null, 2), 'utf8');
}

// ---- Coding agent prompt ----

export async function writeBackpromoteMergePrompt(prompt: string, runId: string): Promise<string> {
  const promptFile = await generateReportPath(`backpromote-merge-prompt-${runId}`, '', { withDate: false, withBranchName: false, fileExtension: 'md' });
  await fs.ensureDir(path.dirname(promptFile));
  await fs.writeFile(promptFile, prompt, 'utf8');
  return promptFile;
}

/** Tell the user, and VS Code when it launched the command, where the merges and the prompt are */
export function announceBackpromoteMerges(files: Array<{ absolutePath: string; path: string; conflictBlocks: number }>, promptFile: string, commandThis: any): void {
  for (const file of files) {
    uxLog('action', commandThis, c.yellow(t('backpromoteConflictToSolve', { file: file.path, count: file.conflictBlocks })));
    WebSocketClient.requestOpenFile(file.absolutePath);
  }
  uxLog('log', commandThis, c.grey(t('backpromoteMergePromptSaved', { file: promptFile })));
  WebSocketClient.sendReportFileMessage(promptFile, t('backpromoteMergePromptLabel'), 'report');
}

// ---- Interactive prompts (they fill the same options as the flags) ----

export async function promptParentBranch(allowedBranches: string[]): Promise<string> {
  if (allowedBranches.length === 1) {
    return allowedBranches[0];
  }
  const res = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(t('backpromoteSelectParentBranch')),
    description: t('backpromoteSelectParentBranch'),
    choices: allowedBranches.map((branch, index) => ({ title: index === 0 ? `${branch} (${t('recommended')})` : branch, value: branch })),
  });
  return res.value || allowedBranches[0];
}

/**
 * The start: newest first, the ones already backpromoted greyed with their date. A direct commit on
 * the parent branch (no Pull Request) is listed under its subject, so that it can be the start too.
 * Returns the commit of the chosen entry.
 */
export async function promptStartPullRequest(pullRequests: BackpromotePlanPullRequest[], sandboxName: string): Promise<string | null> {
  const candidates = pullRequests.filter((pr, index, all) => all.findIndex((other) => other.commit === pr.commit) === index);
  if (candidates.length === 0) {
    return null;
  }
  const choices = candidates.map((pr) => {
    const done = pr.backpromote || pr.beforeLastBackpromote
      ? ` [${pr.backpromote ? t('backpromoteAlreadyBackpromotedOn', { date: pr.backpromote.date.substring(0, 10), user: pr.backpromote.user }) : t('backpromoteBeforeLastBackpromoteLabel')}]`
      : pr.beforeRefresh ? ` [${t('backpromoteBeforeRefresh')}]` : '';
    const label = pr.number > 0 ? `#${pr.number} ${pr.title}` : `${pr.commit.substring(0, 7)} ${pr.title}`;
    return {
      title: `${label} (${pr.author}, ${pr.mergeDate.substring(0, 10)}, ${pr.itemCount} files, ${pr.actionCount} actions)${done}`,
      value: pr.commit,
    };
  });
  const preselected = candidates.findIndex((pr) => pr.selected);
  const res = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(t('backpromoteSelectStartPullRequest', { sandboxName })),
    description: t('backpromoteSelectStartPullRequestDesc'),
    choices,
    initial: preselected >= 0 ? preselected : 0,
  });
  return typeof res.value === 'string' && res.value ? res.value : null;
}

/** One multiselect of the items to deploy, all ticked; deletions in the same list, ticked too */
export async function promptItemsToDeploy(keys: string[], deletions: string[], sandboxName: string): Promise<{ items: string[]; deletions: string[] }> {
  if (keys.length === 0 && deletions.length === 0) {
    return { items: [], deletions: [] };
  }
  const res = await prompts({
    type: 'multiselect',
    name: 'value',
    message: c.cyanBright(t('backpromoteSelectMetadataToDeploy', { sandboxName })),
    description: t('backpromoteSelectMetadataToDeploy', { sandboxName }),
    choices: [
      ...keys.map((key) => ({ title: key, value: `deploy:${key}`, selected: true })),
      ...deletions.map((key) => ({ title: `${t('backpromoteDeleteLabel')} ${key}`, value: `delete:${key}`, selected: true })),
    ],
  });
  const selected: string[] = res.value || [...keys.map((key) => `deploy:${key}`), ...deletions.map((key) => `delete:${key}`)];
  return {
    items: keys.filter((key) => selected.includes(`deploy:${key}`)),
    deletions: deletions.filter((key) => selected.includes(`delete:${key}`)),
  };
}

/** What to do with a file whose sandbox version differs, with a "for all remaining files" option */
export async function promptDiffDecision(file: string, parentBranch: string, sandboxName: string): Promise<{ choice: BackpromoteDiffChoice; forAll: boolean }> {
  const res = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(t('backpromoteDiffDecisionPrompt', { file, sandboxName, parentBranch })),
    description: t('backpromoteDiffDecisionPrompt', { file, sandboxName, parentBranch }),
    choices: [
      { title: t('backpromoteDiffDecisionOverwrite', { parentBranch }), value: 'git' },
      { title: t('backpromoteDiffDecisionKeepOrg', { sandboxName }), value: 'org' },
      { title: t('backpromoteDiffDecisionMerge'), value: 'merge' },
      { title: t('backpromoteDiffDecisionOverwriteAll', { parentBranch }), value: 'git:all' },
      { title: t('backpromoteDiffDecisionKeepOrgAll', { sandboxName }), value: 'org:all' },
    ],
  });
  const value = String(res.value || 'git');
  return { choice: value.split(':')[0] as BackpromoteDiffChoice, forAll: value.endsWith(':all') };
}

/** Wait until the user solved the markers of the prepared files, or gave the merges up */
export async function promptWaitForSolvedMerges(files: string[]): Promise<'continue' | 'abort'> {
  const res = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(t('backpromoteMergeWaitPrompt', { files: files.join(', ') })),
    description: t('backpromoteMergeWaitPrompt', { files: files.join(', ') }),
    choices: [
      { title: t('backpromoteMergeWaitContinue'), value: 'continue' },
      { title: t('backpromoteMergeWaitAbort'), value: 'abort' },
    ],
  });
  return res.value === 'abort' ? 'abort' : 'continue';
}

/** Commit or stash the working tree before the checkout switches to the backpromote branch */
export async function promptDirtyTree(files: string[], currentBranch: string): Promise<{ action: 'commit' | 'stash'; message: string | null }> {
  const res = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(t('backpromoteDirtyTreePrompt', { count: files.length, branch: currentBranch })),
    description: files.slice(0, 20).join(', '),
    choices: [
      { title: t('backpromoteDirtyTreeCommit', { branch: currentBranch }), value: 'commit' },
      { title: t('backpromoteDirtyTreeStash'), value: 'stash' },
    ],
  });
  if (res.value === 'commit') {
    const messageRes = await prompts({
      type: 'text',
      name: 'value',
      message: c.cyanBright(t('backpromoteCommitMessagePrompt')),
      description: t('backpromoteCommitMessagePrompt'),
      initial: 'WIP',
    });
    return { action: 'commit', message: String(messageRes.value || 'WIP') };
  }
  return { action: 'stash', message: null };
}

export async function promptActionsToRun(actions: BackpromotePlanAction[]): Promise<string[]> {
  const runnable = actions.filter((action) => action.alreadyRunOn === null || !action.runOnlyOnceByOrg);
  if (runnable.length === 0) {
    return [];
  }
  const res = await prompts({
    type: 'multiselect',
    name: 'value',
    message: c.cyanBright(t('backpromoteSelectActionsPrompt')),
    description: t('backpromoteSelectActionsPrompt'),
    choices: runnable.map((action) => ({
      title: `[${action.phase === 'pre' ? t('actionWhenPreDeploy') : t('actionWhenPostDeploy')}] ${action.label} (#${action.pullRequest})${action.manual ? ` [${t('backpromoteManualStep')}]` : ''}`,
      value: action.id,
      selected: true,
    })),
  });
  return (res.value || runnable.map((action) => action.id)) as string[];
}

/** After the run, confirm that a manual action was done in the sandbox */
export async function promptManualActionDone(action: BackpromotePlanAction, sandboxName: string): Promise<boolean> {
  const res = await prompts({
    type: 'confirm',
    name: 'value',
    message: c.cyanBright(t('backpromoteManualActionDonePrompt', { label: action.label, sandboxName })),
    description: t('backpromoteManualActionDonePrompt', { label: action.label, sandboxName }),
    initial: false,
  });
  return res.value === true;
}

export async function promptConfirmReset(branch: string): Promise<boolean> {
  const res = await prompts({
    type: 'confirm',
    name: 'value',
    message: c.cyanBright(t('backpromoteConfirmReset', { branch })),
    description: t('backpromoteConfirmReset', { branch }),
    initial: false,
  });
  return res.value === true;
}

/** Row written for this sandbox in the "Backpromotes" comment of a Pull Request of the window */
export function buildSandboxRow(options: {
  sandboxName: string;
  orgId: string;
  user: string;
  parentBranch: string;
  leftOut: BackpromoteLeftOutItem[];
  version: string;
}): BackpromoteSandboxRow {
  return {
    sandboxName: options.sandboxName,
    orgId: options.orgId,
    date: new Date().toISOString(),
    user: options.user,
    parentBranch: options.parentBranch,
    status: options.leftOut.length > 0 ? 'partial' : 'complete',
    leftOut: options.leftOut,
    version: options.version,
  };
}
