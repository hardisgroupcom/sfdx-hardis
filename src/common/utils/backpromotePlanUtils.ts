/*
 * Org side and plan of hardis:work:backpromote: the target org check, the pending changes of a
 * source-tracked org, the plan returned to the VS Code panel (--plan --json), and the terminal
 * prompts that fill the same options as the flags.
 */
import { Connection } from '@salesforce/core';
import c from 'chalk';
import * as path from 'path';
import fs from './fsUtils.js';
import { execSfdxJson, getGitRepoRoot, uxLog } from './index.js';
import { soqlQuery } from './apiUtils.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { prompts } from './prompts.js';
import { generateReportPath } from './filesUtils.js';
import { WebSocketClient } from '../websocketClient.js';
import { t } from './i18n.js';
import { BackpromotePrGroup, collectBackpromoteActions, collectTestClassesFromPrs } from './backpromoteUtils.js';
import {
  BackpromoteConflictChoice,
  BackpromotePredictedConflict,
  BackpromoteTargetOrgRefusal,
  findBackpromoteTargetOrgRefusal,
  itemsOfFile,
  normalizeRepoPath,
  parseMetadataKey,
} from './backpromoteRules.js';

// ---- Plan returned by --plan --json (read by the VS Code Backpromote panel) ----

export interface BackpromotePlanCheck {
  id: 'currentBranch' | 'gitClean' | 'targetOrg' | 'parentBranch';
  ok: boolean;
  message: string;
  details?: string[];
}

export interface BackpromotePlan {
  planVersion: 2;
  /** mergeInProgress: a previous run left a merge waiting for its conflicts to be solved */
  status: 'ready' | 'blocked' | 'upToDate' | 'mergeInProgress';
  currentBranch: string;
  parentBranch: string;
  parentBranchChoices: string[];
  targetOrg: { username: string; instanceUrl: string; orgType: 'sandbox' | 'scratch' | 'production'; orgId: string; orgName: string; tracksSource: boolean };
  checks: BackpromotePlanCheck[];
  /** The Pull Requests the merge brings in, newest first */
  pullRequests: Array<{ id: number; title: string; author: string; webUrl: string; sourceBranch: string; date: string; commit: string }>;
  commitCount: number;
  items: Array<{ key: string; type: string; name: string; path: string | null; conflict: BackpromotePredictedConflict | null }>;
  deletions: Array<{ key: string; type: string; name: string }>;
  actions: Array<{ id: string; label: string; type: string; when: 'pre' | 'post'; pullRequestId: number; customUsername: string | null }>;
  testClasses: string[];
  /** Files the merge may stop on (ready), or stopped on (mergeInProgress) */
  conflicts: Array<{ path: string; changedInBranch: boolean; changedInOrg: boolean; items: string[]; conflictBlocks: number | null }>;
  /** Pending changes of the org, saved to the branch before the merge. tracked is false when the org has no source tracking. */
  orgChanges: { tracked: boolean; files: string[] };
  reports: string[];
}

// ---- Target org ----

export interface BackpromoteTargetOrgInfo {
  username: string;
  instanceUrl: string;
  orgType: 'sandbox' | 'scratch' | 'production';
  orgId: string;
  orgName: string;
  tracksSource: boolean;
  refusal: BackpromoteTargetOrgRefusal | null;
  message: string;
}

/** Short name of an org from its instance URL: mycompany--dev-sam for https://mycompany--dev-sam.sandbox.my.salesforce.com */
export function orgShortName(instanceUrl: string, fallback: string): string {
  const host = (instanceUrl || '').replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  return host.split('.')[0] || fallback;
}

/**
 * Only developer sandboxes and scratch orgs receive a backpromote. A production org, or the org of a
 * major branch, is deployed by the CI/CD pipeline.
 */
export async function getBackpromoteTargetOrgInfo(conn: Connection, username: string, tracksSource: boolean): Promise<BackpromoteTargetOrgInfo> {
  const orgResult = await soqlQuery('SELECT Id, IsSandbox, TrialExpirationDate FROM Organization LIMIT 1', conn);
  const organization = orgResult?.records?.[0] || {};
  const isSandboxOrg = organization.IsSandbox === true;
  const orgType: BackpromoteTargetOrgInfo['orgType'] = !isSandboxOrg ? 'production' : organization.TrialExpirationDate ? 'scratch' : 'sandbox';
  const instanceUrl = conn.instanceUrl || '';
  const refusal = findBackpromoteTargetOrgRefusal({ isSandbox: isSandboxOrg, username, instanceUrl, majorOrgs: await listMajorOrgs() });
  let message = t('backpromoteCheckTargetOrgOk', { username });
  if (refusal?.reason === 'production') {
    message = t('backpromoteTargetOrgIsProduction', { username });
  } else if (refusal?.reason === 'majorOrg') {
    message = t('backpromoteTargetOrgIsMajorOrg', { username, branch: refusal.branchName });
  }
  return { username, instanceUrl, orgType, orgId: String(organization.Id || ''), orgName: orgShortName(instanceUrl, username), tracksSource, refusal, message };
}

/**
 * The files changed in a source-tracked org and not yet in the branch, as repository paths. They are
 * saved to the branch before the merge, so the merge sees them and the deployment never overwrites
 * them. Empty when the org has no pending change, or when the preview cannot be read.
 */
export async function listOrgPendingChanges(username: string, commandThis: any): Promise<string[]> {
  const gitRoot = path.resolve((await getGitRepoRoot()).trim());
  const preview = await execSfdxJson(`sf project retrieve preview -o ${username} --json`, commandThis, { fail: false, output: false });
  const entries = [...(preview?.result?.toRetrieve || []), ...(preview?.result?.conflicts || []), ...(preview?.result?.toDelete || [])];
  const files = new Set<string>();
  for (const entry of entries) {
    const file = entry?.projectRelativePath || entry?.path || '';
    if (!file) {
      continue;
    }
    files.add(normalizeRepoPath(path.isAbsolute(file) ? path.relative(gitRoot, file) : file));
  }
  return [...files].sort();
}

// ---- Plan ----

export function buildBackpromotePlan(options: {
  status: BackpromotePlan['status'];
  currentBranch: string;
  parentBranch: string;
  parentBranchChoices: string[];
  targetOrg: BackpromoteTargetOrgInfo;
  checks: BackpromotePlanCheck[];
  groups?: BackpromotePrGroup[];
  items?: string[];
  itemPaths?: Map<string, string | null>;
  deletions?: string[];
  conflicts?: Array<BackpromotePredictedConflict & { conflictBlocks?: number | null }>;
  orgChanges?: { tracked: boolean; files: string[] };
  commandThis?: any;
}): BackpromotePlan {
  const groups = options.groups || [];
  const itemPaths = options.itemPaths || new Map<string, string | null>();
  const pullRequests: BackpromotePlan['pullRequests'] = [];
  for (const group of [...groups].reverse()) {
    for (const pr of group.associatedPrs) {
      pullRequests.push({ ...pr, date: group.commit.date, commit: group.commit.hash });
    }
  }
  const actions: BackpromotePlan['actions'] = [];
  for (const [phase, when] of [['commandsPreDeploy', 'pre'], ['commandsPostDeploy', 'post']] as const) {
    for (const action of collectBackpromoteActions(groups, options.currentBranch, phase, options.commandThis)) {
      actions.push({ id: action.id, label: action.label, type: action.type, when, pullRequestId: action.prId, customUsername: action.customUsername || null });
    }
  }
  const conflicts = (options.conflicts || []).map((conflict) => ({
    path: conflict.path,
    changedInBranch: conflict.changedInBranch,
    changedInOrg: conflict.changedInOrg,
    items: itemsOfFile(conflict.path, itemPaths),
    conflictBlocks: conflict.conflictBlocks ?? null,
  }));
  const conflictOfItem = new Map<string, BackpromotePredictedConflict>();
  for (const conflict of conflicts) {
    for (const key of conflict.items) {
      if (!conflictOfItem.has(key)) {
        conflictOfItem.set(key, { path: conflict.path, changedInBranch: conflict.changedInBranch, changedInOrg: conflict.changedInOrg });
      }
    }
  }
  const toEntry = (key: string) => {
    const parsed = parseMetadataKey(key) || { type: '', name: key };
    return { key, type: parsed.type, name: parsed.name };
  };
  return {
    planVersion: 2,
    status: options.status,
    currentBranch: options.currentBranch,
    parentBranch: options.parentBranch,
    parentBranchChoices: options.parentBranchChoices,
    targetOrg: {
      username: options.targetOrg.username,
      instanceUrl: options.targetOrg.instanceUrl,
      orgType: options.targetOrg.orgType,
      orgId: options.targetOrg.orgId,
      orgName: options.targetOrg.orgName,
      tracksSource: options.targetOrg.tracksSource,
    },
    checks: options.checks,
    pullRequests,
    commitCount: groups.length,
    items: (options.items || [])
      .map((key) => ({ ...toEntry(key), path: itemPaths.get(key) ?? null, conflict: conflictOfItem.get(key) || null }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    deletions: (options.deletions || []).map(toEntry).sort((a, b) => a.key.localeCompare(b.key)),
    actions,
    testClasses: collectTestClassesFromPrs(groups),
    conflicts,
    orgChanges: options.orgChanges || { tracked: false, files: [] },
    reports: [],
  };
}

/** Major branches and the development branch, the parent branches a backpromote can come from */
export async function listBackpromoteParentBranchChoices(developmentBranch: string | null): Promise<string[]> {
  const choices = new Set<string>();
  if (developmentBranch) {
    choices.add(developmentBranch);
  }
  for (const org of await listMajorOrgs()) {
    if (org.branchName) {
      choices.add(org.branchName);
    }
  }
  return [...choices];
}

// ---- Coding agent prompt ----

export async function writeBackpromoteMergePrompt(prompt: string): Promise<string> {
  const promptFile = await generateReportPath('backpromote-merge-prompt', '', { withDate: true, withBranchName: false, fileExtension: 'md' });
  await fs.ensureDir(path.dirname(promptFile));
  await fs.writeFile(promptFile, prompt, 'utf8');
  return promptFile;
}

/** Tell the user, and VS Code when it launched the command, where the conflicts and the prompt are */
export async function announceBackpromoteConflicts(files: Array<{ path: string; conflictBlocks: number }>, promptFile: string, commandThis: any): Promise<void> {
  const gitRoot = path.resolve((await getGitRepoRoot()).trim());
  for (const file of files) {
    uxLog('action', commandThis, c.yellow(t('backpromoteConflictToSolve', { file: file.path, count: file.conflictBlocks })));
    WebSocketClient.requestOpenFile(path.resolve(gitRoot, file.path));
  }
  uxLog('log', commandThis, c.grey(t('backpromoteMergePromptSaved', { file: promptFile })));
  WebSocketClient.sendReportFileMessage(promptFile, t('backpromoteMergePromptLabel'), 'report');
}

// ---- Interactive prompts (they fill the same options as the flags) ----

/** What to do with a file git could not merge */
export async function promptConflictDecision(file: string): Promise<BackpromoteConflictChoice> {
  const res = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(t('backpromoteConflictDecisionPrompt', { file })),
    description: t('backpromoteConflictDecisionPrompt', { file }),
    choices: [
      { title: t('backpromoteConflictDecisionOverwrite'), value: 'overwrite' },
      { title: t('backpromoteConflictDecisionMerge'), value: 'merge' },
      { title: t('backpromoteConflictDecisionKeepOrg'), value: 'keep' },
    ],
  });
  return (res.value || 'merge') as BackpromoteConflictChoice;
}

/** Wait until the user solved the markers of the files, or gave them up */
export async function promptWaitForSolvedConflicts(files: string[]): Promise<'continue' | 'abort'> {
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

/** One multiselect of the items to deploy, all ticked */
export async function promptItemsToDeploy(keys: string[], instanceUrl: string): Promise<string[]> {
  if (keys.length === 0) {
    return [];
  }
  const res = await prompts({
    type: 'multiselect',
    name: 'value',
    message: c.cyanBright(t('backpromoteSelectMetadataToDeploy', { instanceUrl })),
    description: t('backpromoteSelectMetadataToDeploy', { instanceUrl }),
    choices: keys.map((key) => ({ title: key, value: key, selected: true })),
  });
  return (res.value || keys) as string[];
}
