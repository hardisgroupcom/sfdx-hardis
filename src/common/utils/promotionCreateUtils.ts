import { SfError } from '@salesforce/core';
import c from 'chalk';
import * as path from 'path';
import fs from './fsUtils.js';
import { execCommand, git, gitFetch, uxLog } from './index.js';
import { prompts } from './prompts.js';
import { t } from './i18n.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { BackpromotePrGroup, listMergedPrsWithCommits } from './backpromoteUtils.js';
import { CommonPullRequestInfo, GitProvider } from '../gitProvider/index.js';
import { TicketProvider } from '../ticketProvider/index.js';
import { which } from './whichUtils.js';
import { generateReportPath } from './filesUtils.js';
import { WebSocketClient } from '../websocketClient.js';
import { getSfdxProjectPackageDirectories } from './projectUtils.js';
import {
  buildPromotionBranchName,
  getPromotionBranchConfig,
  isPromotionPullRequest,
  parsePromotionBranchName,
  parsePromotionPullRequestIds,
  PROMOTION_BRANCH_PREFIX,
  PROMOTION_PULL_REQUESTS_KEY,
} from './promotionBranchUtils.js';

/**
 * Helpers of `sf hardis:project:promotion:create`, the only supported way to assemble a
 * promotion branch: it names the branch (promotion/<source>/<target>/<YYYY-MM-DD>-<counter>),
 * cherry-picks the merge commits of the selected Pull Requests, pushes and opens the Pull
 * Request with the `promotionPullRequests` declaration the deployment jobs rely on.
 */

/**
 * execCommand throws on a non-zero exit code of any command without --json, whatever the `fail`
 * option says. The git steps below need the exit code (a cherry-pick conflict is a normal
 * outcome, not a crash), so failures are turned into a result.
 */
async function runCommandSafe(
  command: string,
  commandThis: any,
  options: { output: boolean },
): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const res = await execCommand(command, commandThis, { fail: false, output: options.output });
    return { status: res?.status ?? 0, stdout: res?.stdout || '', stderr: res?.stderr || '' };
  } catch (e: any) {
    return { status: typeof e?.code === 'number' ? e.code : 1, stdout: e?.stdout || '', stderr: e?.stderr || e?.message || '' };
  }
}

export interface PromotionCandidate {
  group: BackpromotePrGroup;
  // Provider-native numbers of the Pull Requests merged by this commit (0 = unknown)
  pullRequestNumbers: number[];
  label: string;
  // Set when another promotion branch already carries this story to the same target branch:
  // cherry-picking it a second time would replay the same change
  alreadyPromotedBy?: AlreadyPromotedBy;
}

export interface AlreadyPromotedBy {
  idStr: string;
  sourceBranch: string;
  webUrl: string;
  merged: boolean;
}

export interface PromotionStory {
  number: number;
  title: string;
  author: string;
  webUrl: string;
  sourceBranch: string;
  commitHash: string;
  // Files committed with conflict markers for this story, when the user chose to keep it anyway
  conflictFiles?: string[];
}

// ---- Branch resolution ----

export async function resolvePromotionSourceAndTarget(
  commandThis: any,
  sourceFlag: string | null,
  targetFlag: string | null,
  agentMode: boolean,
): Promise<{ sourceBranch: string; targetBranch: string }> {
  const majorOrgs = await listMajorOrgs();
  const promotable = majorOrgs.filter((org: any) => org.branchName && (org.mergeTargets || []).length > 0);
  if (promotable.length === 0) {
    throw new SfError(t('promotionCreateNoPromotableBranch'));
  }
  let sourceBranch = sourceFlag || '';
  if (!sourceBranch) {
    if (agentMode) {
      throw new SfError(t('promotionCreateAgentRequiresSourceBranch', { branches: promotable.map((org: any) => org.branchName).join(', ') }));
    }
    const res = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(t('promotionCreateSelectSourceBranch')),
      description: t('promotionCreateSelectSourceBranch'),
      choices: promotable.map((org: any) => ({
        title: `${org.branchName} -> ${(org.mergeTargets || []).join(', ')}`,
        value: org.branchName,
      })),
    });
    sourceBranch = res.value;
  }
  const sourceOrg = majorOrgs.find((org: any) => (org.branchName || '').toLowerCase() === sourceBranch.toLowerCase());
  if (!sourceOrg) {
    throw new SfError(t('promotionCreateSourceNotMajor', { branch: sourceBranch, branches: majorOrgs.map((org: any) => org.branchName).join(', ') }));
  }
  sourceBranch = sourceOrg.branchName;
  let targetBranch = targetFlag || '';
  if (!targetBranch) {
    const mergeTargets: string[] = sourceOrg.mergeTargets || [];
    if (mergeTargets.length === 0) {
      throw new SfError(t('promotionCreateSourceHasNoMergeTarget', { branch: sourceBranch }));
    }
    if (mergeTargets.length === 1 || agentMode) {
      targetBranch = mergeTargets[0];
    } else {
      const res = await prompts({
        type: 'select',
        name: 'value',
        message: c.cyanBright(t('promotionCreateSelectTargetBranch', { source: sourceBranch })),
        description: t('promotionCreateSelectTargetBranch', { source: sourceBranch }),
        choices: mergeTargets.map((branch) => ({ title: branch, value: branch })),
      });
      targetBranch = res.value;
    }
  }
  const targetOrg = majorOrgs.find((org: any) => (org.branchName || '').toLowerCase() === targetBranch.toLowerCase());
  if (!targetOrg) {
    throw new SfError(t('promotionCreateTargetNotMajor', { branch: targetBranch, branches: majorOrgs.map((org: any) => org.branchName).join(', ') }));
  }
  targetBranch = targetOrg.branchName;
  if (sourceBranch === targetBranch) {
    throw new SfError(t('promotionCreateSameBranches', { branch: sourceBranch }));
  }
  // Promoting outside of the declared pipeline is allowed (a hotfix may need it), but it is
  // unusual enough to be said out loud
  const declaredMergeTargets: string[] = sourceOrg.mergeTargets || [];
  if (!declaredMergeTargets.map((branch) => branch.toLowerCase()).includes(targetBranch.toLowerCase())) {
    uxLog('warning', commandThis, c.yellow(t('promotionCreateTargetNotMergeTarget', {
      source: sourceBranch,
      target: targetBranch,
      mergeTargets: declaredMergeTargets.join(', ') || '-',
    })));
  }
  return { sourceBranch, targetBranch };
}

// ---- Candidates ----

/**
 * Pull Requests merged into the source branch and not yet in the target branch: the
 * first-parent commits of origin/<source> since its merge base with origin/<target>.
 */
export async function listPromotionCandidates(
  sourceBranch: string,
  targetBranch: string,
  commandThis: any,
): Promise<PromotionCandidate[]> {
  await gitFetch(['origin', sourceBranch, targetBranch]);
  const mergeBase = (
    await execCommand(`git merge-base origin/${targetBranch} origin/${sourceBranch}`, commandThis, { fail: true, output: false })
  ).stdout.trim();
  const groups = await listMergedPrsWithCommits(`origin/${sourceBranch}`, sourceBranch, mergeBase, commandThis);
  const candidates = groups
    .filter((group) => group.commit.hash !== mergeBase)
    .map((group) => toCandidate(group));
  // A promotion carries cherry-picked commits: merging it into the target branch does not move
  // the merge base, so its stories keep showing up here. Say which ones are already on their way.
  return markAlreadyPromotedCandidates(candidates, await listAlreadyPromotedPullRequests(sourceBranch, targetBranch));
}

/**
 * Pull Request numbers already carried to the target branch by another promotion branch of the
 * same source, through a promotion Pull Request that is merged or still open.
 */
export async function listAlreadyPromotedPullRequests(
  sourceBranch: string,
  targetBranch: string,
): Promise<Map<number, AlreadyPromotedBy>> {
  const alreadyPromoted = new Map<number, AlreadyPromotedBy>();
  const gitProvider = await GitProvider.getInstance(true);
  if (!gitProvider) {
    return alreadyPromoted;
  }
  for (const status of ['merged', 'open']) {
    let pullRequests: CommonPullRequestInfo[] = [];
    try {
      pullRequests = (await gitProvider.listPullRequests({ status, targetBranch })) || [];
    } catch {
      continue; // No token, or the provider does not list Pull Requests: nothing can be checked
    }
    for (const pullRequest of pullRequests) {
      const parts = parsePromotionBranchName(pullRequest.sourceBranch);
      if (!parts || parts.sourceBranch.toLowerCase() !== sourceBranch.toLowerCase() || parts.targetBranch.toLowerCase() !== targetBranch.toLowerCase()) {
        continue;
      }
      for (const id of parsePromotionPullRequestIds(pullRequest.description) || []) {
        if (!alreadyPromoted.has(id)) {
          alreadyPromoted.set(id, {
            idStr: pullRequest.idStr,
            sourceBranch: pullRequest.sourceBranch,
            webUrl: pullRequest.webUrl,
            merged: !!pullRequest.mergedDate,
          });
        }
      }
    }
  }
  return alreadyPromoted;
}

export function markAlreadyPromotedCandidates(
  candidates: PromotionCandidate[],
  alreadyPromoted: Map<number, AlreadyPromotedBy>,
): PromotionCandidate[] {
  for (const candidate of candidates) {
    const number = candidate.pullRequestNumbers.find((id) => alreadyPromoted.has(id));
    if (number !== undefined) {
      candidate.alreadyPromotedBy = alreadyPromoted.get(number);
    }
  }
  return candidates;
}

export function toCandidate(group: BackpromotePrGroup): PromotionCandidate {
  const pullRequestNumbers = [...new Set(group.associatedPrs.map((pr) => pr.id).filter((id) => id > 0))];
  const firstPr = group.associatedPrs[0];
  const title = firstPr?.title || group.commit.message.split('\n')[0];
  const prLabel = pullRequestNumbers.length > 0 ? pullRequestNumbers.map((id) => `#${id}`).join(', ') + ' ' : '';
  return {
    group,
    pullRequestNumbers,
    label: `${prLabel}${title} (${firstPr?.author || group.commit.author}) [${group.commit.hash.substring(0, 7)}]`,
  };
}

/**
 * Candidates matching the Pull Request numbers passed with --pull-requests. Every number must
 * match a candidate: a typo must not silently produce a smaller promotion.
 */
export function selectCandidatesByPullRequestNumbers(candidates: PromotionCandidate[], numbers: number[]): PromotionCandidate[] {
  const selected: PromotionCandidate[] = [];
  const missing: number[] = [];
  for (const number of numbers) {
    const candidate = candidates.find((entry) => entry.pullRequestNumbers.includes(number));
    if (!candidate) {
      missing.push(number);
    } else if (!selected.includes(candidate)) {
      selected.push(candidate);
    }
  }
  if (missing.length > 0) {
    throw new SfError(t('promotionCreatePullRequestsNotFound', {
      numbers: missing.map((number) => `#${number}`).join(', '),
      available: candidates.flatMap((entry) => entry.pullRequestNumbers).map((number) => `#${number}`).join(', ') || '-',
    }));
  }
  // Chronological order, whatever the order of the flag
  return candidates.filter((candidate) => selected.includes(candidate));
}

export function parsePullRequestNumbersFlag(flagValue: string | undefined | null): number[] {
  return String(flagValue || '')
    .split(/[\s,]+/)
    .map((item) => item.replace(/^[#!]/, '').trim())
    .filter((item) => item !== '')
    .map((item) => parseInt(item, 10))
    .filter((number) => Number.isInteger(number) && number > 0);
}

export async function selectPromotionCandidates(
  candidates: PromotionCandidate[],
  pullRequestsFlag: string | null,
  agentMode: boolean,
  commandThis: any,
): Promise<PromotionCandidate[]> {
  const numbers = parsePullRequestNumbersFlag(pullRequestsFlag);
  if (numbers.length > 0) {
    return selectCandidatesByPullRequestNumbers(candidates, numbers);
  }
  if (agentMode) {
    throw new SfError(t('promotionCreateAgentRequiresPullRequests', {
      available: candidates.flatMap((entry) => entry.pullRequestNumbers).map((number) => `#${number}`).join(', ') || '-',
    }));
  }
  // Newest first in the prompt, like the backpromote one
  const choices = [...candidates].reverse().map((candidate) => ({
    title: candidate.label,
    value: candidate.group.commit.hash,
    description: candidate.group.associatedPrs.map((pr) => pr.sourceBranch).filter(Boolean).join(', '),
  }));
  const res = await prompts({
    type: 'multiselect',
    name: 'value',
    message: c.cyanBright(t('promotionCreateSelectPullRequests')),
    description: t('promotionCreateSelectPullRequests'),
    choices,
  });
  const hashes: string[] = res.value || [];
  const selected = candidates.filter((candidate) => hashes.includes(candidate.group.commit.hash));
  if (selected.length === 0) {
    throw new SfError(t('promotionCreateNothingSelected'));
  }
  uxLog('action', commandThis, c.cyan(t('promotionCreateSelected', { count: selected.length })));
  return selected;
}

// ---- Branch name ----

/**
 * Next counter for promotion/<source>/<target>/<date>-<n>: one more than the highest existing
 * one among the given branch names (local and remote), 1 when there is none.
 */
export function computePromotionCounter(existingBranchNames: string[], sourceBranch: string, targetBranch: string, date: string): number {
  const prefix = `${PROMOTION_BRANCH_PREFIX}/${sourceBranch}/${targetBranch}/${date}-`.toLowerCase();
  let max = 0;
  for (const rawName of existingBranchNames) {
    const name = rawName.trim().replace(/^refs\/heads\//, '').replace(/^(origin|remotes\/origin)\//, '').toLowerCase();
    if (name.startsWith(prefix)) {
      const counter = parseInt(name.substring(prefix.length), 10);
      if (Number.isInteger(counter) && counter > max) {
        max = counter;
      }
    }
  }
  return max + 1;
}

export async function listExistingPromotionBranchNames(sourceBranch: string, targetBranch: string, commandThis: any): Promise<string[]> {
  const names: string[] = [];
  try {
    const remote = await runCommandSafe(`git ls-remote --heads origin "${PROMOTION_BRANCH_PREFIX}/${sourceBranch}/${targetBranch}/*"`, commandThis, { output: false });
    for (const line of (remote.stdout || '').split('\n')) {
      const ref = line.split(/\s+/)[1];
      if (ref) {
        names.push(ref);
      }
    }
  } catch {
    // Offline: local branches only
  }
  const local = await git().branchLocal();
  names.push(...local.all);
  return names;
}

export async function nextPromotionBranchName(sourceBranch: string, targetBranch: string, commandThis: any, now: Date = new Date()): Promise<string> {
  const date = now.toISOString().substring(0, 10);
  const existing = await listExistingPromotionBranchNames(sourceBranch, targetBranch, commandThis);
  const counter = computePromotionCounter(existing, sourceBranch, targetBranch, date);
  return buildPromotionBranchName(sourceBranch, targetBranch, counter, now);
}

// ---- Cherry-picks ----

export async function createPromotionBranch(branchName: string, targetBranch: string, commandThis: any): Promise<void> {
  uxLog('action', commandThis, c.cyan(t('promotionCreateCreatingBranch', { branch: c.green(branchName), target: c.green(targetBranch) })));
  await gitFetch(['origin', targetBranch]);
  await git({ output: true }).checkoutBranch(branchName, `origin/${targetBranch}`);
}

async function isMergeCommit(hash: string): Promise<boolean> {
  const parents = (await git().raw(['rev-list', '--parents', '-n', '1', hash])).trim().split(/\s+/);
  return parents.length > 2;
}

export type PromotionConflictChoice = 'skip' | 'commit-with-markers' | 'abort';
export const PROMOTION_CONFLICT_CHOICES: PromotionConflictChoice[] = ['skip', 'commit-with-markers', 'abort'];

export interface CherryPickOutcome {
  picked: PromotionCandidate[];
  skipped: PromotionCandidate[];
  // Committed with their conflict markers, to be solved on the branch before the merge
  conflicted: Array<{ candidate: PromotionCandidate; files: string[] }>;
}

/**
 * Cherry-pick the selected commits, oldest first, with -x so each commit keeps a pointer to its
 * origin and -m 1 for merge commits. On a conflict the user (or the --on-conflict flag) decides:
 * leave the story out, commit it anyway with its conflict markers so they can be solved later on
 * the branch (by hand or with a coding agent), or stop and undo the whole promotion.
 */
export async function cherryPickCandidates(
  candidates: PromotionCandidate[],
  branchName: string,
  previousBranch: string,
  onConflict: PromotionConflictChoice | null,
  agentMode: boolean,
  commandThis: any,
): Promise<CherryPickOutcome> {
  const outcome: CherryPickOutcome = { picked: [], skipped: [], conflicted: [] };
  for (const candidate of candidates) {
    const hash = candidate.group.commit.hash;
    const mergeOption = (await isMergeCommit(hash)) ? ' -m 1' : '';
    uxLog('action', commandThis, c.cyan(t('promotionCreateCherryPicking', { label: candidate.label })));
    const res = await runCommandSafe(`git cherry-pick -x${mergeOption} ${hash}`, commandThis, { output: true });
    if (res.status === 0) {
      outcome.picked.push(candidate);
      continue;
    }
    const conflictFiles = await listConflictFiles();
    uxLog('warning', commandThis, c.yellow(t('promotionCreateConflict', { label: candidate.label, files: conflictFiles.join('\n') || '-' })));
    const choice = onConflict || (agentMode ? 'abort' : await promptConflictChoice(candidate, commandThis));
    if (choice === 'skip') {
      await runCommandSafe('git cherry-pick --abort', commandThis, { output: false });
      uxLog('log', commandThis, c.grey(t('promotionCreateConflictSkipped', { label: candidate.label })));
      outcome.skipped.push(candidate);
      continue;
    }
    if (choice === 'commit-with-markers') {
      await commitWithConflictMarkers(commandThis);
      uxLog('warning', commandThis, c.yellow(t('promotionCreateConflictCommitted', { label: candidate.label, files: conflictFiles.join(', ') || '-' })));
      outcome.picked.push(candidate);
      outcome.conflicted.push({ candidate, files: conflictFiles });
      continue;
    }
    await abortPromotion(branchName, previousBranch, commandThis);
    if (agentMode) {
      // An agent cannot see the interactive log: name the story and the files in the error itself
      throw new SfError(t('promotionCreateConflictAgent', { label: candidate.label, files: conflictFiles.join(', ') || '-' }));
    }
    throw new SfError(t('promotionCreateAborted'));
  }
  return outcome;
}

async function promptConflictChoice(candidate: PromotionCandidate, commandThis: any): Promise<PromotionConflictChoice> {
  const res = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(t('promotionCreateConflictPrompt', { label: candidate.label })),
    description: t('promotionCreateConflictPrompt', { label: candidate.label }),
    choices: [
      { title: t('promotionCreateConflictSkip'), value: 'skip' },
      { title: t('promotionCreateConflictCommit'), value: 'commit-with-markers' },
      { title: t('promotionCreateConflictAbort'), value: 'abort' },
    ],
  });
  uxLog('action', commandThis, c.cyan(t('promotionCreateConflictChoice', { choice: res.value })));
  return res.value as PromotionConflictChoice;
}

/**
 * Finish the cherry-pick with the conflict markers left in the files: they are staged as they
 * are and the cherry-pick commit is created with its original message (and -x trailer).
 */
async function commitWithConflictMarkers(commandThis: any): Promise<void> {
  await execCommand('git add -A', commandThis, { fail: true, output: false });
  const res = await runCommandSafe('git -c core.editor=true cherry-pick --continue', commandThis, { output: false });
  if (res.status !== 0) {
    // Nothing left to commit for this cherry-pick (ex: only deletions already applied): commit directly
    await execCommand('git -c core.editor=true commit --no-edit --allow-empty', commandThis, { fail: true, output: false });
  }
}

async function listConflictFiles(): Promise<string[]> {
  try {
    const status = await git().status();
    return status.conflicted || [];
  } catch {
    return [];
  }
}

/**
 * Sources still holding git conflict markers. `--on-conflict commit-with-markers` commits them on
 * purpose, so they have to be solved on the branch before the merge: this is what makes the
 * validation job fail while they are there, with a message naming the files.
 */
export async function listFilesWithConflictMarkers(commandThis: any): Promise<string[]> {
  const packageDirectories = await getSfdxProjectPackageDirectories();
  const searchPaths = [...new Set([...packageDirectories.map((directory) => directory.path), 'manifest'])]
    .filter((directory) => fs.existsSync(directory))
    .map((directory) => `"${directory}"`);
  if (searchPaths.length === 0) {
    return [];
  }
  // Only the opening and closing markers: a line of "=======" is legitimate in markdown
  const res = await runCommandSafe(`git grep -l -E "^(<<<<<<< |>>>>>>> )" -- ${searchPaths.join(' ')}`, commandThis, { output: false });
  if (res.status !== 0) {
    return []; // 1 = nothing found, anything else = nothing that can be checked here
  }
  return (res.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Fail the job when the checked (or merged) Pull Request is a promotion Pull Request whose
 * committed conflict markers are still there. No provider call and no git call unless
 * enablePromotionBranches is set and the Pull Request is a promotion one.
 */
export async function assertNoPromotionConflictMarkers(commandThis: any, config: any): Promise<void> {
  if (getPromotionBranchConfig(config).enabled !== true) {
    return;
  }
  const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
  if (!isPromotionPullRequest(prInfo, getPromotionBranchConfig(config))) {
    return;
  }
  const files = await listFilesWithConflictMarkers(commandThis);
  if (files.length > 0) {
    throw new SfError(t('promotionConflictMarkersFound', {
      branch: prInfo!.sourceBranch,
      count: files.length,
      files: files.join(', '),
    }));
  }
}

/**
 * Undo everything: stop the cherry-pick in progress, go back to the previous branch, delete the
 * promotion branch. Nothing was pushed yet.
 */
export async function abortPromotion(branchName: string, previousBranch: string, commandThis: any): Promise<void> {
  uxLog('action', commandThis, c.cyan(t('promotionCreateUndoing', { branch: branchName })));
  await runCommandSafe('git cherry-pick --abort', commandThis, { output: false });
  try {
    await git().checkout(previousBranch || '-');
    await git().deleteLocalBranch(branchName, true);
  } catch (e) {
    uxLog('warning', commandThis, c.yellow(`[PromotionCreate] ${(e as Error).message}`));
  }
}

// ---- Pull Request ----

export function toStories(
  candidates: PromotionCandidate[],
  conflicted: Array<{ candidate: PromotionCandidate; files: string[] }> = [],
): PromotionStory[] {
  const stories: PromotionStory[] = [];
  for (const candidate of candidates) {
    const conflictFiles = conflicted.find((entry) => entry.candidate === candidate)?.files;
    if (candidate.group.associatedPrs.length === 0) {
      stories.push({
        number: 0,
        title: candidate.group.commit.message.split('\n')[0],
        author: candidate.group.commit.author,
        webUrl: '',
        sourceBranch: '',
        commitHash: candidate.group.commit.hash,
        ...(conflictFiles ? { conflictFiles } : {}),
      });
    }
    for (const pr of candidate.group.associatedPrs) {
      stories.push({
        number: pr.id,
        title: pr.title,
        author: pr.author,
        webUrl: pr.webUrl,
        sourceBranch: pr.sourceBranch,
        commitHash: candidate.group.commit.hash,
        ...(conflictFiles ? { conflictFiles } : {}),
      });
    }
  }
  return stories;
}

export function buildPromotionPullRequestTitle(sourceBranch: string, targetBranch: string, branchName: string): string {
  const suffix = branchName.split('/').pop() || '';
  return `Promotion ${sourceBranch} to ${targetBranch} (${suffix})`;
}

/**
 * Description of the promotion Pull Request. The YAML block is what the deployment jobs read
 * (see promotionBranchUtils.ts); the rest is for the reviewers.
 */
export function buildPromotionPullRequestBody(options: {
  sourceBranch: string;
  targetBranch: string;
  branchName: string;
  stories: PromotionStory[];
  skipped: PromotionStory[];
  ticketIds: string[];
}): string {
  const declared = [...new Set(options.stories.map((story) => story.number).filter((number) => number > 0))];
  const conflicted = options.stories.filter((story) => (story.conflictFiles || []).length > 0);
  const lines: string[] = [];
  lines.push(`Promotion branch \`${options.branchName}\` carrying ${options.stories.length} User Stor${options.stories.length === 1 ? 'y' : 'ies'} approved in \`${options.sourceBranch}\`, cherry-picked for \`${options.targetBranch}\`.`);
  lines.push('');
  if (conflicted.length > 0) {
    lines.push(`> ⚠️ **Conflicts to solve before merging.** ${conflicted.length} User Stor${conflicted.length === 1 ? 'y was' : 'ies were'} committed with git conflict markers (\`<<<<<<<\`, \`=======\`, \`>>>>>>>\`) left in the files listed below. Solve them on this branch, by hand or with a coding agent, and push: the validation job fails until they are gone.`);
    lines.push('');
  }
  lines.push('```yaml');
  lines.push(`${PROMOTION_PULL_REQUESTS_KEY}: [${declared.join(', ')}]`);
  lines.push('```');
  lines.push('');
  lines.push('## Carried Pull Requests');
  lines.push('');
  lines.push('| Pull Request | Title | Author | Source branch | Commit |');
  lines.push('|---|---|---|---|---|');
  for (const story of options.stories) {
    const prCell = story.number > 0 ? (story.webUrl ? `[#${story.number}](${story.webUrl})` : `#${story.number}`) : '-';
    lines.push(`| ${prCell} | ${sanitizeCell(story.title)} | ${sanitizeCell(story.author)} | ${story.sourceBranch ? `\`${story.sourceBranch}\`` : '-'} | \`${story.commitHash.substring(0, 7)}\` |`);
  }
  if (options.ticketIds.length > 0) {
    lines.push('');
    lines.push(`Tickets: ${options.ticketIds.join(', ')}`);
  }
  if (conflicted.length > 0) {
    lines.push('');
    lines.push('## Committed with conflict markers');
    lines.push('');
    for (const story of conflicted) {
      lines.push(`- ${story.number > 0 ? `#${story.number} ` : ''}${sanitizeCell(story.title)}`);
      for (const file of story.conflictFiles || []) {
        lines.push(`  - \`${file}\``);
      }
    }
    lines.push('');
    lines.push('<details>');
    lines.push('<summary>Prompt for a coding agent (Claude Code, Codex, Copilot...) to solve the conflicts</summary>');
    lines.push('');
    lines.push('````markdown');
    lines.push(buildConflictResolutionPrompt({
      sourceBranch: options.sourceBranch,
      targetBranch: options.targetBranch,
      branchName: options.branchName,
      conflicted,
    }));
    lines.push('````');
    lines.push('');
    lines.push('</details>');
  }
  if (options.skipped.length > 0) {
    lines.push('');
    lines.push('## Left out because of cherry-pick conflicts');
    lines.push('');
    for (const story of options.skipped) {
      lines.push(`- ${story.number > 0 ? `#${story.number} ` : ''}${sanitizeCell(story.title)}`);
    }
  }
  lines.push('');
  lines.push('_Created with `sf hardis:project:promotion:create`. Do not squash this Pull Request when merging it._');
  return lines.join('\n');
}

/**
 * Prompt to paste into a coding agent (Claude Code, Codex, Copilot...) to solve the conflicts
 * committed with their markers on the promotion branch. Self-contained: the agent gets the
 * branches, the stories, the files, the origin commits and the rules of a Salesforce metadata
 * merge, then what to do once the markers are gone.
 */
export function buildConflictResolutionPrompt(options: {
  sourceBranch: string;
  targetBranch: string;
  branchName: string;
  conflicted: PromotionStory[];
  pullRequestUrl?: string | null;
}): string {
  const files = [...new Set(options.conflicted.flatMap((story) => story.conflictFiles || []))];
  const lines: string[] = [];
  lines.push(`You are working in a Salesforce DX git repository managed with sfdx-hardis. Check out the branch \`${options.branchName}\` (\`git fetch origin && git checkout ${options.branchName}\`).`);
  lines.push('');
  lines.push(`This branch is a promotion branch: it was created from \`origin/${options.targetBranch}\` and carries User Stories cherry-picked from \`${options.sourceBranch}\` (\`git cherry-pick -x\`), so that only approved stories reach \`${options.targetBranch}\`. Some cherry-picks conflicted and were committed anyway with their git conflict markers (\`<<<<<<<\`, \`=======\`, \`>>>>>>>\`) left in the files. Your job is to solve those conflicts.`);
  lines.push('');
  lines.push('## Stories committed with conflict markers');
  lines.push('');
  for (const story of options.conflicted) {
    const ref = story.number > 0 ? `Pull Request #${story.number}` : 'Commit';
    lines.push(`- ${ref}: ${story.title}${story.webUrl ? ` (${story.webUrl})` : ''}. Origin commit in \`${options.sourceBranch}\`: \`${story.commitHash}\` (run \`git show ${story.commitHash.substring(0, 7)}\` to read the intended change).`);
    for (const file of story.conflictFiles || []) {
      lines.push(`  - \`${file}\``);
    }
  }
  lines.push('');
  lines.push('## Files to fix');
  lines.push('');
  for (const file of files) {
    lines.push(`- \`${file}\``);
  }
  lines.push('');
  lines.push('## Rules');
  lines.push('');
  lines.push(`1. In each file, the \`<<<<<<< HEAD\` side is the current content of \`${options.targetBranch}\` (plus the stories already applied on this branch), the \`>>>>>>>\` side is the change of the story being promoted. Keep the intent of the story while preserving everything else that exists in \`${options.targetBranch}\`. A conflict usually means the story depends on another story that is not part of this promotion: in that case, bring in only the minimum the promoted story needs, never the whole other story.`);
  lines.push('2. Salesforce metadata files are XML: the result must be well-formed, keep one entry per API name (no duplicated `<fullName>`, `<labels>`, `<fields>`, `<members>`...), keep the existing element order and indentation, and keep the XML declaration and namespace untouched. For `package.xml` and `destructiveChanges.xml`, merge the `<members>` lists and sort them.');
  lines.push('3. Do not touch files that have no conflict markers, and do not reformat the files you fix beyond the conflicting lines.');
  lines.push(`4. When no marker is left (\`git grep -n "^<<<<<<< \\|^=======$\\|^>>>>>>> " -- .\` returns nothing), run \`git diff --check\`, make sure every fixed XML file still parses, then commit with the message \`fix: solve cherry-pick conflicts of ${options.branchName}\` and push the branch (\`git push\`).`);
  lines.push(`5. Do not merge the Pull Request${options.pullRequestUrl ? ` (${options.pullRequestUrl})` : ''}: its validation job checks the deployment once your fix is pushed, and a human reviews it.`);
  lines.push('');
  lines.push('Report the files you changed and, for each conflict, the choice you made in one sentence.');
  return lines.join('\n');
}

function sanitizeCell(text: string): string {
  return (text || '').replace(/\r?\n/g, ' ').replace(/\|/g, '&#124;').trim();
}

/**
 * Save the coding agent prompt as a markdown report, so it can be copied from the job output or
 * opened from the VS Code extension.
 */
export async function writeConflictResolutionPrompt(options: {
  sourceBranch: string;
  targetBranch: string;
  branchName: string;
  conflicted: PromotionStory[];
  pullRequestUrl: string | null;
  commandThis: any;
}): Promise<string> {
  const prompt = buildConflictResolutionPrompt(options);
  const file = await generateReportPath('promotion-conflicts-prompt', '', { withDate: true, withBranchName: false, fileExtension: 'md' });
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, `${prompt}\n`, 'utf8');
  uxLog('warning', options.commandThis, c.yellow(t('promotionCreateConflictPromptFile', { file })));
  if (WebSocketClient.isAliveWithLwcUI()) {
    WebSocketClient.sendReportFileMessage(file, t('promotionCreateConflictPromptReportTitle'), 'report');
  }
  return file;
}

export async function collectStoryTicketIds(stories: PromotionStory[]): Promise<string[]> {
  const text = stories.map((story) => `${story.title}\n${story.sourceBranch}`).join('\n');
  try {
    const tickets = await TicketProvider.getProvidersTicketsFromString(text);
    return [...new Set(tickets.map((ticket) => ticket.id))].sort();
  } catch {
    return [];
  }
}

/**
 * Push the branch and open the Pull Request: through the git provider API when a token is
 * available, through the gh CLI on GitHub otherwise, and as a last resort the description is
 * saved to a file with instructions, since the branch itself is already assembled and pushed.
 */
export async function pushAndCreatePromotionPullRequest(options: {
  branchName: string;
  targetBranch: string;
  title: string;
  body: string;
  commandThis: any;
  skipPullRequest: boolean;
}): Promise<{ pushed: boolean; pullRequestUrl: string | null; descriptionFile: string | null }> {
  uxLog('action', options.commandThis, c.cyan(t('promotionCreatePushing', { branch: c.green(options.branchName) })));
  const pushRes = await runCommandSafe(`git push -u origin ${options.branchName}`, options.commandThis, { output: true });
  if (pushRes.status !== 0) {
    throw new SfError(t('promotionCreatePushFailed', { branch: options.branchName, message: (pushRes.stderr || pushRes.stdout || '').trim() }));
  }
  const descriptionFile = await generateReportPath('promotion-pull-request', '', { withDate: true, withBranchName: false, fileExtension: 'md' });
  await fs.ensureDir(path.dirname(descriptionFile));
  await fs.writeFile(descriptionFile, `# ${options.title}\n\n${options.body}\n`, 'utf8');
  if (options.skipPullRequest) {
    uxLog('log', options.commandThis, c.grey(t('promotionCreatePullRequestSkipped', { file: descriptionFile })));
    return { pushed: true, pullRequestUrl: null, descriptionFile };
  }
  uxLog('action', options.commandThis, c.cyan(t('promotionCreateCreatingPullRequest', { branch: c.green(options.branchName), target: c.green(options.targetBranch) })));
  let pullRequestUrl = await GitProvider.createPullRequest({
    title: options.title,
    body: options.body,
    sourceBranch: options.branchName,
    targetBranch: options.targetBranch,
  });
  if (!pullRequestUrl) {
    pullRequestUrl = await createPullRequestWithGhCli(options, descriptionFile);
  }
  if (pullRequestUrl) {
    uxLog('success', options.commandThis, c.green(t('promotionCreatePullRequestCreated', { url: pullRequestUrl })));
  } else {
    uxLog('warning', options.commandThis, c.yellow(t('promotionCreatePullRequestManual', { branch: options.branchName, target: options.targetBranch, file: descriptionFile })));
  }
  return { pushed: true, pullRequestUrl, descriptionFile };
}

async function createPullRequestWithGhCli(
  options: { branchName: string; targetBranch: string; title: string; commandThis: any },
  descriptionFile: string,
): Promise<string | null> {
  const remoteUrl = (await git().remote(['get-url', 'origin'])) || '';
  if (!String(remoteUrl).includes('github.com') || !(await which('gh'))) {
    return null;
  }
  const bodyFile = descriptionFile.replace(/\.md$/, '.body.md');
  const content = await fs.readFile(descriptionFile, 'utf8');
  // The file starts with the title heading, which must not be repeated in the body
  await fs.writeFile(bodyFile, content.replace(/^# [^\n]*\n\n/, ''), 'utf8');
  const res = await runCommandSafe(
    `gh pr create --base ${options.targetBranch} --head ${options.branchName} --title "${options.title.replace(/"/g, '\\"')}" --body-file "${bodyFile}"`,
    options.commandThis,
    { output: false },
  );
  // The body file is a temporary copy of the description report, it has no reason to survive
  await fs.remove(bodyFile).catch(() => null);
  if (res.status !== 0) {
    uxLog('log', options.commandThis, c.grey(`[PromotionCreate] gh pr create failed: ${(res.stderr || res.stdout || '').trim()}`));
    return null;
  }
  const url = (res.stdout || '').trim().split('\n').find((line) => line.startsWith('http')) || null;
  return url;
}
