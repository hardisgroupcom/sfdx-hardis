/*
 * I/O side of the backpromote selection: target org check, group statuses from git, per group
 * deltas, the plan returned to the VS Code panel (--plan), the interactive prompts that fill the
 * same options as the flags, and the three-way merge of an item changed in the org.
 */
import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import { spawnSync } from 'child_process';
import * as path from 'path';
import fs from './fsUtils.js';
import { createTempDir, getGitRepoRoot, git, uxLog } from './index.js';
import { soqlQuery } from './apiUtils.js';
import { callSfdxGitDelta } from './gitUtils.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { parsePackageXmlFile, writePackageXmlFile } from './xmlUtils.js';
import { MetadataUtils } from '../metadata-utils/index.js';
import { prompts } from './prompts.js';
import { generateReportPath } from './filesUtils.js';
import { WebSocketClient } from '../websocketClient.js';
import { t } from './i18n.js';
import { getReportDirectory } from '../../config/index.js';
import { userChangesOutsideReports } from './promotionCreateUtils.js';
import {
  BackpromotePrGroup,
  BackpromoteState,
  OrgConflictItem,
  collectBackpromoteActions,
  formatDateTime,
  loadBackpromoteActionsState,
} from './backpromoteUtils.js';
import {
  BackpromoteDeltaUnion,
  BackpromoteGroupDelta,
  BackpromoteGroupStatus,
  BackpromoteTargetOrgRefusal,
  computeBackpromoteGroupStatuses,
  countConflictMarkerBlocks,
  findBackpromoteTargetOrgRefusal,
  isSameCommit,
  metadataKeysToPackageContent,
  parseMetadataKey,
  toMetadataKey,
} from './backpromoteSelectionUtils.js';

// ---- Plan returned by --plan --json (read by the VS Code Backpromote panel) ----

export interface BackpromotePlanCheck {
  id: 'targetOrg' | 'currentBranch' | 'gitClean' | 'upToDate';
  ok: boolean;
  message: string;
  details?: string[];
}

export interface BackpromotePlan {
  planVersion: 1;
  status: 'ready' | 'blocked' | 'upToDate';
  currentBranch: string;
  parentBranch: string;
  parentBranchChoices: string[];
  targetOrg: { username: string; instanceUrl: string; orgType: 'sandbox' | 'scratch' | 'production' };
  checks: BackpromotePlanCheck[];
  lastState: BackpromoteState | null;
  groups: Array<{
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
    status: BackpromoteGroupStatus;
    selectedByDefault: boolean;
    pullRequests: Array<{ id: number; title: string; author: string; webUrl: string; sourceBranch: string }>;
    items: string[];
    deletions: string[];
    testClasses: string[];
    actionIds: string[];
  }>;
  items: Array<{
    key: string;
    type: string;
    name: string;
    commits: string[];
    orgState: 'changedInOrg' | 'deletedLocally' | 'newToOrg' | 'noOrgChange' | 'unknown';
    localPath: string | null;
    orgPath: string | null;
    mergeable: boolean;
  }>;
  deletions: Array<{ key: string; type: string; name: string; commits: string[] }>;
  actions: Array<{
    id: string;
    label: string;
    type: string;
    when: 'pre' | 'post';
    commits: string[];
    pullRequestId: number;
    customUsername: string | null;
    alreadyDone: { date: string } | null;
    selectedByDefault: boolean;
  }>;
  conflictDetection: { success: boolean; errorMessage: string | null };
  reports: string[];
}

export interface BackpromotePrepareMergeResult {
  files: Array<{ key: string; localPath: string; basePath: string | null; orgPath: string; conflictBlocks: number }>;
  prompt: string;
  promptFile: string;
  nextCommand: string;
}

// ---- Target org ----

export interface BackpromoteTargetOrgInfo {
  username: string;
  instanceUrl: string;
  orgType: 'sandbox' | 'scratch' | 'production';
  refusal: BackpromoteTargetOrgRefusal | null;
  message: string;
}

/**
 * Only developer sandboxes and scratch orgs receive a backpromote. A production org, or the org of a
 * major branch, is deployed by the CI/CD pipeline.
 */
export async function getBackpromoteTargetOrgInfo(conn: Connection, username: string): Promise<BackpromoteTargetOrgInfo> {
  const orgResult = await soqlQuery('SELECT IsSandbox, TrialExpirationDate FROM Organization LIMIT 1', conn);
  const organization = orgResult?.records?.[0] || {};
  const isSandboxOrg = organization.IsSandbox === true;
  const orgType: BackpromoteTargetOrgInfo['orgType'] = !isSandboxOrg ? 'production' : organization.TrialExpirationDate ? 'scratch' : 'sandbox';
  const instanceUrl = conn.instanceUrl || '';
  const refusal = findBackpromoteTargetOrgRefusal({
    isSandbox: isSandboxOrg,
    username,
    instanceUrl,
    majorOrgs: await listMajorOrgs(),
  });
  let message = t('backpromoteCheckTargetOrgOk', { username });
  if (refusal?.reason === 'production') {
    message = t('backpromoteTargetOrgIsProduction', { username });
  } else if (refusal?.reason === 'majorOrg') {
    message = t('backpromoteTargetOrgIsMajorOrg', { username, branch: refusal.branchName });
  }
  return { username, instanceUrl, orgType, refusal, message };
}

// ---- Groups ----

/**
 * The parent branch as the remote has it. A developer brings the parent branch into their feature
 * branch with `git merge origin/integration` and never updates their local `integration`: listing the
 * local branch would find nothing waiting, while the up-to-date check (which reads origin) passes.
 */
export async function resolveBackpromoteParentRef(parentBranch: string): Promise<string> {
  const remoteRef = `origin/${parentBranch}`;
  const verify = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${remoteRef}^{commit}`], { encoding: 'utf8' });
  return verify.status === 0 ? remoteRef : parentBranch;
}

/** The oldest of several commits of the parent branch (the one with the most commits after it) */
export async function findOldestCommit(commits: string[], parentBranch: string): Promise<string | null> {
  let oldest: string | null = null;
  let oldestCount = -1;
  for (const commit of commits) {
    try {
      const count = parseInt((await git().raw(['rev-list', '--count', `${commit}..${parentBranch}`])).trim(), 10);
      if (!isNaN(count) && count > oldestCount) {
        oldest = commit;
        oldestCount = count;
      }
    } catch {
      // A commit the repository does not know any more cannot start the window
    }
  }
  return oldest;
}

export async function resolveBackpromoteGroupStatuses(
  groupsOldestFirst: BackpromotePrGroup[],
  state: BackpromoteState | null,
): Promise<BackpromoteGroupStatus[]> {
  const olderThanLastCommit = new Set<string>();
  const lastCommitListed = !state?.lastCommit || groupsOldestFirst.some((group) => isSameCommit(group.commit.hash, state.lastCommit));
  if (!lastCommitListed && state?.lastCommit) {
    for (const group of groupsOldestFirst) {
      const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', group.commit.hash, state.lastCommit], { encoding: 'utf8' });
      if (ancestry.status === 0) {
        olderThanLastCommit.add(group.commit.hash);
      }
    }
  }
  return computeBackpromoteGroupStatuses(groupsOldestFirst, state, (hash) => olderThanLastCommit.has(hash));
}

async function readPackageContent(file: string): Promise<Record<string, string[]>> {
  if (!fs.existsSync(file)) {
    return {};
  }
  return ((await parsePackageXmlFile(file)) || {}) as Record<string, string[]>;
}

/** What each group deploys and deletes, from sfdx-git-delta between the group and its first parent */
export async function computeBackpromoteGroupDeltas(groups: BackpromotePrGroup[], commandThis: any): Promise<BackpromoteGroupDelta[]> {
  if (groups.length === 0) {
    return [];
  }
  uxLog('action', commandThis, c.cyan(t('backpromoteComputingGroupDeltas', { count: groups.length })));
  const rootDir = await createTempDir();
  const results: BackpromoteGroupDelta[] = new Array(groups.length);
  let next = 0;
  const worker = async () => {
    while (next < groups.length) {
      const index = next++;
      const hash = groups[index].commit.hash;
      const outputDir = path.join(rootDir, `${index}-${hash.substring(0, 12)}`);
      await fs.ensureDir(outputDir);
      const deltaResult = await callSfdxGitDelta(`${hash}^1`, hash, outputDir);
      if (deltaResult?.status !== 0) {
        throw new SfError(`[Backpromote] sfdx-git-delta failed on ${hash.substring(0, 7)}: ${JSON.stringify(deltaResult)}`);
      }
      results[index] = {
        hash,
        items: await readPackageContent(path.join(outputDir, 'package', 'package.xml')),
        deletions: await readPackageContent(path.join(outputDir, 'destructiveChanges', 'destructiveChanges.xml')),
      };
    }
  };
  // One run at a time: sfdx-git-delta writes the git config of the repository, and two runs in
  // parallel fail on its lock ("could not lock config file .git/config")
  await worker();
  return results;
}

// ---- Files ----

/** Local source file of each Type:Name item, or null when it cannot be found */
export async function findLocalMetadataFiles(keys: Iterable<string>): Promise<Map<string, string | null>> {
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
      files.set(toMetadataKey(type, name), file && fs.existsSync(file) ? file : null);
    }
  }
  return files;
}

/**
 * Files with uncommitted changes, apart from the allowed ones (merged files awaiting deployment)
 * and the reports sfdx-hardis writes inside the repository: the merge prompt of a previous
 * --prepare-merge must not block the run that deploys the merge.
 */
export async function listUncommittedFiles(allowedFiles: string[] = []): Promise<string[]> {
  const gitRoot = path.resolve((await getGitRepoRoot()).trim());
  const allowed = new Set(allowedFiles.map((file) => path.resolve(file).toLowerCase()));
  const status = await git().status();
  const reportDirectory = path.basename(await getReportDirectory());
  return userChangesOutsideReports(status.files || [], reportDirectory)
    .map((file) => file.path)
    .filter((file) => !allowed.has(path.resolve(gitRoot, file).toLowerCase()));
}

/** Items whose local file still holds conflict markers, as "path (count)" */
export async function listFilesWithConflictMarkers(files: Iterable<string>): Promise<string[]> {
  const withMarkers: string[] = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      continue;
    }
    const count = countConflictMarkerBlocks(await fs.readFile(file, 'utf8'));
    if (count > 0) {
      withMarkers.push(`${toWorkspacePath(file)} (${count})`);
    }
  }
  return withMarkers;
}

export async function writeBackpromotePackages(deployKeys: string[], deleteKeys: string[]): Promise<{ packageXml: string; destructiveXml: string | null }> {
  const dir = await createTempDir();
  const packageXml = path.join(dir, 'package', 'package.xml');
  await fs.ensureDir(path.dirname(packageXml));
  await writePackageXmlFile(packageXml, metadataKeysToPackageContent(deployKeys));
  let destructiveXml: string | null = null;
  if (deleteKeys.length > 0) {
    destructiveXml = path.join(dir, 'destructiveChanges', 'destructiveChanges.xml');
    await fs.ensureDir(path.dirname(destructiveXml));
    await writePackageXmlFile(destructiveXml, metadataKeysToPackageContent(deleteKeys));
  }
  return { packageXml, destructiveXml };
}

/** Remove Type:Name items from a package.xml file, in place */
export async function removeKeysFromPackageXml(packageXml: string, keys: string[]): Promise<void> {
  if (keys.length === 0 || !fs.existsSync(packageXml)) {
    return;
  }
  const content = ((await parsePackageXmlFile(packageXml)) || {}) as Record<string, string[]>;
  const remaining: string[] = [];
  for (const type of Object.keys(content)) {
    for (const member of content[type] || []) {
      const key = toMetadataKey(type, member);
      if (!keys.includes(key)) {
        remaining.push(key);
      }
    }
  }
  await fs.remove(packageXml);
  await writePackageXmlFile(packageXml, metadataKeysToPackageContent(remaining));
}

function toWorkspacePath(file: string): string {
  return path.relative(process.cwd(), path.resolve(file)).split(path.sep).join('/');
}

function isTextFile(file: string): boolean {
  try {
    const buffer = fs.readFileSync(file);
    return !buffer.subarray(0, 8000).includes(0);
  } catch {
    return false;
  }
}

// ---- Plan ----

export function buildBackpromotePlan(options: {
  status: BackpromotePlan['status'];
  currentBranch: string;
  parentBranch: string;
  parentBranchChoices: string[];
  targetOrg: BackpromoteTargetOrgInfo;
  checks: BackpromotePlanCheck[];
  lastState: BackpromoteState | null;
  groupsOldestFirst?: BackpromotePrGroup[];
  statuses?: BackpromoteGroupStatus[];
  deltas?: BackpromoteGroupDelta[];
  selection?: BackpromoteDeltaUnion;
  conflicts?: OrgConflictItem[];
  notInOrgKeys?: string[];
  conflictDetection?: { success: boolean; errorMessage: string | null };
  actions?: BackpromotePlan['actions'];
  localFiles?: Map<string, string | null>;
}): BackpromotePlan {
  const groups = options.groupsOldestFirst || [];
  const statuses = options.statuses || [];
  const deltaByHash = new Map((options.deltas || []).map((delta) => [delta.hash, delta]));
  const actions = options.actions || [];
  const conflictByKey = new Map((options.conflicts || []).map((item) => [toMetadataKey(item.metadataType, item.metadataName), item]));
  const notInOrg = new Set(options.notInOrgKeys || []);
  const detection = options.conflictDetection || { success: true, errorMessage: null };
  const keysOf = (content: Record<string, string[]> | undefined) =>
    Object.keys(content || {}).flatMap((type) => (content![type] || []).map((member) => toMetadataKey(type, member)));

  const planGroups: BackpromotePlan['groups'] = [];
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index];
    const status = statuses[index] || 'pending';
    if (status === 'done') {
      continue;
    }
    const delta = deltaByHash.get(group.commit.hash);
    const testClasses = new Set<string>();
    for (const { config } of group.prConfigs) {
      for (const testClass of config?.deploymentApexTestClasses || []) {
        testClasses.add(testClass);
      }
    }
    planGroups.push({
      hash: group.commit.hash,
      shortHash: group.commit.hash.substring(0, 7),
      message: (group.commit.message || '').split('\n')[0],
      author: group.commit.author,
      date: group.commit.date,
      status,
      selectedByDefault: status === 'pending',
      pullRequests: group.associatedPrs.map((pr) => ({ ...pr })),
      items: keysOf(delta?.items),
      deletions: keysOf(delta?.deletions),
      testClasses: [...testClasses],
      actionIds: actions.filter((action) => action.commits.includes(group.commit.hash)).map((action) => action.id),
    });
  }

  const items: BackpromotePlan['items'] = [...(options.selection?.items.entries() || [])]
    .map(([key, commits]) => {
      const parsed = parseMetadataKey(key)!;
      const conflict = conflictByKey.get(key);
      let orgState: BackpromotePlan['items'][number]['orgState'] = 'noOrgChange';
      if (!detection.success) {
        orgState = 'unknown';
      } else if (conflict?.status === 'modified') {
        orgState = 'changedInOrg';
      } else if (conflict?.status === 'deleted') {
        orgState = 'deletedLocally';
      } else if (notInOrg.has(key)) {
        orgState = 'newToOrg';
      }
      const localFile = conflict?.localPath || options.localFiles?.get(key) || null;
      return {
        key,
        type: parsed.type,
        name: parsed.name,
        commits,
        orgState,
        localPath: localFile ? toWorkspacePath(localFile) : null,
        orgPath: conflict?.orgPath || null,
        mergeable: orgState === 'changedInOrg' && !!conflict?.localPath && !!conflict?.orgPath && isTextFile(conflict.localPath) && isTextFile(conflict.orgPath),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  const deletions: BackpromotePlan['deletions'] = [...(options.selection?.deletions.entries() || [])]
    .map(([key, commits]) => {
      const parsed = parseMetadataKey(key)!;
      return { key, type: parsed.type, name: parsed.name, commits };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    planVersion: 1,
    status: options.status,
    currentBranch: options.currentBranch,
    parentBranch: options.parentBranch,
    parentBranchChoices: options.parentBranchChoices,
    targetOrg: { username: options.targetOrg.username, instanceUrl: options.targetOrg.instanceUrl, orgType: options.targetOrg.orgType },
    checks: options.checks,
    lastState: options.lastState,
    groups: planGroups,
    items,
    deletions,
    actions,
    conflictDetection: detection,
    reports: [],
  };
}

/** The deployment actions of the waiting groups, both phases, with what already ran on this branch */
export async function listBackpromotePlanActions(
  groups: BackpromotePrGroup[],
  currentBranch: string,
  commandThis: any,
): Promise<BackpromotePlan['actions']> {
  const history = await loadBackpromoteActionsState(currentBranch);
  const planActions: BackpromotePlan['actions'] = [];
  for (const [phase, when] of [['commandsPreDeploy', 'pre'], ['commandsPostDeploy', 'post']] as const) {
    for (const action of collectBackpromoteActions(groups, currentBranch, phase, commandThis)) {
      const done = history.find((entry) => entry.actionId === action.id && entry.status === 'success');
      planActions.push({
        id: action.id,
        label: action.label,
        type: action.type,
        when,
        commits: [action.commitHash],
        pullRequestId: action.prId,
        customUsername: action.customUsername || null,
        alreadyDone: done ? { date: done.date } : null,
        selectedByDefault: !done,
      });
    }
  }
  return planActions;
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

// ---- Interactive prompts (they fill the same options as the flags) ----

/** One multiselect of the waiting groups, newest first, the ones waiting for the first time preselected */
export async function promptBackpromoteGroups(
  groupsOldestFirst: BackpromotePrGroup[],
  statuses: BackpromoteGroupStatus[],
  state: BackpromoteState | null,
): Promise<number[]> {
  const choices: Array<{ title: string; value: number; description?: string; selected: boolean }> = [];
  for (let index = groupsOldestFirst.length - 1; index >= 0; index--) {
    if (statuses[index] === 'done') {
      continue;
    }
    const group = groupsOldestFirst[index];
    const skippedSuffix = statuses[index] === 'skipped' && state?.lastTimestamp
      ? ` (${t('backpromoteGroupSkippedOn', { date: state.lastTimestamp.substring(0, 10) })})`
      : '';
    const description = group.associatedPrs.length > 0
      ? group.associatedPrs
        .map((pr) => (pr.id > 0 ? `PR #${pr.id} - ${pr.title} (${t('by')} ${pr.author})` : `${pr.title} (${t('by')} ${pr.author})`))
        .join('\n')
      : undefined;
    choices.push({
      title: `${formatDateTime(group.commit.date)} - ${(group.commit.message || '').split('\n')[0]} [${group.commit.hash.substring(0, 7)}]${skippedSuffix}`,
      value: index,
      description,
      selected: statuses[index] === 'pending',
    });
  }
  if (choices.length === 0) {
    return [];
  }
  const selectRes = await prompts({
    type: 'multiselect',
    name: 'value',
    message: c.cyanBright(t('backpromoteSelectGroups')),
    description: t('backpromoteSelectGroups'),
    choices,
  });
  return ((selectRes.value || []) as number[]).slice().sort((a, b) => a - b);
}

export type PreparedBackpromoteMerge = BackpromotePrepareMergeResult['files'][number] & { originalContent: string };

/**
 * Write the three-way merge of an item changed both in the org and in the parent branch into its
 * local file: "your org" against the incoming version, from the version before the selection.
 */
export async function prepareBackpromoteMerge(options: {
  key: string;
  localPath: string;
  orgPath: string;
  baseCommit: string | null;
  parentBranch: string;
}): Promise<PreparedBackpromoteMerge> {
  const localFile = path.resolve(options.localPath);
  const originalContent = await fs.readFile(localFile, 'utf8');
  const crlf = originalContent.includes('\r\n');
  const toLf = (content: string) => content.replace(/\r\n/g, '\n');
  const tmpDir = await createTempDir();
  const orgCopy = path.join(tmpDir, 'org');
  const baseCopy = path.join(tmpDir, 'base');
  const incomingCopy = path.join(tmpDir, 'incoming');
  await fs.writeFile(orgCopy, toLf(await fs.readFile(options.orgPath, 'utf8')), 'utf8');
  await fs.writeFile(incomingCopy, toLf(originalContent), 'utf8');
  let baseContent = '';
  let basePath: string | null = null;
  if (options.baseCommit) {
    const gitRoot = path.resolve((await getGitRepoRoot()).trim());
    const repoPath = path.relative(gitRoot, localFile).split(path.sep).join('/');
    const show = spawnSync('git', ['show', `${options.baseCommit}:${repoPath}`], { cwd: gitRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (show.status === 0) {
      baseContent = show.stdout;
      basePath = `${options.baseCommit.substring(0, 12)}:${repoPath}`;
    }
  }
  await fs.writeFile(baseCopy, toLf(baseContent), 'utf8');
  // git merge-file exits with the number of conflicts (capped at 127), and above that on error
  const merge = spawnSync(
    'git',
    ['merge-file', '-p', '--diff3', '-L', 'your org', '-L', 'last backpromoted', '-L', options.parentBranch, orgCopy, baseCopy, incomingCopy],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (merge.error || merge.status === null || merge.status > 127) {
    throw new SfError(`[Backpromote] git merge-file failed on ${toWorkspacePath(localFile)}: ${merge.error?.message || merge.stderr || merge.status}`);
  }
  const merged = crlf ? merge.stdout.replace(/\n/g, '\r\n') : merge.stdout;
  await fs.writeFile(localFile, merged, 'utf8');
  return {
    key: options.key,
    localPath: toWorkspacePath(localFile),
    basePath,
    orgPath: options.orgPath,
    conflictBlocks: countConflictMarkerBlocks(merged),
    originalContent,
  };
}

export async function writeBackpromoteMergePrompt(prompt: string): Promise<string> {
  const promptFile = await generateReportPath('backpromote-merge-prompt', '', { withDate: true, withBranchName: false, fileExtension: 'md' });
  await fs.ensureDir(path.dirname(promptFile));
  await fs.writeFile(promptFile, prompt, 'utf8');
  return promptFile;
}

/** Tell VS Code (when it launched the command) to open the merged file and to offer the prompt */
export function announceBackpromoteMerge(file: PreparedBackpromoteMerge, promptFile: string, commandThis: any): void {
  uxLog('action', commandThis, c.cyan(t('backpromoteMergePrepared', { file: file.localPath, count: file.conflictBlocks })));
  uxLog('log', commandThis, c.grey(t('backpromoteMergePromptSaved', { file: promptFile })));
  WebSocketClient.requestOpenFile(path.resolve(file.localPath));
  WebSocketClient.sendReportFileMessage(promptFile, t('backpromoteMergePromptLabel'), 'report');
}

/**
 * For each selected item changed in the org: deploy the incoming version (default), keep the org
 * version (excluded), or merge both, waiting until no conflict marker is left.
 */
export async function promptBackpromoteConflictDecisions(options: {
  conflicts: OrgConflictItem[];
  baseCommit: string | null;
  parentBranch: string;
  buildMergePrompt: (files: PreparedBackpromoteMerge[], mergedKeys: string[], excludedKeys: string[]) => string;
  commandThis: any;
}): Promise<{ excludedKeys: string[]; mergedKeys: string[] }> {
  const excludedKeys: string[] = [];
  const mergedKeys: string[] = [];
  for (const conflict of options.conflicts) {
    const key = toMetadataKey(conflict.metadataType, conflict.metadataName);
    const mergeable = conflict.status === 'modified' && !!conflict.localPath && !!conflict.orgPath && isTextFile(conflict.localPath) && isTextFile(conflict.orgPath);
    const choices = [
      { title: t('backpromoteConflictDecisionDeploy'), value: 'deploy' },
      { title: t('backpromoteConflictDecisionKeepOrg'), value: 'keep' },
    ];
    if (mergeable) {
      choices.push({ title: t('backpromoteConflictDecisionMerge'), value: 'merge' });
    }
    const decisionRes = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(t('backpromoteConflictDecisionPrompt', { type: conflict.metadataType, name: conflict.metadataName })),
      description: t('backpromoteConflictDecisionPrompt', { type: conflict.metadataType, name: conflict.metadataName }),
      choices,
    });
    const decision = decisionRes.value || 'deploy';
    if (decision === 'keep') {
      excludedKeys.push(key);
      continue;
    }
    if (decision !== 'merge') {
      continue;
    }
    const prepared = await prepareBackpromoteMerge({
      key,
      localPath: conflict.localPath,
      orgPath: conflict.orgPath,
      baseCommit: options.baseCommit,
      parentBranch: options.parentBranch,
    });
    const promptFile = await writeBackpromoteMergePrompt(options.buildMergePrompt([prepared], [...mergedKeys, key], excludedKeys));
    announceBackpromoteMerge(prepared, promptFile, options.commandThis);
    for (;;) {
      const waitRes = await prompts({
        type: 'select',
        name: 'value',
        message: c.cyanBright(t('backpromoteMergeWaitPrompt', { file: prepared.localPath })),
        description: t('backpromoteMergeWaitPrompt', { file: prepared.localPath }),
        choices: [
          { title: t('backpromoteMergeWaitContinue'), value: 'continue' },
          { title: t('backpromoteMergeDecisionKeepOrgInstead'), value: 'keep' },
          { title: t('backpromoteMergeDecisionDeployInstead'), value: 'deploy' },
        ],
      });
      if (waitRes.value === 'keep' || waitRes.value === 'deploy') {
        // Give the incoming version back to the working tree: the merge is abandoned
        await fs.writeFile(path.resolve(prepared.localPath), prepared.originalContent, 'utf8');
        if (waitRes.value === 'keep') {
          excludedKeys.push(key);
        }
        break;
      }
      const remaining = countConflictMarkerBlocks(await fs.readFile(path.resolve(prepared.localPath), 'utf8'));
      if (remaining === 0) {
        mergedKeys.push(key);
        break;
      }
      uxLog('warning', options.commandThis, c.yellow(t('backpromoteMergeStillHasMarkers', { file: prepared.localPath, count: remaining })));
    }
  }
  return { excludedKeys, mergedKeys };
}
