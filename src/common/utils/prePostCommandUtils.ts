import { SfError } from '@salesforce/core';
import c from 'chalk';
import fs from './fsUtils.js';

import * as path from 'path';
import { getConfig, getEnvVar } from '../../config/index.js';
import { getCurrentGitBranch, uxLog } from './index.js';
import { CommonPullRequestInfo, GitProvider } from '../gitProvider/index.js';
import { loadDeploymentActionsState, checkActionInState, upsertActionInState, persistDeploymentActionsState, getJobInfoWithUrl, syncManualActionCheckboxes, getActionStateEntry, getStateEntriesForPr, DeploymentActionRef, buildIdenticalActionNote } from './deploymentActionsStateUtils.js';
// data import moved to DataAction class in actionsProvider
import { getPullRequestData, setPullRequestData } from './gitUtils.js';
import { ActionsProvider, PrePostCommand, buildActionOutput } from '../actionsProvider/actionsProvider.js';
import { getPromotionScopeDetails, getPullRequestScopedSfdxHardisConfig, getPullRequestScopeInfo, isSinglePullRequestScope, listAllPullRequestsForCurrentScope } from './pullRequestUtils.js';
import { buildAlreadyPromotedMarkdown, buildInheritedBehaviorsMarkdown, getCarriedBy, getPromotionBranchConfig, isPromotionPullRequest } from './promotionBranchUtils.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { t } from './i18n.js';
import { ActionWhen, DEV_SANDBOXES_BRANCH_NAME, buildActionTargetBranchCandidates, evaluateActionBranchFilter, getPrIdFromUserConfig, normalizeMovedFrom } from './actionUtils.js';
import { recordExecutedDeploymentActions } from './deploymentActionsRegistry.js';
import {
  ActionInterpolationError,
  ActionOutputsRegistry,
  ActionSkipReasons,
  InterpolationScope,
  interpolateActionFields,
} from './actionInterpolationUtils.js';
import { PipelineContext, buildPipelineContext, withActionContext } from './pipelineContextUtils.js';
import {
  IdenticalActionRun,
  buildIdenticalCopyResult,
  buildIdentityKeyFromProvider,
  findIdenticalActionRun,
  isIdenticalActionCopy,
  markIdentitySeen,
  recordSuccessfulActionRun,
  resetIdenticalActionRuns,
} from './deploymentActionIdentityUtils.js';

/**
 * Outputs produced by the actions of the current process, shared between the pre-deploy and the
 * post-deploy calls of executePrePostCommands so a post-deploy action can consume what a
 * pre-deploy action produced (capture before the deployment, restore after it).
 *
 * Lifetime is the process, like the deployment actions registry: smartDeploy resets it before
 * starting, so outputs never leak between runs.
 */
const actionOutputsRegistry: ActionOutputsRegistry = new Map();
const actionSkipReasons: ActionSkipReasons = new Map();

export function resetActionOutputsRegistry(): void {
  actionOutputsRegistry.clear();
  actionSkipReasons.clear();
  // Same lifetime: an action that ran in a previous run of the process never stands for one of this run
  resetIdenticalActionRuns();
}

/** Exposed for the deployment notification and the tests. */
export function getActionOutputs(actionId: string): Record<string, any> | undefined {
  return actionOutputsRegistry.get(actionId);
}

/**
 * Make the outputs an action persisted the day it ran available again, for an action retried
 * outside of a deployment job (sf hardis:project:action:run) that consumes them.
 */
export function replayActionOutputs(actionId: string, outputs: Record<string, any>): void {
  actionOutputsRegistry.set(actionId, outputs);
  actionSkipReasons.delete(actionId);
}

/**
 * Full kill switch of the deployment actions feature, for projects whose git provider cannot
 * handle the Pull Request scope processing (ex: thousands of historical Merge Requests, see
 * issue #2115). The env var wins over the config property so a single CI job can be unblocked
 * without committing a config change.
 */
export function isDeploymentActionsDisabled(branchConfig: any): boolean {
  const envVarValue = (getEnvVar('SFDX_HARDIS_DISABLE_DEPLOYMENT_ACTIONS') || '').toLowerCase();
  if (['true', '1'].includes(envVarValue)) {
    return true;
  }
  if (['false', '0'].includes(envVarValue)) {
    return false;
  }
  return branchConfig?.disableDeploymentActions === true;
}

export async function executePrePostCommands(property: 'commandsPreDeploy' | 'commandsPostDeploy', options: { success: boolean, checkOnly: boolean, extraCommands?: any[] }) {
  if (property === 'commandsPreDeploy') {
    pendingPreDeployManualActions.length = 0;
  }
  // The Pull Requests whose actions run are read from git: a checkout git refuses would skip them
  await GitProvider.assertGitRepositoryNotRefused();
  await executeDeploymentActionsOfPhase(property, options);
  // A validation job stops right after its pre-deployment actions while one of its pre-deployment
  // manual actions is not done: no point checking a deployment that cannot be merged yet
  if (property === 'commandsPreDeploy' && options.checkOnly) {
    await failOnPendingPreDeployManualActions();
  }
}

/**
 * A draft Pull Request: flagged so by its git provider (isDraft), or "draft" anywhere in its title
 */
export function isDraftPullRequest(pr: Pick<CommonPullRequestInfo, 'title' | 'isDraft'> | null | undefined): boolean {
  if (!pr) {
    return false;
  }
  return pr.isDraft === true || /draft/i.test(pr.title || '');
}

/**
 * Pre-deployment manual actions of the current validation job that nobody has marked as performed
 * in the target org branch yet, filled while the pre-deployment actions run
 */
const pendingPreDeployManualActions: PrePostCommand[] = [];

async function executeDeploymentActionsOfPhase(property: 'commandsPreDeploy' | 'commandsPostDeploy', options: { success: boolean, checkOnly: boolean, extraCommands?: any[] }) {
  const actionLabel = t(property === 'commandsPreDeploy' ? 'preDeploymentActionsLabel' : 'postDeploymentActionsLabel');
  const branchConfig = await getConfig('branch');
  const deployWhen: ActionWhen = property === 'commandsPreDeploy' ? 'pre-deploy' : 'post-deploy';
  const extraCommands = (options.extraCommands || []).filter(cmd => cmd.preOrPost === property);
  if (isDeploymentActionsDisabled(branchConfig)) {
    uxLog("action", this, c.cyan(`[DeploymentActions] ${t('deploymentActionsDisabledSkipping', { actionLabel })}`));
    // Internal actions added from Pull Request custom behaviors are skipped too: say it, so a
    // requested purge or post-deployment destructive change does not silently not happen.
    if (extraCommands.length > 0) {
      uxLog("warning", this, c.yellow(`[DeploymentActions] ${t('deploymentActionsDisabledExtraCommandsSkipped', { labels: extraCommands.map((cmd) => cmd.label).join(', ') })}`));
    }
    return;
  }
  uxLog("action", this, c.cyan(`[DeploymentActions] ${t('deploymentActionsListing', { actionLabel })}`));
  const commands: PrePostCommand[] = [...(branchConfig[property] || []), ...(extraCommands || [])];
  // When the lookup fails, the actions of the Pull Requests in scope are unknown:
  // not absent, unknown. Continuing would deploy and then report "no action
  // defined", so a data load or a post-deployment script silently never runs and
  // the job is still green. That is the worst outcome available, so it throws.
  try {
    await completeWithCommandsFromPullRequests(property, commands, options.checkOnly, options.success);
  } catch (e) {
    uxLog("error", this, c.red(`[DeploymentActions] ${t('deploymentActionsLookupFailed', { actionLabel, message: (e as Error).message })}`));
    uxLog("log", this, c.grey((e as Error).stack || ''));
    throw new SfError(
      `[DeploymentActions] ${t('deploymentActionsLookupFailed', { actionLabel, message: (e as Error).message })}`
    );
  }
  // An action moved to a fix Pull Request runs from there only
  const keptCommands = dropActionsMovedToAnotherPullRequest(commands);
  commands.splice(0, commands.length, ...keptCommands);
  for (const cmd of commands) {
    cmd.when ??= deployWhen;
  }
  // Explain in the Pull Request comment which Pull Requests the actions and test classes come from,
  // so nobody wonders why actions of other Pull Requests are listed on this one.
  await addDeploymentScopeMarkdownToPrData(options.checkOnly);
  if (commands.length === 0) {
    uxLog("action", this, c.cyan(`[DeploymentActions] ${t('deploymentActionsNoneDefined', { actionLabel })}`));
    uxLog("log", this, c.grey(t('noFoundToRun', { property })));
    // Even with no action to run, a manual action checkbox may have been ticked in a comment of
    // the current Pull Request or of a batch Pull Request of the scope (ex: the action
    // definition was removed after its checklist was posted): still scan those comments so the
    // tick is recorded and propagated. Feature Pull Requests of the scope are not scanned (see
    // buildPrNumbersToScan).
    if ((await GitProvider.getInstance()) !== null) {
      const prInfoForSync = await GitProvider.getPullRequestInfo({ useCache: true });
      const allPrsForSync = await buildPrNumbersToScan([prInfoForSync?.idNumber || 0]);
      if (allPrsForSync.length > 0) {
        try {
          await loadDeploymentActionsState(allPrsForSync);
          await syncManualActionCheckboxes(allPrsForSync);
        } catch (e) {
          uxLog("warning", this, c.yellow('[DeploymentActions] ' + t('deploymentActionsCheckboxSyncError', { message: (e as Error).message })));
        }
      }
    }
    return;
  }
  uxLog("action", this, c.cyan(
    `[DeploymentActions] ${t('deploymentActionsFoundToRun', { count: commands.length, actionLabel })}\n` +
    commands.map(c => `- ${c.label} (${c.type || 'command'})`).join('\n')
  ));

  // A failed metadata deployment must not be followed by deployment actions: the org is in an
  // unknown state, so actions are listed and reported, but never executed. Nothing is written to
  // the runOnlyOnceByOrg state, so they still run during the next successful deployment.
  // Returning here also leaves the deployment error as the error reported by the job.
  // (pre-deploy callers always pass success: true)
  if (options.success === false) {
    for (const cmd of commands) {
      cmd.result = { statusCode: "not-run", skippedCode: "deployment-failed", skippedReason: t('actionNotRunDeploymentFailed') };
    }
    uxLog("warning", this, c.yellow(
      `[DeploymentActions] ${t('deploymentActionsNotRunDeploymentFailed', { count: commands.length })}`
    ));
    manageResultMarkdownBody(property, commands);
    recordExecutedDeploymentActions(commands);
    return;
  }

  // Determine org branch name and current PR for state tracking
  const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
  const orgBranchName = prInfo?.targetBranch || await getCurrentGitBranch() || "unknown";
  const prIdFromConfig = !prInfo?.idNumber ? await getPrIdFromUserConfig() : null;
  const currentPrNumber = prInfo?.idNumber || (prIdFromConfig ? parseInt(prIdFromConfig, 10) : 0);

  // Branch filters (includeTargetBranches / excludeTargetBranches) are resolved against the branch
  // the deployment targets. listMajorOrgs() is only called when at least one action declares a
  // filter, so projects not using the feature keep the exact same behavior and job output.
  const hasBranchFilters = commands.some(
    (cmd) => (cmd.includeTargetBranches || []).length > 0 || (cmd.excludeTargetBranches || []).length > 0
  );
  const targetBranchCandidates = hasBranchFilters
    ? buildActionTargetBranchCandidates(orgBranchName, (await listMajorOrgs()).map((majorOrg: any) => majorOrg.branchName))
    : [orgBranchName];

  // Pre-load deployment actions state from all source PRs
  const hasGitProvider = (await GitProvider.getInstance()) !== null;
  if (hasGitProvider) {
    const sourcePrNumbers = collectSourcePrNumbers(commands, currentPrNumber);
    // State must be loaded for every scanned Pull Request, not only those owning actions:
    // otherwise a still-ticked checkbox of a scope-only Pull Request would be re-recorded as
    // newly done on every job, overwriting its original completion date and job link.
    const allPrNumbers = await buildPrNumbersToScan(sourcePrNumbers);
    await loadDeploymentActionsState(allPrNumbers);
    try {
      await syncManualActionCheckboxes(allPrNumbers);
    } catch (e) {
      uxLog("warning", this, c.yellow('[DeploymentActions] ' + t('deploymentActionsCheckboxSyncError', { message: (e as Error).message })));
    }
  }

  // Pipeline variables of the run, built once: every action reads the same values, and only the
  // per-action identity (actionId / actionLabel) changes from one action to the next.
  const pipelineContext: PipelineContext = await buildPipelineContext({
    checkOnly: options.checkOnly,
    when: deployWhen,
    targetBranch: orgBranchName,
  });

  const runContext: SingleActionRunContext = {
    checkOnly: options.checkOnly,
    deployWhen,
    orgBranchName,
    currentPrNumber,
    executionOrder: 0,
    targetBranchCandidates,
    hasGitProvider,
    pipelineContext,
  };
  for (let cmdIndex = 0; cmdIndex < commands.length; cmdIndex++) {
    const cmd = commands[cmdIndex];
    const outcome = await runSingleDeploymentAction(cmd, { ...runContext, executionOrder: cmdIndex });
    // A definition error (both branch filter lists, an unresolved reference, an invalid action) is
    // reported for every offending action and fails the job at the end, without stopping the others
    if (outcome === 'definition-error') {
      continue;
    }
    if (cmd.result?.statusCode === "failed" && cmd.allowFailure !== true) {
      uxLog("error", this, c.red(`[DeploymentActions] Action ${cmd.label} failed, stopping execution of further actions.`));
      const stoppedCommands = await markActionsStoppedByFailure(commands, cmdIndex, runContext);
      // Only post-deploy actions can be retried: a pre-deploy failure stops the whole deployment,
      // and the next one runs them all again
      if (hasGitProvider && !options.checkOnly && deployWhen === 'post-deploy') {
        await recordStoppedActions(cmd, stoppedCommands, {
          orgBranchName,
          currentPrNumber,
          deployWhen,
          // The copies of identical actions left the stopped list: each action keeps its own position
          executionOrderOf: (stoppedCmd) => commands.indexOf(stoppedCmd),
          targetBranchCandidates,
        });
      }
      break;
    }
  }
  manageResultMarkdownBody(property, commands, orgBranchName);
  // A pre-deployment manual action still waiting in the target org: it has to be performed before
  // the merge. An action already marked as done there was skipped above (runOnlyOnceByOrg)
  if (options.checkOnly && deployWhen === 'pre-deploy') {
    for (const cmd of commands) {
      if (cmd.type === 'manual' && cmd.result?.statusCode === 'manual') {
        pendingPreDeployManualActions.push(cmd);
      }
    }
  }
  // Expose the executed actions so the post-deployment notification can report them
  recordExecutedDeploymentActions(commands);
  // Check commands results
  const failedCommands = commands.filter(c => c.result?.statusCode === "failed");
  if (failedCommands.length > 0) {
    uxLog("error", this, c.red(`[DeploymentActions] ${failedCommands.length} action(s) failed during ${actionLabel}:`));
    for (const failedCmd of failedCommands) {
      uxLog("error", this, c.red(`- ${failedCmd.label}${failedCmd.allowFailure === true ? ' (allowed to fail)' : ''}`));
    }
    // throw error if failed and allowFailure is not set
    const failedAndNotAllowFailure = failedCommands.filter(c => c.allowFailure !== true);
    if (failedAndNotAllowFailure.length > 0) {
      let prData = getPullRequestData()
      prData = Object.assign(prData, {
        title: "❌ Error: Failed deployment actions",
        messageKey: prData.messageKey ?? 'deployment',
        // Mark the comment as failed even when the metadata deployment succeeded,
        // so it displays a failure banner instead of the success one
        status: 'invalid',
      });
      setPullRequestData(prData);
      await GitProvider.managePostPullRequestComment(options.checkOnly);
      throw new SfError(`One or more ${actionLabel} have failed. See logs for more details.`);
    }
  }
}

export interface SingleActionRunContext {
  checkOnly: boolean;
  deployWhen: ActionWhen;
  orgBranchName: string;
  currentPrNumber: number;
  executionOrder: number;
  targetBranchCandidates: string[];
  hasGitProvider: boolean;
  pipelineContext: PipelineContext;
  // Pull Request carrying the action when cmd.pullRequest is not set (sf hardis:project:action:run
  // reads the definition from the Pull Request files): its state says whether it already ran
  actionPrNumber?: number;
  // Written in the state entry when the action runs outside of a deployment job
  // (sf hardis:project:action:run): who ran it, and from where.
  note?: string;
  // The run is recorded outside of the Pull Request comment (a developer org without a Pull Request
  // yet): the caller checks runOnlyOnceByOrg against that record itself.
  skipRunOnlyOnceCheck?: boolean;
}

/**
 * Run one deployment action and record its outcome: branch filter, interpolation, validity
 * checks, context and runOnlyOnceByOrg checks, execution, then the Deployment Actions Pull Request
 * comment state. Used by the deployment jobs (one call per action) and by
 * sf hardis:project:action:run, so a retried action goes through exactly the same steps.
 * The outcome is in cmd.result.
 */
export async function runSingleDeploymentAction(cmd: PrePostCommand, ctx: SingleActionRunContext): Promise<'done' | 'definition-error'> {
  normalizeMovedFrom(cmd);
  // An action defining both branch filter lists is a definition error, not a skip: report every
  // offending action of the job, and let the failure check after the loop fail the deployment.
  const branchFilterVerdict = evaluateActionBranchFilter(cmd, ctx.targetBranchCandidates);
  if (branchFilterVerdict.invalid) {
    cmd.result = { statusCode: "failed", skippedReason: branchFilterVerdict.reason };
    uxLog("error", this, c.red(`[DeploymentActions] Action ${cmd.label} is not valid: ${branchFilterVerdict.reason}`));
    recordActionProducedNothing(cmd, branchFilterVerdict.reason);
    return 'definition-error';
  }
  cmd.pipelineContext = withActionContext(ctx.pipelineContext, cmd);
  // Resolve ${{ actions.<id>.outputs.<name> }} and ${{ pipeline.<name> }} before anything reads
  // the action fields, so validity checks and the run itself see the resolved values.
  const interpolationScope: InterpolationScope = {
    outputs: actionOutputsRegistry,
    skipReasons: actionSkipReasons,
    pipeline: cmd.pipelineContext,
  };
  try {
    interpolateActionFields(cmd, interpolationScope);
  } catch (e) {
    if (!(e instanceof ActionInterpolationError)) {
      throw e;
    }
    // A reference that cannot be resolved fails the consuming action: running it with a hole in
    // its arguments (an empty record id, an empty channel) is worse than stopping here.
    cmd.result = {
      statusCode: "failed",
      skippedCode: "unresolved-reference",
      skippedReason: e.message,
    };
    uxLog("error", this, c.red(`[DeploymentActions] Action ${cmd.label}: ${e.message}`));
    recordActionProducedNothing(cmd, e.message);
    return 'definition-error';
  }
  const actionsInstance = await ActionsProvider.buildActionInstance(cmd);
  if (!actionsInstance) {
    // buildActionInstance already set cmd.result and logged the unknown type
    recordActionProducedNothing(cmd, cmd.result?.skippedReason || t('actionNotRunUnknownType'));
    return 'definition-error';
  }
  const actionsIssues = await actionsInstance.checkValidityIssues(cmd);
  if (actionsIssues) {
    cmd.result = actionsIssues;
    uxLog("error", this, c.red(`[DeploymentActions] Action ${cmd.label} is not valid: ${actionsIssues.skippedReason}`));
    recordActionProducedNothing(cmd, actionsIssues.skippedReason);
    return 'definition-error';
  }
  // Determine whether the action should be skipped; use a flag instead of early `return` so
  // that skipped outcomes are still recorded in the "Deployment Actions" PR comment below.
  let skipAction = false;

  // Skip if we are in another context than the requested one
  const cmdContext = getEffectiveActionContext(cmd);
  if (cmdContext === "check-deployment-only" && ctx.checkOnly === false) {
    uxLog("action", this, c.grey(`[DeploymentActions] Skipping ${describeActionWithPr(cmd)}: validation-only action (context check-deployment-only), and this is the deployment job`));
    cmd.result = {
      statusCode: "skipped",
      skippedCode: "context-validation-only",
      skippedReason: "Action context is check-deployment-only but this is the deployment job"
    };
    skipAction = true;
  } else if (cmdContext === "process-deployment-only" && ctx.checkOnly === true) {
    uxLog("action", this, c.grey(`[DeploymentActions] Skipping ${describeActionWithPr(cmd)}: deployment-only action (context process-deployment-only), and this is the validation job`));
    cmd.result = {
      statusCode: "skipped",
      skippedCode: "context-deployment-only",
      skippedReason: "Action context is process-deployment-only but this is the validation job"
    };
    skipAction = true;
  } else if (branchFilterVerdict.run === false) {
    // Skipped before the runOnlyOnceByOrg check below, so the action is never recorded as run in
    // the org and still runs on a later deployment targeting a branch it does apply to.
    uxLog("action", this, c.grey(`[DeploymentActions] Skipping ${describeActionWithPr(cmd)}: ${branchFilterVerdict.reason}`));
    cmd.result = {
      statusCode: "skipped",
      skippedCode: "branch-not-targeted",
      skippedReason: branchFilterVerdict.reason
    };
    skipAction = true;
  }
  // The action was moved to a fix Pull Request, which already ran it in this org: the copy left in
  // this Pull Request (a description cannot be edited after the merge) must not run again, even
  // when its job is re-run without the fix Pull Request in its scope
  if (!skipAction) {
    // In any org branch: once moved, the fix Pull Request carries the action, and the original
    // definition must not run in an org the fix has not reached yet either
    const ownerPr = cmd.pullRequest?.idNumber || ctx.currentPrNumber;
    const movedEntry = ownerPr > 0 ? getStateEntriesForPr(ownerPr).find((e) => e.actionId === cmd.id && e.status === 'moved') || null : null;
    if (movedEntry?.status === 'moved') {
      const reason = t('actionSkippedMovedTo', { pr: movedEntry.movedTo || '?' });
      uxLog("action", this, c.grey(`[DeploymentActions] Skipping ${describeActionWithPr(cmd)}: ${reason}`));
      cmd.result = { statusCode: "skipped", skippedReason: reason };
      recordActionProducedNothing(cmd, reason);
      return 'done';
    }
  }
  if (!skipAction) {
    // true by default, except for action types that must run at every deployment
    const runOnlyOnceByOrg = actionsInstance.supportsRunOnlyOnceByOrg() && cmd.runOnlyOnceByOrg !== false && ctx.skipRunOnlyOnceCheck !== true;
    if (runOnlyOnceByOrg) {
      const gitProviderInst = await GitProvider.getInstance();
      if (!gitProviderInst) {
        uxLog("warning", this, c.yellow(
          `[DeploymentActions] Skipping ${cmd.label}: runOnlyOnceByOrg requires a git provider to track state. Configure GITHUB_TOKEN / CI_SFDX_HARDIS_GITLAB_TOKEN / SYSTEM_ACCESSTOKEN / CI_SFDX_HARDIS_BITBUCKET_TOKEN.`
        ));
        cmd.result = { statusCode: "skipped", skippedReason: "runOnlyOnceByOrg: no git provider configured for state tracking" };
        skipAction = true;
      } else {
        const existingEntry = checkActionInState(cmd.id, ctx.orgBranchName, getActionOwnerPrs(cmd, ctx.actionPrNumber));
        if (existingEntry) {
          uxLog("action", this, c.grey(
            `[DeploymentActions] Skipping ${describeActionWithPr(cmd)}: already run in ${ctx.orgBranchName} on ${existingEntry.date}`
          ));
          cmd.result = {
            statusCode: "skipped",
            skippedCode: "already-run-in-org",
            skippedReason: `runOnlyOnceByOrg: already run in org (${ctx.orgBranchName}) on ${existingEntry.date}`
          };
          // The action is skipped but its outputs were persisted the day it ran: replay them, so
          // a later action consuming ${{ actions.<id>.outputs.<name> }} keeps resolving instead
          // of failing on every deployment after the first.
          if (existingEntry.outputs && Object.keys(existingEntry.outputs).length > 0) {
            actionOutputsRegistry.set(cmd.id, existingEntry.outputs);
            cmd.result.outputs = existingEntry.outputs;
            uxLog("log", this, c.grey(
              `[DeploymentActions] ${t('actionOutputsReplayed', { label: cmd.label, names: Object.keys(existingEntry.outputs).join(', ') })}`
            ));
          } else {
            recordActionProducedNothing(cmd, cmd.result.skippedReason);
          }
          // If the action label changed, update it in the PR comment.
          if (existingEntry.actionLabel !== cmd.label) {
            const sourcePr = cmd.pullRequest?.idNumber || ctx.currentPrNumber;
            upsertActionInState({ ...existingEntry, actionLabel: cmd.label }, sourcePr);
            await persistDeploymentActionsState();
          }
          // Preserve the existing success entry in the PR comment - do not overwrite it with skipped.
          return 'done';
        }
      }
    }
  }
  // An identical action (same type, phase, user and parameters) of another source already succeeded
  // in this run: its work is in the org, so this one is recorded as done by it instead of running a
  // second time. An action written twice in one Pull Request, or twice in the config, runs twice.
  // The key is read before the run: a command action appends --target-org to its command.
  let identityKey: string | null = null;
  if (!skipAction) {
    identityKey = buildIdentityKeyFromProvider(actionsInstance, cmd, ctx.deployWhen);
    const repeatedInSource = markIdentitySeen(identityKey, getActionSourcePr(cmd, ctx));
    const identicalRun = repeatedInSource ? null : findIdenticalActionRun(identityKey);
    if (identicalRun) {
      applyIdenticalCopy(cmd, identicalRun);
      skipAction = true;
    }
  }
  if (!skipAction) {
    // Run command
    uxLog("action", this, c.cyan(`[DeploymentActions] Running action ${describeActionWithPr(cmd)}`));
    await executeAction(cmd);
    // Display the failure details right where they happen, so the reason is next to the failure
    // in the job log instead of being buried in the PR comment (or lost entirely).
    if (cmd.result?.statusCode === "failed") {
      logActionFailureDetails(cmd);
    }
    // The identical actions that come later in this run are done by this one
    if (cmd.result?.statusCode === "success") {
      recordSuccessfulActionRun(identityKey, buildIdenticalActionRun(cmd, ctx));
    }
  }
  // Make the outcome of this action available to the ones that follow: either its outputs, or
  // the reason it produced none so an unresolved reference can say what happened.
  registerActionOutcome(cmd);
  // Track executed/manual/skipped actions in the source PR's "Deployment Actions" comment.
  // "Already ran" skips (runOnlyOnceByOrg + existing success entry) are excluded via the
  // early `return` above to avoid overwriting the existing success record.
  await recordActionOutcomeInState(cmd, ctx);
  return 'done';
}

/**
 * Mark the actions after a blocking failure. One whose identical action already succeeded in this
 * run is recorded as done like any copy: it would have been skipped anyway, and its work is in the
 * org. The others are not run, with the failure as reason, so the Pull Request comment does not show
 * a bare "not run" without saying why. Returns the stopped ones, which can be retried.
 * Exported for unit tests.
 */
export async function markActionsStoppedByFailure(commands: PrePostCommand[], failedIndex: number, ctx: SingleActionRunContext): Promise<PrePostCommand[]> {
  const failedCmd = commands[failedIndex];
  const stoppedCommands: PrePostCommand[] = [];
  for (let index = failedIndex + 1; index < commands.length; index++) {
    const cmd = commands[index];
    if (cmd.result) {
      continue;
    }
    if (await recordIdenticalCopyOfStoppedAction(cmd, { ...ctx, executionOrder: index })) {
      continue;
    }
    cmd.result = {
      statusCode: "not-run",
      skippedCode: "stopped-by-failure",
      stoppedByLabel: failedCmd.label,
      skippedReason: `Not run because a previous action failed (${failedCmd.label})`,
    };
    stoppedCommands.push(cmd);
  }
  return stoppedCommands;
}

/**
 * Status of an action as written in the state stores (the Deployment Actions comment, the local file
 * of a draft, the Backpromotes comment). A copy of an identical action of the same run is done there:
 * the work it describes is in the org.
 */
export function getRecordedActionStatus(cmd: PrePostCommand): 'success' | 'failed' | 'warning' | 'manual' | 'skipped' {
  return isIdenticalActionCopy(cmd) ? 'success' : getReportedActionStatus(cmd);
}

/**
 * Context an action really runs in. A run-batch action changes the data of the org: it is a
 * deployment-only action, whatever its context holds.
 */
export function getEffectiveActionContext(cmd: PrePostCommand): PrePostCommand['context'] {
  return cmd.type === "run-batch" ? "process-deployment-only" : cmd.context || "all";
}

/**
 * Remove the actions that were moved to a fix Pull Request from the Pull Request they come from:
 * the fix Pull Request carries the corrected definition under the same id, and the original one
 * (still in a merged YAML file or Pull Request description) must not run again.
 * Exported for unit tests.
 */
export function dropActionsMovedToAnotherPullRequest(commands: PrePostCommand[]): PrePostCommand[] {
  commands.forEach(normalizeMovedFrom);
  const moved = commands.filter((cmd) => cmd.movedFrom && cmd.movedFrom > 0);
  if (moved.length === 0) {
    return commands;
  }
  return commands.filter((cmd) => {
    const replacement = moved.find((m) => m !== cmd && m.id === cmd.id && cmd.pullRequest?.idNumber === m.movedFrom);
    if (replacement) {
      uxLog("log", this, c.grey(`[DeploymentActions] ${t('actionMovedSuperseded', { label: cmd.label, oldPr: replacement.movedFrom, newPr: replacement.pullRequest?.idStr || '?' })}`));
      return false;
    }
    return true;
  });
}

/**
 * Publish what an action produced to the outputs registry, so later actions can consume it.
 * Only a successful action, or the copy of one, publishes outputs; anything else records why there
 * are none.
 */
function registerActionOutcome(cmd: PrePostCommand): void {
  const outputs = cmd.result?.outputs;
  // A copy feeds the references to its own id with what its identical action produced
  const produced = cmd.result?.statusCode === 'success' || isIdenticalActionCopy(cmd);
  if (produced && outputs && Object.keys(outputs).length > 0) {
    actionOutputsRegistry.set(cmd.id, outputs);
    actionSkipReasons.delete(cmd.id);
    return;
  }
  if (produced) {
    // Succeeded without declaring outputs: referencing one is a configuration mistake, not a skip
    return;
  }
  recordActionProducedNothing(cmd, cmd.result?.skippedReason);
}

/**
 * Remember that an action produced no outputs and why, so an action referencing one of its
 * outputs fails with the actual cause ("skipped: branch not targeted") instead of a bare
 * "unknown action".
 */
function recordActionProducedNothing(cmd: PrePostCommand, reason?: string): void {
  actionSkipReasons.set(cmd.id, reason || cmd.result?.statusCode || 'not run');
}

/**
 * Pull Requests whose state says whether an action already ran in an org: the one carrying it, and
 * the one it was moved from. None for an action of the branch or project config, whose runs are
 * recorded on whichever Pull Request each job deployed: every loaded Pull Request is searched.
 */
function getActionOwnerPrs(cmd: PrePostCommand, actionPrNumber?: number): number[] {
  const ownerPr = cmd.pullRequest?.idNumber || actionPrNumber || 0;
  if (ownerPr <= 0) {
    return [];
  }
  const movedFrom = Number(cmd.movedFrom);
  return Number.isInteger(movedFrom) && movedFrom > 0 && movedFrom !== ownerPr ? [ownerPr, movedFrom] : [ownerPr];
}

/** The Pull Request an action comes from, 0 for the branch or project config: its source for identical actions */
function getActionSourcePr(cmd: PrePostCommand, ctx: SingleActionRunContext): number {
  return cmd.pullRequest?.idNumber || ctx.actionPrNumber || 0;
}

function applyIdenticalCopy(cmd: PrePostCommand, identicalRun: IdenticalActionRun): void {
  cmd.result = buildIdenticalCopyResult(identicalRun);
  uxLog("action", this, c.grey(`[DeploymentActions] ${t('deploymentActionSkipped', { label: describeActionWithPr(cmd), reason: cmd.result.skippedReason })}`));
}

/** What a successful action leaves for the identical actions that come after it in the run */
function buildIdenticalActionRun(cmd: PrePostCommand, ctx: SingleActionRunContext): IdenticalActionRun {
  return {
    ref: {
      actionId: cmd.id,
      label: cmd.label,
      pr: getActionSourcePr(cmd, ctx),
      prUrl: cmd.pullRequest?.webUrl,
    },
    outputs: cmd.result?.outputs,
    outputsForDisplay: cmd.result?.outputsForDisplay,
  };
}

/**
 * Write the outcome of an action in the "Deployment Actions" comment of its source Pull Request.
 * Actions are written to their source PR only - not to the current PR for actions from other PRs.
 * A copy of an identical action is written as done, with a note naming the action that did it.
 */
async function recordActionOutcomeInState(cmd: PrePostCommand, ctx: SingleActionRunContext): Promise<void> {
  const sourcePrNumber = cmd.pullRequest?.idNumber || ctx.currentPrNumber;
  const trackableStatuses = ['success', 'failed', 'manual', 'skipped'];
  if (!ctx.hasGitProvider || sourcePrNumber <= 0 || !cmd.result?.statusCode || !trackableStatuses.includes(cmd.result.statusCode)) {
    return;
  }
  const identicalCopy = isIdenticalActionCopy(cmd);
  const { jobId, jobUrl } = await getJobInfoWithUrl();
  upsertActionInState({
    actionId: cmd.id,
    actionLabel: cmd.label,
    orgBranch: ctx.orgBranchName,
    when: ctx.deployWhen,
    executionOrder: ctx.executionOrder,
    status: getRecordedActionStatus(cmd),
    jobId,
    jobUrl,
    date: new Date().toISOString(),
    output: cmd.result.output,
    // Persisted so a runOnlyOnceByOrg action can replay them when it is skipped later.
    // The masked copy, because this is written into a Pull Request comment.
    outputs: cmd.result.outputsForDisplay,
    note: identicalCopy && cmd.result.identicalTo ? buildIdenticalActionNote(cmd.result.identicalTo) : ctx.note,
  }, sourcePrNumber);
  // The action was moved from another Pull Request to fix its definition: once the copy has run in
  // this org (or an identical action did its work), the original row points at it instead of
  // staying failed forever.
  if (cmd.movedFrom && cmd.movedFrom > 0 && cmd.movedFrom !== sourcePrNumber && (cmd.result.statusCode !== 'skipped' || identicalCopy) && ctx.orgBranchName !== DEV_SANDBOXES_BRANCH_NAME) {
    upsertActionInState({
      actionId: cmd.id,
      actionLabel: cmd.label,
      orgBranch: ctx.orgBranchName,
      when: ctx.deployWhen,
      executionOrder: ctx.executionOrder,
      status: 'moved',
      jobId,
      jobUrl,
      date: new Date().toISOString(),
      movedTo: sourcePrNumber,
      note: `Moved to #${sourcePrNumber}`,
    }, cmd.movedFrom);
  }
  await persistDeploymentActionsState();
}

/**
 * A stopped action whose identical action of another source already succeeded in this run is a
 * copy, when this job would have run it. Its raw fields are compared: one still holding a ${{ }}
 * reference stays stopped, as its real values may depend on the actions the failure prevented.
 */
async function recordIdenticalCopyOfStoppedAction(cmd: PrePostCommand, ctx: SingleActionRunContext): Promise<boolean> {
  normalizeMovedFrom(cmd);
  if (cmd.type === 'manual') {
    return false;
  }
  const provider = await ActionsProvider.buildActionInstance(cmd, { quiet: true });
  if (!provider || !wouldRunInThisJob(cmd, ctx, provider)) {
    return false;
  }
  const identityKey = buildIdentityKeyFromProvider(provider, cmd, ctx.deployWhen, { refusePlaceholders: true });
  if (markIdentitySeen(identityKey, getActionSourcePr(cmd, ctx))) {
    return false;
  }
  const identicalRun = findIdenticalActionRun(identityKey);
  if (!identicalRun) {
    return false;
  }
  applyIdenticalCopy(cmd, identicalRun);
  registerActionOutcome(cmd);
  await recordActionOutcomeInState(cmd, ctx);
  return true;
}

/**
 * Whether this job would have run an action it did not reach, with the decisions of
 * runSingleDeploymentAction: its context and its branch filter let it run, it was not moved to a fix
 * Pull Request, and runOnlyOnceByOrg does not skip it (done in the org already, or no git provider
 * to track it). Its validity is not checked again: an action identical to one that succeeded, with
 * the same parameters and the same user, is valid.
 */
function wouldRunInThisJob(cmd: PrePostCommand, ctx: SingleActionRunContext, provider: ActionsProvider): boolean {
  const context = getEffectiveActionContext(cmd);
  if ((context === 'check-deployment-only' && !ctx.checkOnly) || (context === 'process-deployment-only' && ctx.checkOnly)) {
    return false;
  }
  const verdict = evaluateActionBranchFilter(cmd, ctx.targetBranchCandidates);
  if (verdict.invalid || verdict.run === false) {
    return false;
  }
  const ownerPr = cmd.pullRequest?.idNumber || ctx.currentPrNumber;
  if (ownerPr > 0 && getStateEntriesForPr(ownerPr).some((entry) => entry.actionId === cmd.id && entry.status === 'moved')) {
    return false;
  }
  const runOnlyOnceByOrg = provider.supportsRunOnlyOnceByOrg() && cmd.runOnlyOnceByOrg !== false && ctx.skipRunOnlyOnceCheck !== true;
  if (!runOnlyOnceByOrg) {
    return true;
  }
  return ctx.hasGitProvider && !checkActionInState(cmd.id, ctx.orgBranchName, getActionOwnerPrs(cmd, ctx.actionPrNumber));
}

/**
 * Record the actions a failure stopped as 'not-run' in their source Pull Request comments, linked to
 * the failed action, so they can be retried (sf hardis:project:action:run) or closed by hand.
 * Only the actions that would really have run here are recorded: not the validation-only ones,
 * not those targeting another branch, not those already performed in this org.
 */
async function recordStoppedActions(
  failedCmd: PrePostCommand,
  stoppedCommands: PrePostCommand[],
  ctx: { orgBranchName: string; currentPrNumber: number; deployWhen: ActionWhen; executionOrderOf: (cmd: PrePostCommand) => number; targetBranchCandidates: string[] }
): Promise<void> {
  const failedPr = failedCmd.pullRequest?.idNumber || ctx.currentPrNumber;
  if (failedPr <= 0) {
    return;
  }
  const { jobId, jobUrl } = await getJobInfoWithUrl();
  const stoppedRefs: DeploymentActionRef[] = [];
  for (const cmd of stoppedCommands) {
    const sourcePr = cmd.pullRequest?.idNumber || ctx.currentPrNumber;
    if (sourcePr <= 0 || getEffectiveActionContext(cmd) === 'check-deployment-only') {
      continue;
    }
    const verdict = evaluateActionBranchFilter(cmd, ctx.targetBranchCandidates);
    if (verdict.invalid || verdict.run === false || checkActionInState(cmd.id, ctx.orgBranchName, getActionOwnerPrs(cmd))) {
      continue;
    }
    stoppedRefs.push({ pr: sourcePr, actionId: cmd.id });
    upsertActionInState({
      actionId: cmd.id,
      actionLabel: cmd.label,
      orgBranch: ctx.orgBranchName,
      when: cmd.when || ctx.deployWhen,
      executionOrder: ctx.executionOrderOf(cmd),
      status: 'not-run',
      jobId,
      jobUrl,
      date: new Date().toISOString(),
      output: cmd.result?.skippedReason,
      blockedBy: { pr: failedPr, actionId: failedCmd.id },
    }, sourcePr);
  }
  if (stoppedRefs.length === 0) {
    return;
  }
  // An action failing before it runs (invalid definition, unresolved reference) has no entry yet
  const failedEntry = getActionStateEntry(failedPr, failedCmd.id, ctx.orgBranchName) || {
    actionId: failedCmd.id,
    actionLabel: failedCmd.label,
    orgBranch: ctx.orgBranchName,
    when: failedCmd.when || ctx.deployWhen,
    executionOrder: ctx.executionOrderOf(failedCmd),
    status: 'failed' as const,
    jobId,
    jobUrl,
    date: new Date().toISOString(),
    output: failedCmd.result?.output || failedCmd.result?.skippedReason,
  };
  upsertActionInState({ ...failedEntry, stoppedActions: stoppedRefs }, failedPr);
  await persistDeploymentActionsState();
}

/**
 * Console label of an action, with the Pull Request that defines it when there is one,
 * so the job log carries the same attribution as the Pull Request comment.
 */
function describeActionWithPr(cmd: PrePostCommand): string {
  return cmd.pullRequest?.idStr ? `${cmd.label} (from PR #${cmd.pullRequest.idStr})` : cmd.label;
}

/**
 * Log why an action failed. The details live in the action result output, which is the only
 * place carrying them for commands ending with --json: execCommand returns those without
 * stdout/stderr and prints nothing, so without this the job log showed a bare failure.
 */
function logActionFailureDetails(cmd: PrePostCommand): void {
  const details = (cmd.result?.output || cmd.result?.skippedReason || '').trim();
  if (details) {
    uxLog("error", this, c.red(`[DeploymentActions] Action ${cmd.label} failed with the following output:`));
    uxLog("other", this, c.grey(details));
  } else {
    uxLog("warning", this, c.yellow(`[DeploymentActions] ${t('actionNoOutputAvailable', { label: cmd.label })}`));
  }
}

/**
 * What the Pull Requests of the scope actually carry, so the scope paragraph only names the
 * subjects that exist. Announcing "Deployment actions and Apex test classes" on a Pull Request
 * that carries neither, or only one of them, describes content the reader will not find.
 *
 * Both phases are inspected, not only the one being executed: the paragraph is written once per
 * job and must describe the whole Pull Request, whichever phase happens to run first.
 */
export function buildDeploymentScopeSubjects(prConfigs: (object | null)[], testClassesEnabled: boolean): string[] {
  const hasArrayContent = (config: any, property: string): boolean =>
    Array.isArray(config?.[property]) && config[property].length > 0;
  const hasActions = prConfigs.some(
    (config) => hasArrayContent(config, 'commandsPreDeploy') || hasArrayContent(config, 'commandsPostDeploy')
  );
  const hasTestClasses = testClassesEnabled && prConfigs.some((config) => hasArrayContent(config, 'deploymentApexTestClasses'));
  const subjects: string[] = [];
  if (hasActions) {
    subjects.push('Deployment actions');
  }
  if (hasTestClasses) {
    subjects.push('Apex test classes');
  }
  return subjects;
}

/**
 * Store in the Pull Request data the markdown paragraph explaining the Pull Request scope used to
 * collect deployment actions and Apex test classes. Set once per process (pre-deploy usually wins).
 */
async function addDeploymentScopeMarkdownToPrData(checkOnly: boolean): Promise<void> {
  try {
    const existingPrData = getPullRequestData();
    if (existingPrData.deploymentScopeMarkdownBody) {
      return;
    }
    const scopeInfo = getPullRequestScopeInfo();
    if (!scopeInfo || scopeInfo.pullRequests.length === 0) {
      return;
    }
    // Listed one per line in a folded section of the comment, never inline: a promotion window can
    // carry hundreds of Pull Requests
    setPullRequestData({
      pullRequestsInScope: scopeInfo.pullRequests.map((pr) => ({
        idStr: pr.idStr,
        idNumber: pr.idNumber,
        title: pr.title,
        webUrl: pr.webUrl,
        authorName: pr.authorName,
      })),
    });
    // Only name what the Pull Requests of the scope really carry
    const prConfigs = await Promise.all(
      scopeInfo.pullRequests.map((pr) => getPullRequestScopedSfdxHardisConfig(pr).catch(() => null))
    );
    const projectConfig = await getConfig('branch');
    const subjects = buildDeploymentScopeSubjects(prConfigs, projectConfig?.enableDeploymentApexTestClasses === true);
    const subjectsLabel = subjects.join(' and ');
    const paragraphs: string[] = [];
    const promotionDetails = getPromotionScopeDetails();
    if (scopeInfo.kind === 'promotion' || scopeInfo.kind === 'promotion-check') {
      // Promotion branch: the stories come from the Pull Request description, say so in both jobs
      const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
      const carried = scopeInfo.pullRequests.filter((pr) => pr.idNumber !== prInfo?.idNumber);
      const branchLabel = prInfo?.sourceBranch ? `\`${prInfo.sourceBranch}\`` : 'this promotion branch';
      if (carried.length === 0) {
        paragraphs.push(`ℹ️ ${branchLabel} is a promotion branch but none of the Pull Requests it declares (\`promotionPullRequests\`) could be used, so only its own deployment actions and Apex test classes ${checkOnly ? 'are' : 'were'} processed.`);
      } else {
        const subjectsSentence = subjects.length > 0 ? `${subjectsLabel} ${checkOnly ? 'are' : 'were'} collected from them` : `They carry no deployment action and no Apex test class`;
        paragraphs.push(`ℹ️ ${branchLabel} is a promotion branch carrying ${carried.length} Pull Request(s) declared in its description. ${subjectsSentence}${subjects.includes('Deployment actions') ? ', and each action keeps its tracked state on its own Pull Request' : ''}.`);
      }
      const inheritedMarkdown = buildInheritedBehaviorsMarkdown(promotionDetails.inheritedBehaviors, scopeInfo.pullRequests);
      if (inheritedMarkdown) {
        paragraphs.push(inheritedMarkdown);
      }
      setPullRequestData({ deploymentScopeMarkdownBody: paragraphs.join('\n\n') });
      return;
    }
    // Stories brought by a promotion Pull Request of the window: say where they come from
    const carriedByPromotion = scopeInfo.pullRequests.filter((pr) => getCarriedBy(pr) !== null);
    if (carriedByPromotion.length > 0) {
      // Name the promotion Pull Requests, not every story they carry
      const promotions = new Map<string, string>();
      for (const pr of carriedByPromotion) {
        const carriedBy = getCarriedBy(pr)!;
        const promotionLink = carriedBy.webUrl ? `[#${carriedBy.idStr}](${carriedBy.webUrl})` : `#${carriedBy.idStr}`;
        promotions.set(carriedBy.idStr, `\`${carriedBy.sourceBranch}\` ${promotionLink}`);
      }
      paragraphs.push(`ℹ️ ${carriedByPromotion.length} Pull Request(s) of this window were carried by ${promotions.size === 1 ? 'the promotion branch' : 'the promotion branches'} ${[...promotions.values()].join(', ')}.`);
    }
    const alreadyPromotedMarkdown = buildAlreadyPromotedMarkdown(promotionDetails.alreadyPromoted);
    if (alreadyPromotedMarkdown) {
      paragraphs.push(alreadyPromotedMarkdown);
    }
    if (checkOnly) {
      if (subjects.length > 0) {
        let collectedSentence = `ℹ️ ${subjectsLabel} are collected from the content of this Pull Request`;
        if (scopeInfo.pullRequests.length > 1) {
          collectedSentence += ` (${scopeInfo.pullRequests.length} Pull Requests)`;
        }
        paragraphs.push(collectedSentence + `.`);
      }
      // On a merge from a major or retrofit branch, the post-merge deployment job replays the whole
      // promotion window: without this note, the check comment ("no actions") and the merge job
      // (actions from other Pull Requests) look contradictory. It is about the actions of the OTHER
      // Pull Requests, so it stays relevant even when this one carries none.
      const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
      if (prInfo) {
        const majorOrgs = await listMajorOrgs();
        if (!isSinglePullRequestScope(prInfo.sourceBranch, majorOrgs.map((o) => o.branchName))) {
          paragraphs.push(`ℹ️ After the merge, the deployment job will also process the still-pending actions of the other Pull Requests of the \`${prInfo.targetBranch}\` promotion window, so it can process more actions than listed here.`);
        }
      }
    } else {
      // A feature Pull Request merge processes only its own actions: nothing to explain
      if (scopeInfo.kind === 'single-pr' || subjects.length === 0) {
        if (paragraphs.length > 0) {
          setPullRequestData({ deploymentScopeMarkdownBody: paragraphs.join('\n\n') });
        }
        return;
      }
      // Tense-neutral wording: this paragraph is also posted when the metadata deployment failed,
      // in which case the actions were collected but deliberately not run (see fix #2053)
      let collectedSentence = `ℹ️ ${subjectsLabel} were collected from ${scopeInfo.pullRequests.length} Pull Request(s).`;
      if (subjects.includes('Deployment actions')) {
        collectedSentence += ` Each action keeps its tracked state on its own Pull Request.`;
      }
      paragraphs.push(collectedSentence);
    }
    if (paragraphs.length === 0) {
      return;
    }
    setPullRequestData({ deploymentScopeMarkdownBody: paragraphs.join('\n\n') });
  } catch (e) {
    uxLog("warning", this, c.yellow('[DeploymentActions] ' + t('deploymentActionsScopeError', { message: (e as Error).message })));
  }
}

async function completeWithCommandsFromPullRequests(property: 'commandsPreDeploy' | 'commandsPostDeploy', commands: PrePostCommand[], checkOnly: boolean, deploySuccess: boolean) {
  await checkForDraftCommandsFile(property, checkOnly, deploySuccess);
  const pullRequests = await listAllPullRequestsForCurrentScope(checkOnly);
  for (const pr of pullRequests) {
    // Check if there is a .sfdx-hardis.PULL_REQUEST_ID.yml file in the PR
    const prConfigParsed = await getPullRequestScopedSfdxHardisConfig(pr);
    if (prConfigParsed && prConfigParsed[property] && Array.isArray(prConfigParsed[property])) {
      const prConfigCommands = prConfigParsed[property] as PrePostCommand[];
      for (const cmd of prConfigCommands) {
        cmd.pullRequest = pr;
        commands.push(cmd);
      }
    }
  }
}

/**
 * Pull Requests whose comments are scanned for deployment actions state and manual action
 * checkboxes: the given Pull Requests (current one + those owning actions), plus the batch Pull
 * Requests of the scope (major-branch or retrofit merges), because their deployment comments
 * list the actions state and manual action checklists of the other Pull Requests, and a user can
 * tick a box there - including on a checklist posted before its action definitions were removed,
 * so batch Pull Requests are scanned even when the scope currently carries no action.
 *
 * Scope-only feature Pull Requests are left out on purpose: a feature / fix Pull Request without
 * a scripts/actions/.sfdx-hardis.<PR>.yml file (or a YAML block in its description) has no
 * action associated, so its comments only carry its own content, and scanning each Pull Request
 * of the scope costs one or more git provider API calls - on a repository with a large promotion
 * window, scanning thousands of them made CI jobs exceed their timeout (issue #2115).
 */
async function buildPrNumbersToScan(basePrNumbers: number[]): Promise<number[]> {
  const scopePrs = getPullRequestScopeInfo()?.pullRequests || [];
  let batchPrNumbers: number[] = [];
  if (scopePrs.length > 0) {
    const majorBranchNames = (await listMajorOrgs()).map((majorOrg: any) => majorOrg.branchName);
    const promotionConfig = getPromotionBranchConfig(await getConfig('branch'));
    batchPrNumbers = scopePrs
      .filter(
        (pr) =>
          !isSinglePullRequestScope(pr.sourceBranch, majorBranchNames) ||
          // A promotion Pull Request carries a whole batch like a major-to-major merge does, but
          // its branch is not a major one, so the rule above would leave it out and the manual
          // actions ticked on its own comment would never be read back in a later window.
          isPromotionPullRequest(pr, promotionConfig),
      )
      .map((pr) => pr.idNumber);
  }
  return [...new Set([...basePrNumbers, ...batchPrNumbers])].filter((prNumber) => prNumber > 0);
}

/**
 * Collect all unique source PR numbers from the commands list.
 * Includes the current PR number (for branch-config and current PR's own actions).
 */
function collectSourcePrNumbers(commands: PrePostCommand[], currentPrNumber: number): number[] {
  const prNumbers = new Set<number>();
  if (currentPrNumber > 0) prNumbers.add(currentPrNumber);
  for (const cmd of commands) {
    if (cmd.pullRequest?.idNumber && cmd.pullRequest.idNumber > 0) {
      prNumbers.add(cmd.pullRequest.idNumber);
    }
    // The Pull Request an action was moved from gets a 'moved' entry: its state must be loaded so
    // the entry is merged with what it already holds
    if (cmd.movedFrom && cmd.movedFrom > 0) {
      prNumbers.add(cmd.movedFrom);
    }
  }
  return [...prNumbers];
}

async function checkForDraftCommandsFile(property: 'commandsPreDeploy' | 'commandsPostDeploy', checkOnly: boolean, deploySuccess: boolean) {
  const prConfigFileName = path.join("scripts", "actions", `.sfdx-hardis.draft.yml`);
  if (fs.existsSync(prConfigFileName)) {
    let suggestedFileName = ".sfdx-hardis.PULL_REQUEST_ID.yml (ex: .sfdx-hardis.123.yml)";
    const prInfo = await GitProvider.getPullRequestInfo();
    if (prInfo && prInfo.idStr) {
      suggestedFileName = `.sfdx-hardis.${prInfo.idStr}.yml`;
    }
    const errorMessage = `Draft deployment actions file ${prConfigFileName} found.

Please assign it to a Pull Request before proceeding, or delete the file it if you don't need it.

To assign it, rename .sfdx-hardis.draft.yml into ${suggestedFileName}.
`;
    let prData = getPullRequestData()
    prData = Object.assign(prData, {
      messageKey: prData.messageKey ?? 'deployment',
      // Shown in the "needs you" part of the comment: how to fix it
      blockingIssueMarkdownBody: `#### ❌ Draft deployment actions file\n\n${errorMessage.trim()}`,
    });
    // When the deployment already failed, keep its error as the reported one: the draft file is a
    // secondary problem and must not take over the Pull Request comment title.
    if (deploySuccess !== false) {
      prData = Object.assign(prData, { title: "❌ Error: Draft deployment actions file found", status: 'invalid' });
    }
    setPullRequestData(prData);
    await GitProvider.managePostPullRequestComment(checkOnly);
    uxLog("error", this, c.red(`[DeploymentActions] ${errorMessage}`));
    throw new SfError(`Draft commands file ${prConfigFileName} found. Please assign it to a Pull Request or delete it before proceeding.`);
  }
}

async function executeAction(cmd: PrePostCommand): Promise<void> {
  // Use ActionsProvider classes to execute actions
  const actionInstance = await ActionsProvider.buildActionInstance(cmd);
  try {
    const res = await actionInstance.run(cmd);
    cmd.result = res;
  } catch (e) {
    uxLog("error", this, c.red(`[DeploymentActions] Exception while running action ${cmd.label}: ${(e as Error).message}`));
    // A failed command throws an error whose message already repeats its stderr (Node) then its
    // stdout and stderr (execCommand): keep the two streams once, the message when there are none
    cmd.result = {
      statusCode: 'failed',
      output: buildActionOutput(e) || (e as Error).message
    };
  }
}

/**
 * Status of an action as reported to the user (results table, state comment).
 * The internal statusCode stays 'failed' for an action allowed to fail, because it drives the
 * "stop further actions" and "fail the job" decisions; what is reported is a warning, since the
 * deployment went on.
 */
export function getReportedActionStatus(cmd: PrePostCommand): 'success' | 'failed' | 'warning' | 'manual' | 'skipped' {
  if (cmd.result?.statusCode === "failed" && cmd.allowFailure === true) {
    return 'warning';
  }
  return cmd.result?.statusCode as 'success' | 'failed' | 'manual' | 'skipped';
}

// The Pull Request comment layout (utilsPrCommentLayout.ts) renders the actions from these facts
function manageResultMarkdownBody(property: 'commandsPreDeploy' | 'commandsPostDeploy', commands: PrePostCommand[], orgBranch?: string) {
  setPullRequestData({ [property === 'commandsPreDeploy' ? 'preDeployActions' : 'postDeployActions']: { commands, orgBranch } });
}

/**
 * Fail a validation job while a pre-deployment manual action is not marked as performed in the
 * target org branch: it must be done before the merge, and a green validation would let the Pull
 * Request be merged without it. Not on a draft Pull Request, still being worked on. Off by default:
 * turned on with failValidationOnPendingManualActions: true.
 */
async function failOnPendingPreDeployManualActions(): Promise<void> {
  if (pendingPreDeployManualActions.length === 0) {
    return;
  }
  const branchConfig = await getConfig('branch');
  if (branchConfig.failValidationOnPendingManualActions !== true) {
    uxLog("warning", this, c.yellow(`[DeploymentActions] ${t('pendingManualActionsNotBlocking', { count: pendingPreDeployManualActions.length })}`));
    return;
  }
  const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
  const orgBranch = prInfo?.targetBranch || await getCurrentGitBranch() || 'unknown';
  if (isDraftPullRequest(prInfo)) {
    uxLog("warning", this, c.yellow(`[DeploymentActions] ${t('pendingManualActionsDraftPullRequest', { count: pendingPreDeployManualActions.length, orgBranch })}`));
    return;
  }
  uxLog("error", this, c.red(`[DeploymentActions] ${t('pendingManualActionsBlockValidation', { count: pendingPreDeployManualActions.length, orgBranch })}`));
  for (const cmd of pendingPreDeployManualActions) {
    const pr = cmd.pullRequest?.idNumber || prInfo?.idNumber || 0;
    uxLog("error", this, c.red(`- ${cmd.label} (${pr > 0 ? `#${pr}, ` : ''}id ${cmd.id})`));
    uxLog("log", this, c.grey(`  sf hardis:project:action:set-status --pr ${pr} --action-id "${cmd.id}" --org-branch ${orgBranch} --status success`));
  }
  uxLog("warning", this, c.yellow(`[DeploymentActions] ${t('pendingManualActionsHowToConfirm', { orgBranch })}`));
  let prData = getPullRequestData();
  prData = Object.assign(prData, {
    title: '❌ Error: Manual actions to perform before the merge',
    messageKey: prData.messageKey ?? 'deployment',
    status: 'invalid',
  });
  setPullRequestData(prData);
  await GitProvider.managePostPullRequestComment(true);
  throw new SfError(t('pendingManualActionsBlockValidation', { count: pendingPreDeployManualActions.length, orgBranch }));
}
