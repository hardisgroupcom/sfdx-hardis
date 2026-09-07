import { SfError } from '@salesforce/core';
import c from 'chalk';
import * as path from 'path';
import fs from './fsUtils.js';
import { createWorkBranchFromTarget, execCommand, git, gitFetch, uxLog } from './index.js';
import { prompts } from './prompts.js';
import { t } from './i18n.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { BackpromotePrGroup, listMergedPrsWithCommits } from './backpromoteUtils.js';
import { CommonPullRequestInfo, GitProvider } from '../gitProvider/index.js';
import { TicketProvider } from '../ticketProvider/index.js';
import { which } from './whichUtils.js';
import { generateReportPath } from './filesUtils.js';
import { getReportDirectory } from '../../config/index.js';
import { WebSocketClient } from '../websocketClient.js';
import {
  allowedPromotionSourceBranches,
  allowedPromotionTargetBranches,
  buildPromotionBranchName,
  formatPromotionSteps,
  getPromotionBranchConfig,
  isPromotionStepAllowed,
  PROMOTION_BRANCH_NAME_EXAMPLE,
  PromotionStep,
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

/**
 * Assembling a promotion checks out a branch and cherry-picks, which needs a clean tree. But
 * sfdx-hardis writes its own reports inside the repository (hardis-report/), and this very
 * command writes the candidates report before the cherry-picks: on a project that did not add
 * that folder to its .gitignore, those files are not changes the user has to commit, and
 * refusing to run because of them would make the command unusable.
 *
 * Everything else stops the command, but a human is offered a way out first: stash the changes
 * or commit them. Only the files the user actually changed are stashed or committed, never the
 * reports, so getting the work back afterwards does not fight with what sfdx-hardis wrote. In
 * agent mode and in CI nothing is touched: the run stops with the same message as before.
 */
export interface GitStatusFile {
  path: string;
  working_dir?: string;
}

/**
 * The files of a git status the user actually has to deal with: everything but the report
 * directory sfdx-hardis writes inside the repository.
 */
export function userChangesOutsideReports<T extends GitStatusFile>(files: T[], reportDirectory: string): T[] {
  const reportRoot = reportDirectory.replace(/\\/g, '/').replace(/\/+$/, '');
  return (files || []).filter((fileStatus) => {
    const filePath = (fileStatus.path || '').replace(/\\/g, '/');
    return !filePath.startsWith(`${reportRoot}/`) && filePath !== reportRoot;
  });
}

/**
 * Pathspec limiting a stash or a commit to those files: the reports must stay where they are, so
 * getting the stashed work back later does not fight with what sfdx-hardis wrote meanwhile.
 */
export function gitPathSpec(files: GitStatusFile[]): string {
  return files.map((fileStatus) => `"${fileStatus.path}"`).join(' ');
}

export async function checkGitCleanForPromotion(commandThis: any, agentMode = false): Promise<void> {
  const status = await git({ output: true }).status();
  const reportDirectory = path.basename(await getReportDirectory());
  const userChanges = userChangesOutsideReports(status.files || [], reportDirectory);
  if (userChanges.length === 0) {
    return;
  }
  const currentBranch = status.current || '';
  const localUpdates = userChanges.map((fileStatus) => `(${fileStatus.working_dir}) ${fileStatus.path}`).join('\n');
  const warningMessage = t('branchIsNotCleanCommitOrResetLocalUpdates', {
    branch: c.bold(currentBranch),
    localUpdates: c.yellow(localUpdates),
  });
  uxLog('warning', commandThis, c.yellow(warningMessage));
  if (agentMode) {
    throw new SfError(`[sfdx-hardis] ${warningMessage}`);
  }
  const pathSpec = gitPathSpec(userChanges);
  const promptRes = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(t('promotionCreateDirtyTreeQuestion')),
    description: t('promotionCreateDirtyTreeQuestionDesc'),
    choices: [
      { title: t('promotionCreateDirtyTreeStash'), value: 'stash' },
      { title: t('promotionCreateDirtyTreeCommit', { branch: currentBranch }), value: 'commit' },
      { title: t('promotionCreateDirtyTreeCancel'), value: 'cancel' },
    ],
  });
  if (promptRes.value === 'stash') {
    const stashLabel = `sfdx-hardis promotion ${new Date().toISOString()}`;
    const stashRes = await runCommandSafe(
      `git stash push --include-untracked --message "${stashLabel}" -- ${pathSpec}`,
      commandThis,
      { output: true }
    );
    if (stashRes.status !== 0) {
      throw new SfError(t('promotionCreateDirtyTreeStashFailed', { error: stashRes.stderr || stashRes.stdout }));
    }
    uxLog('action', commandThis, c.cyan(t('promotionCreateDirtyTreeStashed', { branch: currentBranch })));
    return;
  }
  if (promptRes.value === 'commit') {
    const messageRes = await prompts({
      type: 'text',
      name: 'value',
      message: c.cyanBright(t('promotionCreateDirtyTreeCommitMessage')),
      description: t('promotionCreateDirtyTreeCommitMessageDesc'),
      initial: 'chore: save local changes before assembling a promotion branch',
    });
    const commitMessage = (messageRes.value || '').trim() || 'chore: save local changes before assembling a promotion branch';
    const addRes = await runCommandSafe(`git add -- ${pathSpec}`, commandThis, { output: true });
    if (addRes.status !== 0) {
      throw new SfError(t('promotionCreateDirtyTreeCommitFailed', { error: addRes.stderr || addRes.stdout }));
    }
    const commitRes = await runCommandSafe(
      `git commit -m "${commitMessage.replace(/"/g, "'")}" -- ${pathSpec}`,
      commandThis,
      { output: true }
    );
    if (commitRes.status !== 0) {
      throw new SfError(t('promotionCreateDirtyTreeCommitFailed', { error: commitRes.stderr || commitRes.stdout }));
    }
    uxLog(
      'action',
      commandThis,
      c.cyan(t('promotionCreateDirtyTreeCommitted', { count: userChanges.length, branch: currentBranch }))
    );
    return;
  }
  throw new SfError(`[sfdx-hardis] ${warningMessage}`);
}

export interface PromotionCandidate {
  group: BackpromotePrGroup;
  // Provider-native numbers of the Pull Requests merged by this commit (0 = unknown)
  pullRequestNumbers: number[];
  label: string;
  // Set when another promotion branch already carries this story to the same target branch:
  // cherry-picking it a second time would replay the same change
  alreadyPromotedBy?: AlreadyPromotedBy;
  // Set when only PART of the Pull Requests of this commit were already promoted: the commit still
  // has to travel, but the overlap has to be said out loud
  partiallyPromoted?: { numbers: number[]; by: AlreadyPromotedBy };
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
  allowedSteps: PromotionStep[] = [],
): Promise<{ sourceBranch: string; targetBranch: string }> {
  const majorOrgs = await listMajorOrgs();
  const promotable = majorOrgs.filter((org: any) => org.branchName && (org.mergeTargets || []).length > 0);
  if (promotable.length === 0) {
    throw new SfError(t('promotionCreateNoPromotableBranch'));
  }
  // allowedPromotionSteps restricts which steps a release manager may assemble: the branches left
  // out are never offered, and naming one in --source-branch is refused before anything is listed
  const allowedSourceNames = allowedPromotionSourceBranches(allowedSteps, promotable.map((org: any) => org.branchName));
  const allowedPromotable = promotable.filter((org: any) => allowedSourceNames.includes(org.branchName));
  if (allowedPromotable.length === 0) {
    throw new SfError(t('promotionCreateNoAllowedStep', {
      steps: formatPromotionSteps(allowedSteps),
      branches: promotable.map((org: any) => org.branchName).join(', '),
    }));
  }
  let sourceBranch = sourceFlag || '';
  if (!sourceBranch) {
    if (agentMode) {
      throw new SfError(t('promotionCreateAgentRequiresSourceBranch', { branches: allowedPromotable.map((org: any) => org.branchName).join(', ') }));
    }
    const res = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(t('promotionCreateSelectSourceBranch')),
      description: t('promotionCreateSelectSourceBranch'),
      choices: allowedPromotable.map((org: any) => ({
        title: `${org.branchName} -> ${allowedPromotionTargetBranches(allowedSteps, org.branchName, org.mergeTargets || []).join(', ')}`,
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
  if (allowedPromotionSourceBranches(allowedSteps, [sourceBranch]).length === 0) {
    throw new SfError(t('promotionCreateSourceNotAllowed', { branch: sourceBranch, steps: formatPromotionSteps(allowedSteps) }));
  }
  let targetBranch = targetFlag || '';
  if (!targetBranch) {
    const mergeTargets: string[] = sourceOrg.mergeTargets || [];
    if (mergeTargets.length === 0) {
      throw new SfError(t('promotionCreateSourceHasNoMergeTarget', { branch: sourceBranch }));
    }
    const allowedTargets = allowedPromotionTargetBranches(allowedSteps, sourceBranch, mergeTargets);
    if (allowedTargets.length === 0) {
      throw new SfError(t('promotionCreateNoAllowedTarget', {
        source: sourceBranch,
        mergeTargets: mergeTargets.join(', '),
        steps: formatPromotionSteps(allowedSteps),
      }));
    }
    if (allowedTargets.length === 1 || agentMode) {
      targetBranch = allowedTargets[0];
    } else {
      const res = await prompts({
        type: 'select',
        name: 'value',
        message: c.cyanBright(t('promotionCreateSelectTargetBranch', { source: sourceBranch })),
        description: t('promotionCreateSelectTargetBranch', { source: sourceBranch }),
        choices: allowedTargets.map((branch) => ({ title: branch, value: branch })),
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
  // --target-branch skips the prompt entirely: the step is checked here whichever way it was chosen
  if (!isPromotionStepAllowed(allowedSteps, sourceBranch, targetBranch)) {
    throw new SfError(t('promotionCreateStepNotAllowed', {
      source: sourceBranch,
      target: targetBranch,
      steps: formatPromotionSteps(allowedSteps),
    }));
  }
  // The naming convention has exactly four segments, so a branch name holding a "/" would produce
  // a branch the deployment jobs cannot recognize as a promotion
  for (const branch of [sourceBranch, targetBranch]) {
    if (branch.includes('/')) {
      throw new SfError(t('promotionCreateBranchNameWithSlash', { branch, example: PROMOTION_BRANCH_NAME_EXAMPLE }));
    }
  }
  // Promoting outside of the declared pipeline is allowed (a hotfix may need it), but it is
  // unusual enough to be said out loud. Logged as an action, not a warning: this is the first
  // output after the branch prompts, and the VS Code UI hides everything but an action there.
  const declaredMergeTargets: string[] = sourceOrg.mergeTargets || [];
  if (!declaredMergeTargets.map((branch) => branch.toLowerCase()).includes(targetBranch.toLowerCase())) {
    uxLog('action', commandThis, c.yellow(t('promotionCreateTargetNotMergeTarget', {
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
  supersededPromotions: CommonPullRequestInfo[] = [],
): Promise<PromotionCandidate[]> {
  await gitFetch(['origin', sourceBranch, targetBranch]);
  const mergeBase = (
    await execCommand(`git merge-base origin/${targetBranch} origin/${sourceBranch}`, commandThis, { fail: true, output: false })
  ).stdout.trim();
  const groups = await listMergedPrsWithCommits(`origin/${sourceBranch}`, sourceBranch, mergeBase, commandThis);
  const majorOrgs = await listMajorOrgs();
  const majorBranchNames = (majorOrgs || []).map((org: any) => org.branchName).filter((branch: string) => branch);
  const gitProviderForExpansion = await GitProvider.getInstance();
  const expandedGroups = gitProviderForExpansion
    ? await expandPromotionsInGroups(groups, (id) => gitProviderForExpansion.getPullRequestById(id), commandThis)
    : groups;
  const candidates = dropVehiclePullRequests(expandedGroups, majorBranchNames)
    .filter((group) => group.commit.hash !== mergeBase)
    .map((group) => toCandidate(group));
  // A promotion carries cherry-picked commits: merging it into the target branch does not move
  // the merge base, so its stories keep showing up here. Say which ones are already on their way.
  // A promotion carrying one of these candidates cannot predate the oldest of them, which bounds
  // the provider calls. The merge base is not usable for that: any back-merge from the target
  // branch moves it forward and would hide older promotions.
  const minDate = oldestCandidateDate(candidates);
  return markAlreadyPromotedCandidates(
    candidates,
    await listAlreadyPromotedPullRequests(sourceBranch, targetBranch, minDate, commandThis, supersededPromotions),
  );
}

/**
 * Date of the oldest candidate, to bound the Pull Request queries: a promotion carrying one of
 * them was necessarily created after it was merged. Null when no date can be read, in which case
 * the queries stay unbounded rather than silently miss a promotion.
 */
export function oldestCandidateDate(candidates: PromotionCandidate[]): Date | null {
  const times = candidates
    .map((candidate) => new Date(candidate.group.commit.date))
    .filter((date) => !isNaN(date.getTime()))
    .map((date) => date.getTime());
  return times.length > 0 ? new Date(Math.min(...times)) : null;
}

/**
 * Pull Request numbers already carried to the target branch by another promotion branch of the
 * same source, through a promotion Pull Request that is merged or still open.
 */
/**
 * The identity of a Pull Request as the already-promoted check compares it: providers fill idStr
 * and idNumber differently, so both are accepted.
 */
export function pullRequestKeys(pullRequest: { idStr?: string; idNumber?: number }): string[] {
  const keys: string[] = [];
  if (pullRequest.idStr) {
    keys.push(String(pullRequest.idStr));
  }
  if (pullRequest.idNumber) {
    keys.push(String(pullRequest.idNumber));
  }
  return keys;
}

/**
 * Whether a Pull Request is evidence that the stories it declares are already on their way to the
 * target branch: it must be a promotion of this very step (a promotion retargeted or named for
 * other branches proves nothing), and it must not be one this run is about to supersede.
 */
export function countsAsAlreadyPromoted(
  pullRequest: CommonPullRequestInfo,
  sourceBranch: string,
  targetBranch: string,
  supersededKeys: Set<string>
): boolean {
  const parts = parsePromotionBranchName(pullRequest.sourceBranch);
  if (
    !parts ||
    parts.sourceBranch.toLowerCase() !== sourceBranch.toLowerCase() ||
    parts.targetBranch.toLowerCase() !== targetBranch.toLowerCase()
  ) {
    return false;
  }
  return !pullRequestKeys(pullRequest).some((key) => supersededKeys.has(key));
}

export async function listAlreadyPromotedPullRequests(
  sourceBranch: string,
  targetBranch: string,
  minDate: Date | null = null,
  commandThis: any = null,
  supersededPromotions: CommonPullRequestInfo[] = [],
): Promise<Map<number, AlreadyPromotedBy>> {
  const alreadyPromoted = new Map<number, AlreadyPromotedBy>();
  // The promotions this run replaces are on their way out: what they carry is not promoted, it is
  // what the new promotion is being assembled from. Counting them would refuse every story of the
  // promotion the user just agreed to supersede.
  const supersededKeys = new Set(supersededPromotions.flatMap((pullRequest) => pullRequestKeys(pullRequest)));
  // Never prompt for a provider here: this runs inside a listing step, and getInstance(true) would
  // block an --agent run on an interactive question
  const gitProvider = await GitProvider.getInstance();
  if (!gitProvider) {
    // This map is the only duplicate protection of the command: an empty one must not look like a
    // clean pipeline
    uxLog('warning', commandThis, c.yellow(t('promotionCreateAlreadyPromotedCheckImpossible')));
    return alreadyPromoted;
  }
  for (const status of ['merged', 'open']) {
    let pullRequests: CommonPullRequestInfo[] = [];
    try {
      pullRequests = (await gitProvider.listPullRequests({ status, targetBranch, ...(minDate ? { minDate } : {}) })) || [];
    } catch (e) {
      uxLog('warning', commandThis, c.yellow(t('promotionCreateAlreadyPromotedCheckFailed', { status, message: (e as Error).message })));
      continue;
    }
    for (const pullRequest of pullRequests) {
      if (!countsAsAlreadyPromoted(pullRequest, sourceBranch, targetBranch, supersededKeys)) {
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
    // The cherry-pick unit is the commit, so it is only redundant when every Pull Request it
    // carries has already been promoted. When only some were, the commit still has to travel and
    // the candidate stays selectable, with the partial overlap reported to the user.
    const promotedNumbers = candidate.pullRequestNumbers.filter((id) => alreadyPromoted.has(id));
    if (promotedNumbers.length > 0 && promotedNumbers.length === candidate.pullRequestNumbers.length) {
      candidate.alreadyPromotedBy = alreadyPromoted.get(promotedNumbers[0]);
    } else if (promotedNumbers.length > 0) {
      candidate.partiallyPromoted = {
        numbers: promotedNumbers,
        by: alreadyPromoted.get(promotedNumbers[0])!,
      };
    }
  }
  return candidates;
}

/**
 * Replace the promotion Pull Requests of each group by the User Stories they declare.
 *
 * A promotion merged into the source branch arrives in the next branch as a single cherry-picked
 * merge commit, and that commit names the promotion, not the stories under it: the -x trailers of
 * the individual stories only survive one level. Two levels down, the group would hold nothing but
 * a promotion, dropVehiclePullRequests would empty it, and the candidate would be an unselectable
 * row with no number, stranding its stories one branch short of production.
 *
 * So a promotion is expanded before the vehicles are dropped, from the promotionPullRequests block
 * of its description, the same declaration the deployment jobs read. A promotion carrying another
 * promotion is expanded in turn, since the list being walked grows as it goes.
 */
export async function expandPromotionsInGroups(
  groups: BackpromotePrGroup[],
  fetchPullRequest: (id: number) => Promise<CommonPullRequestInfo | null>,
  commandThis: any = null,
): Promise<BackpromotePrGroup[]> {
  const fetched = new Map<number, CommonPullRequestInfo | null>();
  const load = async (id: number): Promise<CommonPullRequestInfo | null> => {
    if (!fetched.has(id)) {
      try {
        fetched.set(id, await fetchPullRequest(id));
      } catch (e) {
        uxLog('warning', commandThis, c.yellow(t('promotionCreateCarriedPrUnreadable', { pr: `#${id}`, message: (e as Error).message })));
        fetched.set(id, null);
      }
    }
    return fetched.get(id) || null;
  };
  const result: BackpromotePrGroup[] = [];
  for (const group of groups) {
    const associatedPrs = [...(group.associatedPrs || [])];
    const initialCount = associatedPrs.length;
    const known = new Set(associatedPrs.map((pr) => pr.id));
    for (let index = 0; index < associatedPrs.length; index++) {
      const associatedPr = associatedPrs[index];
      if (!associatedPr.id || parsePromotionBranchName(associatedPr.sourceBranch || '') === null) {
        continue;
      }
      const promotionPullRequest = await load(associatedPr.id);
      for (const declaredId of parsePromotionPullRequestIds(promotionPullRequest?.description) || []) {
        if (known.has(declaredId)) {
          continue;
        }
        const story = await load(declaredId);
        if (!story) {
          uxLog('warning', commandThis, c.yellow(t('promotionCreateCarriedPrNotFound', {
            pr: `#${declaredId}`,
            promotionPr: `#${associatedPr.id}`,
          })));
          continue;
        }
        known.add(declaredId);
        associatedPrs.push({
          id: story.idNumber,
          title: story.title,
          author: story.authorName,
          webUrl: story.webUrl,
          sourceBranch: story.sourceBranch,
        });
      }
    }
    result.push(associatedPrs.length === initialCount ? group : { ...group, associatedPrs });
  }
  return result;
}

/**
 * A commit is associated with a Pull Request by walking the commits it brought in, and a merge
 * commit from a major branch (a back-merge, a sync, the previous major-to-major merge) matches the
 * Pull Request of that major branch. Such a Pull Request moves other work, it is not work of its
 * own: listing it as carried would declare it in the promotion, run its deployment actions and
 * show it in the Pull Request body as a User Story. Promotion Pull Requests are dropped for the
 * same reason.
 *
 * Same rule as the DevOps Pipeline lists and the release notes: only what carries its own change
 * is a User Story, whatever its branch is named (feature, fix, retrofit, hotfix...).
 */
export function dropVehiclePullRequests(
  groups: BackpromotePrGroup[],
  majorBranchNames: string[]
): BackpromotePrGroup[] {
  const majorBranches = new Set((majorBranchNames || []).map((branch) => (branch || '').toLowerCase()));
  return groups.map((group) => {
    const kept = (group.associatedPrs || []).filter((pr) => {
      const prSourceBranch = (pr.sourceBranch || '').toLowerCase();
      if (prSourceBranch === '') {
        return true;
      }
      return !majorBranches.has(prSourceBranch) && parsePromotionBranchName(prSourceBranch) === null;
    });
    if (kept.length === group.associatedPrs.length) {
      return group;
    }
    const keptIds = new Set(kept.map((pr) => pr.id));
    return {
      ...group,
      associatedPrs: kept,
      prConfigs: (group.prConfigs || []).filter((prConfig) => keptIds.has(prConfig.prId)),
    };
  });
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

/**
 * A candidate is a first-parent merge commit, which may have brought several Pull Requests in at
 * once (a major-to-major merge typically brings a whole window). Cherry-picking it carries all of
 * them, so the numbers the caller did not ask for are reported: the promotion is not the subset
 * the user typed.
 */
export function listUnrequestedPullRequestNumbers(
  selected: PromotionCandidate[],
  requestedNumbers: number[],
): Array<{ candidate: PromotionCandidate; numbers: number[] }> {
  const requested = new Set(requestedNumbers);
  return selected
    .map((candidate) => ({
      candidate,
      numbers: candidate.pullRequestNumbers.filter((number) => !requested.has(number)),
    }))
    .filter((entry) => entry.numbers.length > 0);
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
  // Agent mode takes the flag as the selection. Interactive mode uses it to preselect the
  // prompt: the VS Code extension passes the stories ticked in the DevOps Pipeline, and the
  // user confirms or adjusts before anything is cherry-picked.
  const preselected = numbers.length > 0 ? selectCandidatesByPullRequestNumbers(candidates, numbers) : [];
  if (numbers.length > 0 && agentMode) {
    return preselected;
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
    initial: preselected.map((candidate) => candidate.group.commit.hash),
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
  const remote = await runCommandSafe(`git ls-remote --heads origin "${PROMOTION_BRANCH_PREFIX}/${sourceBranch}/${targetBranch}/*"`, commandThis, { output: false });
  if (remote.status !== 0) {
    // Without the remote branches the counter can reuse a name that already exists on origin, and
    // the push would only fail once every cherry-pick is done: say it now
    uxLog('warning', commandThis, c.yellow(t('promotionCreateRemoteBranchesUnavailable', {
      message: (remote.stderr || remote.stdout || '').trim() || '-',
    })));
  }
  for (const line of (remote.stdout || '').split('\n')) {
    const ref = line.split(/\s+/)[1];
    if (ref) {
      names.push(ref);
    }
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
  // The shared helper of hardis:work:new: it refuses a branch already checked out in another
  // worktree, resumes an existing local or remote branch, and falls back to a local ref when the
  // remote-tracking one is missing. Re-implementing the checkout lost all three.
  await createWorkBranchFromTarget(branchName, targetBranch);
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
  // Nothing to cherry-pick: the change is already in the target branch (hotfix, retrofit, or an
  // earlier promotion). Not a conflict, and not something to leave in the branch either.
  alreadyThere: PromotionCandidate[];
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
  const outcome: CherryPickOutcome = { picked: [], skipped: [], alreadyThere: [], conflicted: [] };
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
    // git cherry-pick also exits non-zero when the change is already in the target branch. That is
    // not a conflict: asking the user (or aborting the whole promotion in agent mode) over a
    // change that is already delivered would be wrong.
    if (conflictFiles.length === 0 && (await isEmptyCherryPick(commandThis))) {
      await runCommandSafe('git cherry-pick --skip', commandThis, { output: false });
      uxLog('warning', commandThis, c.yellow(t('promotionCreateCherryPickEmpty', { label: candidate.label })));
      outcome.alreadyThere.push(candidate);
      continue;
    }
    uxLog('warning', commandThis, c.yellow(t('promotionCreateConflict', { label: candidate.label, files: conflictFiles.join('\n') || '-' })));
    const choice = onConflict || (agentMode ? 'abort' : await promptConflictChoice(candidate, commandThis));
    if (choice === 'skip') {
      await runCommandSafe('git cherry-pick --abort', commandThis, { output: false });
      uxLog('log', commandThis, c.grey(t('promotionCreateConflictSkipped', { label: candidate.label })));
      outcome.skipped.push(candidate);
      continue;
    }
    if (choice === 'commit-with-markers') {
      const committed = await commitWithConflictMarkers(commandThis);
      if (!committed) {
        // Staging the conflict left nothing over HEAD: there is no story to carry and no marker to
        // solve, so declaring it with a coding-agent prompt would send the agent on a hunt for
        // markers that do not exist
        uxLog('warning', commandThis, c.yellow(t('promotionCreateCherryPickEmpty', { label: candidate.label })));
        outcome.alreadyThere.push(candidate);
        continue;
      }
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
async function commitWithConflictMarkers(commandThis: any): Promise<boolean> {
  await execCommand('git add -A', commandThis, { fail: true, output: false });
  const res = await runCommandSafe('git -c core.editor=true cherry-pick --continue', commandThis, { output: false });
  if (res.status === 0) {
    return true;
  }
  // --continue refused. Either the staged content matches HEAD (nothing to carry), or something
  // else went wrong: the index is what tells the two apart.
  const staged = await runCommandSafe('git diff --cached --quiet HEAD', commandThis, { output: false });
  if (staged.status === 0) {
    await runCommandSafe('git cherry-pick --skip', commandThis, { output: false });
    return false;
  }
  await execCommand('git -c core.editor=true commit --no-edit', commandThis, { fail: true, output: false });
  return true;
}

/**
 * True when a cherry-pick stopped because it had nothing to apply: CHERRY_PICK_HEAD is there, no
 * file conflicts, and the index holds no change over HEAD.
 */
async function isEmptyCherryPick(commandThis: any): Promise<boolean> {
  try {
    const inProgress = await git().raw(['rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD']).catch(() => '');
    if (!String(inProgress).trim()) {
      return false;
    }
    const status = await git().status();
    if ((status.conflicted || []).length > 0) {
      return false;
    }
    // Only the index says whether this cherry-pick has anything to apply. status.files is the whole
    // worktree, untracked files included, and the command itself writes a report before this point.
    const staged = await runCommandSafe('git diff --cached --quiet HEAD', commandThis, { output: false });
    return staged.status === 0;
  } catch {
    return false;
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
  // Every tracked file, not only the package directories: a cherry-pick conflicts wherever the
  // stories touched the repository (config/, scripts/actions/, data/...), commitWithConflictMarkers
  // stages all of it with git add -A, and the Pull Request body lists all of it as to be fixed.
  // git grep only searches tracked files, so the report folder and node_modules stay out.
  // Only the opening and closing markers: a line of "=======" is legitimate in markdown
  const res = await runCommandSafe('git grep -l -E "^(<<<<<<< |>>>>>>> )"', commandThis, { output: false });
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
 * Every Pull Request the promotion is responsible for in the target org: the ones it cherry-picked
 * AND the ones whose metadata was already there (an earlier hotfix delivered the same change).
 * The second kind still needs its deployment actions and Apex test classes in that org, so it must
 * be declared, otherwise the deployment job never puts it in scope.
 */
export function declaredPullRequestNumbers(stories: PromotionStory[], alreadyThere: PromotionStory[] = []): number[] {
  return [...new Set([...stories, ...alreadyThere].map((story) => story.number).filter((number) => number > 0))];
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
  alreadyThere?: PromotionStory[];
}): string {
  const declared = declaredPullRequestNumbers(options.stories, options.alreadyThere || []);
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
  if ((options.alreadyThere || []).length > 0) {
    lines.push('');
    lines.push(`## Already in \`${options.targetBranch}\``);
    lines.push('');
    lines.push('Nothing to cherry-pick for those User Stories, their change is already in the target branch. They stay declared above, so their deployment actions and Apex test classes still run in the target org:');
    lines.push('');
    for (const story of options.alreadyThere || []) {
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
/**
 * Only one promotion can be in flight between two major branches: the DevOps Pipeline draws it on
 * the edge between the two branch nodes, and two open promotions from uat to preprod would mean
 * two answers to "what is being promoted right now". Lists the ones already open, so the command
 * can close them when it creates a new one.
 *
 * Returns an empty list when the provider cannot answer: not knowing is not a reason to stop
 * assembling a promotion.
 */
export async function listOpenPromotionPullRequests(
  sourceBranch: string,
  targetBranch: string,
  commandThis: any
): Promise<CommonPullRequestInfo[]> {
  const openPullRequests = await GitProvider.listOpenPullRequests(targetBranch);
  if (openPullRequests == null) {
    uxLog('log', commandThis, c.grey(t('promotionCreateOpenPromotionsUnknown', { source: sourceBranch, target: targetBranch })));
    return [];
  }
  return filterOpenPromotionPullRequests(openPullRequests, sourceBranch, targetBranch);
}

/**
 * Among open Pull Requests, the promotions of this very pipeline step: named for this source and
 * this target, and actually targeting that branch. A promotion retargeted by hand is left alone,
 * exactly as the deployment jobs leave it alone.
 */
export function filterOpenPromotionPullRequests(
  pullRequests: CommonPullRequestInfo[],
  sourceBranch: string,
  targetBranch: string
): CommonPullRequestInfo[] {
  return (pullRequests || []).filter((pullRequest) => {
    const parts = parsePromotionBranchName(pullRequest.sourceBranch || '');
    return (
      parts != null &&
      parts.sourceBranch.toLowerCase() === sourceBranch.toLowerCase() &&
      parts.targetBranch.toLowerCase() === targetBranch.toLowerCase() &&
      (pullRequest.targetBranch || '').toLowerCase() === targetBranch.toLowerCase()
    );
  });
}

/**
 * Asks a human before superseding the promotions already open between the two branches. An agent
 * or a CI job is not asked: it closes them, which is the point of the flag. Returns false when the
 * user chose to keep them, and the command must stop before touching git.
 */
export async function confirmSupersedeOpenPromotions(
  openPromotions: CommonPullRequestInfo[],
  sourceBranch: string,
  targetBranch: string,
  agentMode: boolean,
  commandThis: any
): Promise<boolean> {
  if (openPromotions.length === 0) {
    return true;
  }
  const list = openPromotions.map((pullRequest) => `#${pullRequest.idNumber} ${pullRequest.title}`).join('\n');
  uxLog('warning', commandThis, c.yellow(t('promotionCreateOpenPromotionExists', {
    source: c.bold(sourceBranch),
    target: c.bold(targetBranch),
    pullRequests: c.yellow(list),
  })));
  if (agentMode) {
    return true;
  }
  const promptRes = await prompts({
    type: 'confirm',
    name: 'value',
    message: c.cyanBright(t('promotionCreateOpenPromotionCloseQuestion', { count: openPromotions.length })),
    description: t('promotionCreateOpenPromotionCloseQuestionDesc'),
    initial: true,
  });
  return promptRes.value === true;
}

/**
 * Closes the promotions that the freshly created one supersedes. Done after the new Pull Request
 * exists, so a failure while assembling never leaves the pipeline step without an open promotion.
 */
export async function closeSupersededPromotionPullRequests(
  openPromotions: CommonPullRequestInfo[],
  newPullRequestUrl: string | null,
  commandThis: any
): Promise<number[]> {
  const closed: number[] = [];
  for (const pullRequest of openPromotions) {
    if (newPullRequestUrl && pullRequest.webUrl && pullRequest.webUrl === newPullRequestUrl) {
      continue;
    }
    const ok = await GitProvider.closePullRequest(pullRequest.idNumber);
    if (ok) {
      closed.push(pullRequest.idNumber);
      uxLog('log', commandThis, c.grey(t('promotionCreateOpenPromotionClosed', { number: pullRequest.idNumber, url: pullRequest.webUrl })));
    } else {
      uxLog('warning', commandThis, c.yellow(t('promotionCreateOpenPromotionCloseManually', { number: pullRequest.idNumber, url: pullRequest.webUrl })));
    }
  }
  return closed;
}

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
