import { AuthInfo, Connection, Org, SfError } from '@salesforce/core';
import c from 'chalk';
import * as path from 'path';
import fs from './fsUtils.js';
import { execSfdxJson, getCurrentGitBranch, isCI, uxLog } from './index.js';
import { GitProvider } from '../gitProvider/index.js';
import { PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { authOrg } from './authUtils.js';
import { findUserByUsernameLike } from './orgUtils.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { prompts } from './prompts.js';
import { t } from './i18n.js';
import { gitUserName } from './backpromoteGitUtils.js';
import { BackpromoteActionRow, BackpromoteCommentStore, upsertActionRow } from './backpromoteCommentUtils.js';
import { deriveSandboxName } from './backpromoteRules.js';
import * as os from 'os';
import { ActionWhen, DEV_SANDBOXES_BRANCH_NAME, buildActionTargetBranchCandidates, readActions, readPullRequestDescriptionActions, resolvePrId } from './actionUtils.js';
import {
  DeploymentActionRef,
  DeploymentActionStateEntry,
  buildClosedByHandNote,
  buildRunLocallyNote,
  getActionStateEntry,
  getJobInfoWithUrl,
  getStateEntriesForPr,
  loadDeploymentActionsState,
  persistDeploymentActionsState,
  syncManualActionCheckboxes,
  upsertActionInState,
} from './deploymentActionsStateUtils.js';
import { getEffectiveActionContext, getReportedActionStatus, replayActionOutputs, runSingleDeploymentAction } from './prePostCommandUtils.js';
import { findLocalActionState, upsertLocalActionState } from './deploymentActionsLocalState.js';
import { buildPipelineContext } from './pipelineContextUtils.js';

/** Number of local Pull Request action files scanned to propose the failed actions */
export const ACTION_RUN_SCAN_LIMIT = 30;

export type NextActionsMode = 'none' | 'one' | 'all';

/** Statuses an action can be retried or closed by hand from */
const RECOVERABLE_STATUSES: DeploymentActionStateEntry['status'][] = ['failed', 'not-run', 'warning'];
// What can be closed by hand: the same, plus a manual action waiting for someone (what ticking its
// checkbox in the Pull Request comment does, naming who did it)
const CLOSABLE_STATUSES: DeploymentActionStateEntry['status'][] = [...RECOVERABLE_STATUSES, 'manual'];

/** The org an action is retried in, and the branch it is tracked under */
export interface ActionRunTarget {
  conn: Connection;
  username: string;
  instanceUrl: string;
  orgBranch: string;
  isMajorOrg: boolean;
}

export interface ActionRunResult {
  prNumber: number;
  actionId: string;
  label: string;
  orgBranch: string;
  status: string;
  output?: string;
  // A failure that stops the actions after it, as in a deployment job: not a manual action, not
  // a failure the action allows
  blocking: boolean;
}

/**
 * Retrying or closing an action writes its new state in a Pull Request comment: without a git
 * provider token, the result would be lost and the action would run again at the next deployment.
 */
export async function requireGitProviderForActionState(): Promise<void> {
  const gitProvider = await GitProvider.getInstance();
  if (!gitProvider) {
    throw new SfError(t('actionRunRequiresGitProvider'));
  }
}

/**
 * Find the org an action is retried in, and the org branch it is tracked under.
 * - With --org-branch, the org is the major org of that branch: the target org when it is the same
 *   instance, otherwise an org of that instance already authenticated on this computer.
 * - Without it, the target org (or the default org) decides: a major org when its instance URL is
 *   the one of a major branch config, otherwise a dev org tracked under the current git branch.
 */
export async function resolveActionRunTarget(targetOrg: Org | undefined, orgBranchFlag: string | undefined): Promise<ActionRunTarget> {
  const majorOrgs = await listMajorOrgs();
  if (orgBranchFlag) {
    const majorOrg = majorOrgs.find((org: any) => org.branchName === orgBranchFlag);
    if (!majorOrg) {
      // Not a major branch: a dev org, the target org must be passed
      if (!targetOrg) {
        throw new SfError(t('actionRunNoOrgForBranch', { branch: orgBranchFlag }));
      }
      return buildTarget(targetOrg.getConnection(), orgBranchFlag, false);
    }
    if (targetOrg && isOrgOfMajorBranch(targetOrg.getConnection(), majorOrg)) {
      return buildTarget(targetOrg.getConnection(), orgBranchFlag, true);
    }
    const conn = await findAuthenticatedConnection(majorOrg);
    if (!conn) {
      throw new SfError(t('actionRunNoAuthenticatedOrg', { branch: orgBranchFlag, instanceUrl: majorOrg.instanceUrl || '?' }));
    }
    return buildTarget(conn, orgBranchFlag, true);
  }
  if (!targetOrg) {
    throw new SfError(t('actionRunNoTargetOrg'));
  }
  const conn = targetOrg.getConnection();
  const majorOrg = majorOrgs.find((org: any) => isOrgOfMajorBranch(conn, org));
  if (majorOrg) {
    return buildTarget(conn, majorOrg.branchName, true);
  }
  // A developer org is tracked under the virtual branch name every developer org shares, never
  // under the checked out branch: that branch can be a major one, and a try in a sandbox must not
  // count as done in the org of that branch
  const currentBranch = await getCurrentGitBranch() || 'unknown';
  uxLog("warning", this, c.yellow(t('actionRunDevOrgUsed', { instanceUrl: conn.instanceUrl, branch: currentBranch })));
  return buildTarget(conn, DEV_SANDBOXES_BRANCH_NAME, false);
}

/**
 * Org branch of an action closed by hand: --org-branch, or the major branch of the target org.
 * No org work is done, the org is only used to name who closed the action.
 */
export async function resolveOrgBranchForStatus(targetOrg: Org | undefined, orgBranchFlag: string | undefined): Promise<{ orgBranch: string; sfUsername: string | null }> {
  const sfUsername = targetOrg?.getUsername() || null;
  if (orgBranchFlag) {
    // The note names the Salesforce user of the org of that branch, never the default org of the
    // computer (often a developer sandbox, unrelated to the action closed)
    const majorOrg = (await listMajorOrgs()).find((org: any) => org.branchName === orgBranchFlag);
    if (!majorOrg) {
      return { orgBranch: orgBranchFlag, sfUsername };
    }
    if (targetOrg && isOrgOfMajorBranch(targetOrg.getConnection(), majorOrg)) {
      return { orgBranch: orgBranchFlag, sfUsername };
    }
    const authorizations = (await AuthInfo.listAllAuthorizations()).filter(isUsableAuthorization);
    return { orgBranch: orgBranchFlag, sfUsername: pickBranchOrgUsername(authorizations, majorOrg) };
  }
  if (!targetOrg) {
    throw new SfError(t('missingRequiredFlag', { flag: 'org-branch' }));
  }
  const conn = targetOrg.getConnection();
  const majorOrg = (await listMajorOrgs()).find((org: any) => isOrgOfMajorBranch(conn, org));
  return { orgBranch: majorOrg?.branchName || DEV_SANDBOXES_BRANCH_NAME, sfUsername };
}

/**
 * The definition of an action is read from the current checkout. When the org is a major org and
 * the checkout is another branch, the definition may differ from the one of the org branch:
 * say so and ask before going on.
 */
export async function confirmDefinitionBranch(target: ActionRunTarget, allowMismatch: boolean, headless: boolean): Promise<void> {
  if (!target.isMajorOrg) {
    return;
  }
  const currentBranch = await getCurrentGitBranch() || '';
  if (currentBranch === target.orgBranch) {
    return;
  }
  const message = t('actionRunBranchMismatch', { orgBranch: target.orgBranch, currentBranch: currentBranch || '?' });
  uxLog("warning", this, c.yellow(message));
  if (allowMismatch) {
    return;
  }
  if (headless) {
    throw new SfError(t('actionRunBranchMismatchHeadless', { orgBranch: target.orgBranch }));
  }
  const confirmed = await promptConfirm(message);
  if (!confirmed) {
    throw new SfError(t('actionRunCancelled'));
  }
}

/**
 * Pull Request of the action: --pr, or a choice among the recent Pull Requests whose actions
 * failed (or were stopped) in the org branch.
 */
export async function selectSourcePullRequest(prFlag: string | number | undefined, orgBranch: string, headless: boolean): Promise<number> {
  if (prFlag !== undefined && prFlag !== null && String(prFlag) !== '') {
    return parsePrNumber(String(prFlag));
  }
  if (headless) {
    throw new SfError(t('missingRequiredFlag', { flag: 'pr' }));
  }
  const prNumbers = listLocalPullRequestActionFiles().slice(0, ACTION_RUN_SCAN_LIMIT);
  if (prNumbers.length > 0) {
    uxLog("action", this, c.cyan(t('actionRunScanningPullRequests', { count: prNumbers.length })));
    await loadDeploymentActionsState(prNumbers);
  }
  const choices: { title: string; value: number }[] = [];
  for (const prNumber of prNumbers) {
    const entries = getStateEntriesForPr(prNumber).filter((e) => e.orgBranch === orgBranch);
    const failed = entries.filter((e) => e.status === 'failed' || e.status === 'warning').length;
    const notRun = entries.filter((e) => e.status === 'not-run').length;
    if (failed + notRun > 0) {
      choices.push({ title: t('actionRunPrChoice', { pr: prNumber, failed, notRun }), value: prNumber });
    }
  }
  if (choices.length === 0) {
    uxLog("action", this, c.cyan(t('actionRunNoFailedActionFound', { orgBranch, count: prNumbers.length })));
  }
  choices.push({ title: t('actionRunOtherPr'), value: 0 });
  const selected = await promptSelect(t('actionRunSelectPr'), choices);
  if (selected !== 0) {
    return selected;
  }
  const entered = await promptText(t('actionRunEnterPrNumber'));
  return parsePrNumber(entered);
}

/**
 * Action to retry or close: --action-id, or a choice among the actions of the Pull Request that
 * failed (or were stopped) in the org branch. Loads the state of the Pull Request.
 */
export async function selectRecoverableAction(prNumber: number, actionIdFlag: string | undefined, orgBranch: string, headless: boolean, includeManual = false): Promise<string> {
  uxLog("action", this, c.cyan(t('actionListStatusHeader', { count: 1 })));
  await loadDeploymentActionsState([prNumber]);
  // A box ticked in a comment since the last job must be recorded before this command rewrites the
  // comment: rebuilt from the state alone, it would come back unticked
  try {
    await syncManualActionCheckboxes([prNumber]);
  } catch (e) {
    uxLog("warning", this, c.yellow('[DeploymentActions] ' + t('deploymentActionsCheckboxSyncError', { message: (e as Error).message })));
  }
  if (actionIdFlag) {
    return actionIdFlag;
  }
  if (headless) {
    throw new SfError(t('missingRequiredFlag', { flag: 'action-id' }));
  }
  const statuses = includeManual ? CLOSABLE_STATUSES : RECOVERABLE_STATUSES;
  const entries = getStateEntriesForPr(prNumber).filter((e) => e.orgBranch === orgBranch && statuses.includes(e.status));
  if (entries.length === 0) {
    throw new SfError(t('actionRunNoFailedActionInPr', { pr: prNumber, orgBranch }));
  }
  return promptSelect(t('actionRunSelectAction'), entries
    .sort((a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0))
    .map((e) => ({
      title: `${e.actionLabel} (${e.status === 'not-run' ? t('actionRunStatusNotRun') : e.status === 'manual' ? t('actionRunStatusManual') : t('actionRunStatusFailed')})`,
      value: e.actionId,
    })));
}

/**
 * Definition of an action of a Pull Request, read where a deployment job reads it: the Pull Request
 * action file, the YAML block of its description, then the branch and project config (whose actions
 * are tracked in the comment of the Pull Request that was merged).
 */
export async function resolveActionDefinition(prNumber: number, actionId: string, orgBranch: string): Promise<PrePostCommand> {
  for (const when of ['post-deploy', 'pre-deploy'] as ActionWhen[]) {
    const fromFile = (await readActions('pr', when, undefined, String(prNumber))).find((a) => a.id === actionId);
    if (fromFile) {
      return { ...fromFile, when };
    }
  }
  for (const when of ['post-deploy', 'pre-deploy'] as ActionWhen[]) {
    const fromDescription = (await readPullRequestDescriptionActions(prNumber, when)).find((a) => a.id === actionId);
    if (fromDescription) {
      // The Pull Request is known from the state: the comment the outcome goes to
      delete fromDescription.pullRequest;
      return fromDescription;
    }
  }
  for (const when of ['post-deploy', 'pre-deploy'] as ActionWhen[]) {
    const fromConfig = [
      ...(await readActions('branch', when, orgBranch)),
      ...(await readActions('project', when)),
    ].find((a) => a.id === actionId);
    if (fromConfig) {
      return { ...fromConfig, when };
    }
  }
  throw new SfError(t('actionRunDefinitionNotFound', { actionId, pr: prNumber }));
}

/**
 * Refuse what cannot be retried, and ask before retrying what probably should not be.
 * The state of the Pull Request must have been loaded.
 */
export async function checkRetryAllowed(def: PrePostCommand, prNumber: number, orgBranch: string, headless: boolean): Promise<void> {
  const entry = getActionStateEntry(prNumber, def.id, orgBranch);
  const refuse = (reason: string) => {
    throw new SfError(t('actionRunNotAllowed', { label: def.label, reason }));
  };
  if (def.type === 'remove-packagexml-items') {
    refuse(t('actionRunDevOrgSkipPackageXml'));
  }
  if (getEffectiveActionContext(def) === 'check-deployment-only') {
    refuse(t('actionRunReasonCheckOnly'));
  }
  if (entry?.status === 'success') {
    refuse(t('actionRunReasonAlreadyDone', { orgBranch, date: (entry.date || '').substring(0, 10) }));
  }
  if (entry?.status === 'moved') {
    refuse(t('actionRunReasonMoved', { pr: entry.movedTo || '?' }));
  }
  // In a deployment a pre-deployment action runs before the metadata, which is already in the org
  // now: a person may still decide it is worth running, an automation re-runs the deployment job
  if (def.when === 'pre-deploy') {
    if (headless) {
      refuse(t('actionRunReasonPreDeploy'));
    }
    await confirmOrWarn(t('actionRunPreDeployConfirm', { label: def.label, orgBranch }), headless);
  }
  if (!entry || !RECOVERABLE_STATUSES.includes(entry.status)) {
    // Nothing says this action belongs in this org yet (a Pull Request not merged there, for
    // instance): a person may decide to run it, an automation may not
    if (headless) {
      refuse(t('actionRunReasonNoRecordHeadless', { orgBranch }));
    }
    await confirmOrWarn(t('actionRunNeverRunInOrg', { label: def.label, orgBranch }), headless);
    return;
  }
  if (entry.status === 'not-run' && entry.blockedBy) {
    await loadDeploymentActionsState([entry.blockedBy.pr]);
    const blocker = getActionStateEntry(entry.blockedBy.pr, entry.blockedBy.actionId, orgBranch);
    if (blocker && (blocker.status === 'failed' || blocker.status === 'not-run')) {
      await confirmOrWarn(t('actionRunBlockedByStillFailed', { label: blocker.actionLabel, orgBranch }), headless);
    }
  }
}

/**
 * An action with a customUsername runs as that user: make sure this computer is authenticated
 * with it, and offer to log in with it when it is not. It is never silently run as someone else.
 */
export async function ensureCustomUsernameAuth(def: PrePostCommand, target: ActionRunTarget, headless: boolean): Promise<void> {
  if (!def.customUsername) {
    return;
  }
  const user = await findUserByUsernameLike(def.customUsername, target.conn);
  if (!user) {
    throw new SfError(t('actionRunCustomUsernameNotFound', { username: def.customUsername, label: def.label }));
  }
  if (await isUsernameConnected(user.Username)) {
    return;
  }
  if (headless) {
    throw new SfError(t('actionRunCustomUsernameNotAuthenticated', { username: user.Username, label: def.label }));
  }
  const confirmed = await promptConfirm(t('actionRunCustomUsernameLogin', { label: def.label, username: user.Username }));
  if (!confirmed) {
    throw new SfError(t('actionRunCancelled'));
  }
  await authOrg(target.orgBranch, { forceUsername: user.Username, instanceUrl: target.instanceUrl, setDefault: false });
  if (!(await isUsernameConnected(user.Username))) {
    const actual = globalThis.justConnectedOrg?.username || '?';
    throw new SfError(t('actionRunWrongCustomUsername', { actual, label: def.label, expected: user.Username }));
  }
}

/**
 * Run one action outside of a deployment job, in the target org, and record its outcome in the
 * Deployment Actions comment of its Pull Request, with who ran it.
 */
export async function runActionOutsideDeployment(
  def: PrePostCommand,
  prNumber: number,
  target: ActionRunTarget,
  options: { localPrId?: string } = {}
): Promise<ActionRunResult> {
  // An action moved from another Pull Request: that one's state says whether it already ran here,
  // and receives the 'moved' entry
  const movedFrom = Number(def.movedFrom);
  if (Number.isInteger(movedFrom) && movedFrom > 0) {
    await loadDeploymentActionsState([movedFrom]);
  }
  // The sf commands started by the action (sf apex run...) use the default org: point it at the
  // target org for this process only, without touching the project config of the user.
  process.env.SF_TARGET_ORG = target.username;
  globalThis.jsForceConn = target.conn;
  // Outputs that other actions of the Pull Request persisted in this org stay consumable
  for (const entry of getStateEntriesForPr(prNumber)) {
    if (entry.orgBranch === target.orgBranch && entry.status === 'success' && entry.outputs && Object.keys(entry.outputs).length > 0) {
      replayActionOutputs(entry.actionId, entry.outputs);
    }
  }
  const majorBranchNames = (await listMajorOrgs()).map((org: any) => org.branchName);
  const executionOrder = getActionStateEntry(prNumber, def.id, target.orgBranch)?.executionOrder ?? 0;
  uxLog("action", this, c.cyan(t('actionRunRunningLocally', { label: def.label, pr: prNumber > 0 ? prNumber : 'draft', orgBranch: target.orgBranch })));
  await runSingleDeploymentAction(def, {
    checkOnly: false,
    deployWhen: def.when || 'post-deploy',
    orgBranchName: target.orgBranch,
    currentPrNumber: prNumber,
    executionOrder,
    targetBranchCandidates: buildActionTargetBranchCandidates(target.orgBranch, majorBranchNames),
    hasGitProvider: !options.localPrId,
    pipelineContext: await buildPipelineContext({ checkOnly: false, when: def.when || 'post-deploy', targetBranch: target.orgBranch }),
    note: buildRunLocallyNote(gitUserName() || null, target.username, isCI),
    skipRunOnlyOnceCheck: !!options.localPrId,
  });
  // No Pull Request comment to hold the result: keep it in the local file of the Pull Request
  if (options.localPrId && def.result?.statusCode && def.result.statusCode !== 'not-run') {
    const file = upsertLocalActionState(options.localPrId, {
      actionId: def.id,
      actionLabel: def.label,
      orgBranch: target.orgBranch,
      when: def.when || 'post-deploy',
      executionOrder,
      status: getReportedActionStatus(def),
      jobId: 'local',
      jobUrl: '',
      date: new Date().toISOString(),
      // The end of the output, where the outcome is: an Apex debug log can be thousands of lines
      output: (def.result.output || def.result.skippedReason || '').slice(-2000),
      outputs: def.result.outputsForDisplay,
      note: buildRunLocallyNote(gitUserName() || null, target.username, isCI),
    });
    uxLog("log", this, c.grey(t('actionRunLocalStateSaved', { file })));
  }
  return {
    prNumber,
    actionId: def.id,
    label: def.label,
    orgBranch: target.orgBranch,
    status: def.result?.statusCode || 'unknown',
    output: def.result?.output || def.result?.skippedReason,
    blocking: def.result?.statusCode === 'failed' && def.allowFailure !== true,
  };
}

/**
 * Actions that the failure of this action stopped, still waiting, in execution order. For an
 * action that was itself stopped, the ones stopped after it by the same failure.
 */
export async function listStoppedActionsAfter(prNumber: number, actionId: string, orgBranch: string): Promise<DeploymentActionRef[]> {
  const entry = getActionStateEntry(prNumber, actionId, orgBranch);
  let refs: DeploymentActionRef[] = [];
  if (entry?.stoppedActions && entry.stoppedActions.length > 0) {
    refs = entry.stoppedActions;
  } else if (entry?.blockedBy) {
    await loadDeploymentActionsState([entry.blockedBy.pr]);
    const blocker = getActionStateEntry(entry.blockedBy.pr, entry.blockedBy.actionId, orgBranch);
    const all = blocker?.stoppedActions || [];
    const position = all.findIndex((ref) => ref.pr === prNumber && ref.actionId === actionId);
    refs = position >= 0 ? all.slice(position + 1) : [];
  }
  // Only those still waiting: another job, a retry or a tick may have handled some meanwhile
  await loadDeploymentActionsState([...new Set(refs.map((ref) => ref.pr))]);
  return refs.filter((ref) => getActionStateEntry(ref.pr, ref.actionId, orgBranch)?.status === 'not-run');
}

/**
 * What to do with the actions a failure stopped, once the failed action succeeded: --next, the
 * user's choice, or nothing in headless mode.
 */
export async function chooseNextActionsMode(count: number, nextFlag: NextActionsMode | undefined, headless: boolean): Promise<NextActionsMode> {
  if (count === 0) {
    return 'none';
  }
  if (nextFlag) {
    return nextFlag;
  }
  if (headless) {
    uxLog("action", this, c.cyan(t('actionRunStoppedActionsLeft', { count })));
    return 'none';
  }
  return promptSelect(t('actionRunChooseNext', { count }), [
    { title: t('actionRunNextOne'), value: 'one' },
    { title: t('actionRunNextAll'), value: 'all' },
    { title: t('actionRunNextStop'), value: 'none' },
  ]);
}

/**
 * After an action failed again during a retry of stopped actions, the remaining ones are now
 * stopped by it: record that, so the next retry starts from the right place.
 */
export async function recordNewBlocker(failed: ActionRunResult, remaining: DeploymentActionRef[]): Promise<void> {
  if (remaining.length === 0) {
    return;
  }
  const failedEntry = getActionStateEntry(failed.prNumber, failed.actionId, failed.orgBranch);
  if (failedEntry) {
    upsertActionInState({ ...failedEntry, stoppedActions: remaining }, failed.prNumber);
  }
  for (const ref of remaining) {
    const entry = getActionStateEntry(ref.pr, ref.actionId, failed.orgBranch);
    if (entry) {
      upsertActionInState({ ...entry, blockedBy: { pr: failed.prNumber, actionId: failed.actionId } }, ref.pr);
    }
  }
  await persistDeploymentActionsState();
}

/**
 * Record a failed, stopped or waiting manual action as done by hand in an org branch, with who did it and when,
 * then tick its checkboxes in the Pull Request comments.
 * The state of the Pull Request must have been loaded.
 */
export async function closeActionByHand(prNumber: number, actionId: string, orgBranch: string, sfUsername: string | null, extraNote?: string): Promise<DeploymentActionStateEntry> {
  const entry = getActionStateEntry(prNumber, actionId, orgBranch);
  if (!entry || !CLOSABLE_STATUSES.includes(entry.status)) {
    throw new SfError(t('actionSetStatusNotAllowed', { status: entry?.status || t('actionRunStatusNeverRun') }));
  }
  const { jobId, jobUrl } = isCI ? await getJobInfoWithUrl() : { jobId: 'local', jobUrl: '' };
  const closedEntry: DeploymentActionStateEntry = {
    ...entry,
    status: 'success',
    jobId,
    jobUrl,
    date: new Date().toISOString(),
    output: 'Closed by hand with sf hardis:project:action:set-status.',
    note: buildClosedByHandNote(entry.status === 'not-run' || entry.status === 'manual' ? entry.status : 'failed', gitUserName() || null, sfUsername, new Date(), extraNote),
    blockedBy: undefined,
  };
  upsertActionInState(closedEntry, prNumber);
  await persistDeploymentActionsState();
  // Tick the checkbox of the action in the other comments still showing it as failed
  try {
    await syncManualActionCheckboxes([prNumber]);
  } catch (e) {
    uxLog("warning", this, c.yellow('[DeploymentActions] ' + t('deploymentActionsCheckboxSyncError', { message: (e as Error).message })));
  }
  return closedEntry;
}

/**
 * The Pull Request whose actions run in a developer org: --pr (a number, or draft), else the
 * Pull Request of the current branch, else the draft file of the branch.
 * Returns the number (0 for the draft) and the id of its actions file.
 */
export async function resolveDevOrgPullRequest(prFlag: string | undefined, headless: boolean): Promise<{ prNumber: number; prId: string }> {
  if (prFlag === 'draft') {
    return { prNumber: 0, prId: 'draft' };
  }
  if (prFlag) {
    const prNumber = parsePrNumber(prFlag);
    return { prNumber, prId: String(prNumber) };
  }
  const resolved = await resolvePrId(this, 'current', headless);
  const prNumber = resolved ? parseInt(resolved, 10) : 0;
  return Number.isInteger(prNumber) && prNumber > 0 ? { prNumber, prId: String(prNumber) } : { prNumber: 0, prId: 'draft' };
}

/**
 * Every action of a Pull Request, in the order a deployment runs them: pre-deploy, then
 * post-deploy, each in the order of the actions file (then of the description, for a merged one).
 */
export async function listPullRequestActions(prNumber: number, prId: string): Promise<PrePostCommand[]> {
  const actions: PrePostCommand[] = [];
  for (const when of ['pre-deploy', 'post-deploy'] as ActionWhen[]) {
    const fromFile = await readActions('pr', when, undefined, prId === 'draft' ? undefined : prId);
    actions.push(...fromFile.map((action) => ({ ...action, when })));
    if (prNumber > 0) {
      const fromDescription = await readPullRequestDescriptionActions(prNumber, when).catch(() => []);
      for (const action of fromDescription) {
        if (!actions.some((existing) => existing.id === action.id)) {
          delete action.pullRequest;
          actions.push(action);
        }
      }
    }
  }
  return actions;
}

/**
 * Actions to run in a developer org: --all, --action-id, or a choice among the actions of the
 * Pull Request.
 */
export async function selectDevOrgActions(actions: PrePostCommand[], actionIdFlag: string | undefined, all: boolean, headless: boolean): Promise<PrePostCommand[]> {
  if (actions.length === 0) {
    throw new SfError(t('actionRunNoActionInPullRequest'));
  }
  if (all) {
    return actions;
  }
  let actionId = actionIdFlag;
  if (!actionId) {
    if (headless) {
      throw new SfError(t('missingRequiredFlag', { flag: 'action-id or --all' }));
    }
    actionId = await promptSelect(t('actionRunSelectAction'), [
      { title: t('actionRunAllActionsChoice', { count: actions.length }), value: '__all__' },
      ...actions.map((action) => ({ title: `${action.label} (${action.when})`, value: action.id })),
    ]);
    if (actionId === '__all__') {
      return actions;
    }
  }
  const action = actions.find((candidate) => candidate.id === actionId);
  if (!action) {
    throw new SfError(t('actionRunDefinitionNotFound', { actionId, pr: '?' }));
  }
  return [action];
}

/**
 * Why an action is not run in a developer org, or null when it is: a validation-only action and a
 * package.xml change have no meaning outside of a deployment, and a runOnlyOnceByOrg action already
 * done in this org is not run twice.
 */
export function getDevOrgSkipReason(def: PrePostCommand, prNumber: number, prId: string, orgBranch: string, localState: boolean, backpromoteRow?: BackpromoteActionRow | null): string | null {
  if (getEffectiveActionContext(def) === 'check-deployment-only') {
    return t('actionRunDevOrgSkipCheckOnly');
  }
  if (def.type === 'remove-packagexml-items') {
    return t('actionRunDevOrgSkipPackageXml');
  }
  if (def.runOnlyOnceByOrg !== false) {
    // With a Pull Request, the Backpromotes comment knows what ran in THIS org (sandbox name and org
    // id), where the dev-sandboxes column of the Deployment Actions comment is shared by every
    // developer org. Without one, the local results are all there is.
    if (backpromoteRow !== undefined) {
      if (backpromoteRow?.status === 'success') {
        return t('actionRunDevOrgSkipAlreadyDone', { date: (backpromoteRow.date || '').substring(0, 10) });
      }
      return null;
    }
    const done = localState
      ? findLocalActionState(prId, def.id, orgBranch)
      : getActionStateEntry(prNumber, def.id, orgBranch);
    if (done?.status === 'success') {
      return t('actionRunDevOrgSkipAlreadyDone', { date: (done.date || '').substring(0, 10) });
    }
  }
  return null;
}

/**
 * Any org authenticated on this computer, for "Run in another org": the orgs of the major branches
 * of the pipeline first, named after their branch, then every other org.
 */
export async function promptActionRunOrg(): Promise<Org> {
  const majorOrgs = await listMajorOrgs();
  const authorizations = (await AuthInfo.listAllAuthorizations()).filter(isUsableAuthorization);
  const choices = buildActionRunOrgChoices(authorizations, majorOrgs);
  if (choices.length === 0) {
    throw new SfError(t('actionRunNoAuthenticatedOrgAtAll'));
  }
  const username = await promptSelect(t('actionRunSelectAnyOrg'), choices);
  const org = await Org.create({ aliasOrUsername: username });
  return org;
}

/** The choices of promptActionRunOrg, major orgs first in the order of the pipeline */
export function buildActionRunOrgChoices(
  authorizations: { username: string; instanceUrl?: string; aliases?: string[] | null }[],
  majorOrgs: { branchName: string; targetUsername?: string; instanceUrl?: string }[]
): { title: string; value: string }[] {
  const ranked = authorizations.map((auth) => {
    const majorIndex = majorOrgs.findIndex((org) => sameUsername(auth.username, org.targetUsername) || sameInstance(auth.instanceUrl, org.instanceUrl));
    return { auth, majorIndex };
  });
  ranked.sort((a, b) => {
    const rankA = a.majorIndex < 0 ? Number.MAX_SAFE_INTEGER : a.majorIndex;
    const rankB = b.majorIndex < 0 ? Number.MAX_SAFE_INTEGER : b.majorIndex;
    return rankA - rankB || a.auth.username.localeCompare(b.auth.username);
  });
  return ranked.map(({ auth, majorIndex }) => {
    const aliases = auth.aliases && auth.aliases.length > 0 ? ` (${auth.aliases.join(', ')})` : '';
    return {
      title: majorIndex >= 0
        ? t('actionRunOrgChoiceMajor', { branch: majorOrgs[majorIndex].branchName, username: auth.username })
        : `${auth.username}${aliases}`,
      value: auth.username,
    };
  });
}

/**
 * The row of a run in a developer org for the "Backpromotes" comment of its Pull Request: the same
 * row a backpromote writes, so that a later backpromote of that sandbox knows the action already ran
 * there. null for an outcome that says nothing about the org (skipped, not run).
 */
export function buildDevOrgBackpromoteRow(
  def: PrePostCommand,
  target: Pick<ActionRunTarget, 'instanceUrl' | 'username'>,
  orgId: string,
  status: string,
  user: string,
  date: Date = new Date()
): BackpromoteActionRow | null {
  const rowStatus: BackpromoteActionRow['status'] | null =
    status === 'success' ? 'success' : status === 'manual' ? 'pending' : status === 'failed' || status === 'warning' ? 'failed' : null;
  if (!rowStatus) {
    return null;
  }
  return {
    actionId: def.id,
    label: def.label,
    phase: def.when === 'pre-deploy' ? 'pre' : 'post',
    sandboxName: deriveSandboxName({ instanceUrl: target.instanceUrl, username: target.username, orgId }),
    orgId,
    date: date.toISOString(),
    status: rowStatus,
    user,
  };
}

/** The org id of a target, as the Backpromotes comment keys its rows */
export function getActionRunTargetOrgId(target: ActionRunTarget): string {
  return String(target.conn.getAuthInfoFields()?.orgId || '');
}

/** Read the Backpromotes comment rows of a Pull Request for one org, by action id */
export async function readBackpromoteRowsForOrg(store: BackpromoteCommentStore, prNumber: number, target: ActionRunTarget): Promise<Map<string, BackpromoteActionRow>> {
  const orgId = getActionRunTargetOrgId(target);
  const sandboxName = deriveSandboxName({ instanceUrl: target.instanceUrl, username: target.username, orgId });
  const rows = new Map<string, BackpromoteActionRow>();
  try {
    const state = await store.read(prNumber, { fresh: true });
    for (const row of state.actionRows) {
      if (row.sandboxName === sandboxName && row.orgId === orgId) {
        rows.set(row.actionId, row);
      }
    }
  } catch (e) {
    uxLog("warning", this, c.yellow(t('backpromoteCommentWriteFailed', { pr: prNumber, message: (e as Error).message })));
  }
  return rows;
}

/** Write the outcome of a run in a developer org to the Backpromotes comment of its Pull Request */
export async function recordDevOrgRunInBackpromotes(store: BackpromoteCommentStore, def: PrePostCommand, prNumber: number, target: ActionRunTarget, status: string): Promise<void> {
  if (prNumber <= 0) {
    return;
  }
  const row = buildDevOrgBackpromoteRow(def, target, getActionRunTargetOrgId(target), status, gitUserName() || os.userInfo().username);
  if (!row) {
    return;
  }
  try {
    await store.update(prNumber, (state) => upsertActionRow(state, row));
    uxLog("log", this, c.grey(t('actionRunBackpromoteRecorded', { pr: prNumber, sandboxName: row.sandboxName })));
  } catch (e) {
    uxLog("warning", this, c.yellow(t('backpromoteCommentWriteFailed', { pr: prNumber, message: (e as Error).message })));
  }
}

function buildTarget(conn: Connection, orgBranch: string, isMajorOrg: boolean): ActionRunTarget {
  return { conn, username: conn.getUsername() || '', instanceUrl: conn.instanceUrl, orgBranch, isMajorOrg };
}

/**
 * The org of a major branch config: the same instance URL, or the same username. The instanceUrl
 * of a branch config is often the login URL (https://test.salesforce.com for a sandbox or a
 * scratch org), which no connection ever reports: the username then tells.
 */
function isOrgOfMajorBranch(conn: Connection, majorOrg: any): boolean {
  return sameInstance(conn.instanceUrl, majorOrg.instanceUrl) || sameUsername(conn.getUsername(), majorOrg.targetUsername);
}

function sameUsername(username1?: string, username2?: string): boolean {
  return (username1 || '').trim() !== '' && (username1 || '').trim().toLowerCase() === (username2 || '').trim().toLowerCase();
}

function sameInstance(url1?: string, url2?: string): boolean {
  const normalize = (url?: string) => (url || '').trim().toLowerCase().replace(/\/+$/, '');
  return normalize(url1) !== '' && normalize(url1) === normalize(url2);
}

/**
 * The user of the org of a major branch authenticated on this computer, for a note: its
 * targetUsername first, then a user of its instance, null when none is (no question asked, the
 * note just names nobody on the Salesforce side).
 */
export function pickBranchOrgUsername(
  authorizations: { username: string; instanceUrl?: string }[],
  majorOrg: { targetUsername?: string; instanceUrl?: string }
): string | null {
  const sameUser = authorizations.find((auth) => sameUsername(auth.username, majorOrg.targetUsername));
  if (sameUser) {
    return sameUser.username;
  }
  return authorizations.find((auth) => sameInstance(auth.instanceUrl, majorOrg.instanceUrl))?.username || null;
}

/**
 * An authorization worth trying. isExpired is true, false or "unknown": most sandbox and production
 * authorizations say "unknown" (no expiry recorded), and a truthy check dropped every one of them.
 */
export function isUsableAuthorization(auth: { error?: string; isExpired?: boolean | string }): boolean {
  return !auth.error && auth.isExpired !== true;
}

/**
 * An org of a major branch already authenticated on this computer, if any: its username first,
 * then any user of its instance
 */
async function findAuthenticatedConnection(majorOrg: any): Promise<Connection | null> {
  const authorizations = (await AuthInfo.listAllAuthorizations()).filter(isUsableAuthorization);
  const sameUser = authorizations.find((auth) => sameUsername(auth.username, majorOrg.targetUsername));
  if (sameUser) {
    const org = await Org.create({ aliasOrUsername: sameUser.username });
    return org.getConnection();
  }
  const instanceUrl = majorOrg.instanceUrl;
  const matching = authorizations.filter((auth) => sameInstance(auth.instanceUrl, instanceUrl));
  if (matching.length === 0) {
    return null;
  }
  let username = matching[0].username;
  if (matching.length > 1 && !isCI) {
    username = await promptSelect(t('actionRunSelectOrgUser', { instanceUrl }), matching.map((auth) => ({
      title: auth.aliases && auth.aliases.length > 0 ? `${auth.username} (${auth.aliases.join(', ')})` : auth.username,
      value: auth.username,
    })));
  }
  const org = await Org.create({ aliasOrUsername: username });
  return org.getConnection();
}

function listLocalPullRequestActionFiles(): number[] {
  const actionsDir = path.join('scripts', 'actions');
  if (!fs.existsSync(actionsDir)) {
    return [];
  }
  return fs.readdirSync(actionsDir)
    .map((fileName: string) => /^\.sfdx-hardis\.(\d+)\.yml$/.exec(fileName))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => parseInt(match[1], 10))
    .sort((a, b) => b - a);
}

function parsePrNumber(value: string): number {
  const prNumber = parseInt((value || '').replace(/^#/, '').trim(), 10);
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    throw new SfError(t('actionRunInvalidPrNumber', { value }));
  }
  return prNumber;
}

async function isUsernameConnected(username: string): Promise<boolean> {
  const res = await execSfdxJson(`sf org display --target-org ${username}`, this, { fail: false, output: false });
  const status = res?.result?.connectedStatus || '';
  return res?.status === 0 && typeof status === 'string' && status.includes('Connected');
}

async function confirmOrWarn(message: string, headless: boolean): Promise<void> {
  if (headless) {
    uxLog("warning", this, c.yellow(message));
    return;
  }
  if (!(await promptConfirm(message))) {
    throw new SfError(t('actionRunCancelled'));
  }
}

async function promptConfirm(message: string): Promise<boolean> {
  const response = await prompts({ type: 'confirm', name: 'value', message: c.cyanBright(message), description: message, initial: true });
  return response.value === true;
}

async function promptSelect<T>(message: string, choices: { title: string; value: T }[]): Promise<T> {
  const response = await prompts({ type: 'select', name: 'value', message: c.cyanBright(message), description: message, choices });
  return response.value;
}

async function promptText(message: string): Promise<string> {
  const response = await prompts({ type: 'text', name: 'value', message: c.cyanBright(message), description: message, initial: '' });
  return response.value || '';
}
