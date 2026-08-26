import { SfError } from '@salesforce/core';
import c from 'chalk';
import fs from './fsUtils.js';

import * as path from 'path';
import { getConfig, getEnvVar } from '../../config/index.js';
import { getCurrentGitBranch, uxLog } from './index.js';
import { GitProvider } from '../gitProvider/index.js';
import { loadDeploymentActionsState, checkActionInState, upsertActionInState, persistDeploymentActionsState, getJobInfoWithUrl, syncManualActionCheckboxes, buildManualActionCheckboxMarker } from './deploymentActionsStateUtils.js';
// data import moved to DataAction class in actionsProvider
import { getPullRequestData, setPullRequestData } from './gitUtils.js';
import { ActionsProvider, PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { getPullRequestScopedSfdxHardisConfig, getPullRequestScopeInfo, isSinglePullRequestScope, listAllPullRequestsForCurrentScope } from './pullRequestUtils.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { t } from './i18n.js';
import { ActionWhen, buildActionTargetBranchCandidates, evaluateActionBranchFilter, getPrIdFromUserConfig } from './actionUtils.js';
import { recordExecutedDeploymentActions } from './deploymentActionsRegistry.js';

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
  const actionLabel = property === 'commandsPreDeploy' ? 'Pre-deployment actions' : 'Post-deployment actions';
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
  uxLog("action", this, c.cyan(`[DeploymentActions] Listing ${actionLabel}...`));
  const commands: PrePostCommand[] = [...(branchConfig[property] || []), ...(extraCommands || [])];
  try {
    await completeWithCommandsFromPullRequests(property, commands, options.checkOnly, options.success);
  } catch (e) {
    uxLog("error", this, c.red(`[DeploymentActions] Error while retrieving commands from pull requests: ${(e as Error).message}\n ${(e as Error).stack}\n You might report the issue on sfdx-hardis GitHub repository.`));
  }
  for (const cmd of commands) {
    cmd.when ??= deployWhen;
  }
  // Explain in the Pull Request comment which Pull Requests the actions and test classes come from,
  // so nobody wonders why actions of other Pull Requests are listed on this one.
  await addDeploymentScopeMarkdownToPrData(options.checkOnly);
  if (commands.length === 0) {
    uxLog("action", this, c.cyan(`[DeploymentActions] No ${actionLabel} defined in branch config or pull requests`));
    uxLog("log", this, c.grey(t('noFoundToRun', { property })));
    // Even with no action to run, a manual action checkbox may have been ticked in a comment of
    // the current Pull Request (ex: the action definition was removed after its checklist was
    // posted): still scan its comments so the tick is recorded and propagated. Only the current
    // Pull Request is scanned here: with no action in the whole scope, the other Pull Requests
    // cannot carry a checklist worth an API call each.
    if ((await GitProvider.getInstance()) !== null) {
      const prInfoForSync = await GitProvider.getPullRequestInfo({ useCache: true });
      const allPrsForSync = await buildPrNumbersToScan([prInfoForSync?.idNumber || 0], false);
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
    `[DeploymentActions] Found ${commands.length} ${actionLabel} to run\n` +
    commands.map(c => `- ${c.label} (${c.type || 'command'})`).join('\n')
  ));

  // A failed metadata deployment must not be followed by deployment actions: the org is in an
  // unknown state, so actions are listed and reported, but never executed. Nothing is written to
  // the runOnlyOnceByOrg state, so they still run during the next successful deployment.
  // Returning here also leaves the deployment error as the error reported by the job.
  // (pre-deploy callers always pass success: true)
  if (options.success === false) {
    for (const cmd of commands) {
      cmd.result = { statusCode: "not-run", skippedReason: t('actionNotRunDeploymentFailed') };
    }
    uxLog("warning", this, c.yellow(
      `[DeploymentActions] ${t('deploymentActionsNotRunDeploymentFailed', { count: commands.length })}`
    ));
    manageResultMarkdownBody(property, commands, options.checkOnly);
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
    const allPrNumbers = await buildPrNumbersToScan(sourcePrNumbers, commands.length > 0);
    await loadDeploymentActionsState(allPrNumbers);
    try {
      await syncManualActionCheckboxes(allPrNumbers);
    } catch (e) {
      uxLog("warning", this, c.yellow('[DeploymentActions] ' + t('deploymentActionsCheckboxSyncError', { message: (e as Error).message })));
    }
  }

  for (let cmdIndex = 0; cmdIndex < commands.length; cmdIndex++) {
    const cmd = commands[cmdIndex];
    // An action defining both branch filter lists is a definition error, not a skip: report every
    // offending action of the job, and let the failure check after the loop fail the deployment.
    const branchFilterVerdict = evaluateActionBranchFilter(cmd, targetBranchCandidates);
    if (branchFilterVerdict.invalid) {
      cmd.result = { statusCode: "failed", skippedReason: branchFilterVerdict.reason };
      uxLog("error", this, c.red(`[DeploymentActions] Action ${cmd.label} is not valid: ${branchFilterVerdict.reason}`));
      continue;
    }
    const actionsInstance = await ActionsProvider.buildActionInstance(cmd);
    const actionsIssues = await actionsInstance.checkValidityIssues(cmd);
    if (actionsIssues) {
      cmd.result = actionsIssues;
      uxLog("error", this, c.red(`[DeploymentActions] Action ${cmd.label} is not valid: ${actionsIssues.skippedReason}`));
      continue;
    }
    // Determine whether the action should be skipped; use a flag instead of early `continue` so
    // that skipped outcomes are still recorded in the "Deployment Actions" PR comment below.
    let skipAction = false;

    // Skip if we are in another context than the requested one
    const cmdContext = cmd.context || "all";
    if (cmdContext === "check-deployment-only" && options.checkOnly === false) {
      uxLog("action", this, c.grey(`[DeploymentActions] Skipping ${describeActionWithPr(cmd)}: validation-only action (context check-deployment-only), and this is the deployment job`));
      cmd.result = {
        statusCode: "skipped",
        skippedReason: "Action context is check-deployment-only but this is the deployment job"
      };
      skipAction = true;
    } else if (cmdContext === "process-deployment-only" && options.checkOnly === true) {
      uxLog("action", this, c.grey(`[DeploymentActions] Skipping ${describeActionWithPr(cmd)}: deployment-only action (context process-deployment-only), and this is the validation job`));
      cmd.result = {
        statusCode: "skipped",
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
    if (!skipAction) {
      // true by default, except for action types that must run at every deployment
      const runOnlyOnceByOrg = actionsInstance.supportsRunOnlyOnceByOrg() && cmd.runOnlyOnceByOrg !== false;
      if (runOnlyOnceByOrg) {
        const gitProviderInst = await GitProvider.getInstance();
        if (!gitProviderInst) {
          uxLog("warning", this, c.yellow(
            `[DeploymentActions] Skipping ${cmd.label}: runOnlyOnceByOrg requires a git provider to track state. Configure GITHUB_TOKEN / CI_SFDX_HARDIS_GITLAB_TOKEN / SYSTEM_ACCESSTOKEN / CI_SFDX_HARDIS_BITBUCKET_TOKEN.`
          ));
          cmd.result = { statusCode: "skipped", skippedReason: "runOnlyOnceByOrg: no git provider configured for state tracking" };
          skipAction = true;
        } else {
          const existingEntry = checkActionInState(cmd.id, orgBranchName);
          if (existingEntry) {
            uxLog("action", this, c.grey(
              `[DeploymentActions] Skipping ${describeActionWithPr(cmd)}: already run in ${orgBranchName} on ${existingEntry.date}`
            ));
            cmd.result = {
              statusCode: "skipped",
              skippedCode: "already-run-in-org",
              skippedReason: `runOnlyOnceByOrg: already run in org (${orgBranchName}) on ${existingEntry.date}`
            };
            // If the action label changed, update it in the PR comment.
            if (existingEntry.actionLabel !== cmd.label) {
              const sourcePr = cmd.pullRequest?.idNumber || currentPrNumber;
              upsertActionInState({ ...existingEntry, actionLabel: cmd.label }, sourcePr);
              await persistDeploymentActionsState();
            }
            // Preserve the existing success entry in the PR comment - do not overwrite it with skipped.
            continue;
          }
        }
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
    }
    // Track executed/manual/skipped actions in the source PR's "Deployment Actions" comment.
    // Actions are written to their source PR only - not to the current PR for actions from other PRs.
    // "Already ran" skips (runOnlyOnceByOrg + existing success entry) are excluded via the
    // early `continue` above to avoid overwriting the existing success record.
    const sourcePrNumber = cmd.pullRequest?.idNumber || currentPrNumber;
    const trackableStatuses = ['success', 'failed', 'manual', 'skipped'];
    if (hasGitProvider && sourcePrNumber > 0 && cmd.result?.statusCode && trackableStatuses.includes(cmd.result.statusCode)) {
      const { jobId, jobUrl } = await getJobInfoWithUrl();
      upsertActionInState({
        actionId: cmd.id,
        actionLabel: cmd.label,
        orgBranch: orgBranchName,
        when: deployWhen,
        executionOrder: cmdIndex,
        status: getReportedActionStatus(cmd),
        jobId,
        jobUrl,
        date: new Date().toISOString(),
        output: cmd.result.output,
      }, sourcePrNumber);
      await persistDeploymentActionsState();
    }
    if (cmd.result?.statusCode === "failed" && cmd.allowFailure !== true) {
      uxLog("error", this, c.red(`[DeploymentActions] Action ${cmd.label} failed, stopping execution of further actions.`));
      // Give the actions that will not run an explicit reason, so the Pull Request comment does not
      // show a bare "not run" without saying why.
      for (let notRunIndex = cmdIndex + 1; notRunIndex < commands.length; notRunIndex++) {
        if (!commands[notRunIndex].result) {
          commands[notRunIndex].result = {
            statusCode: "not-run",
            skippedReason: `Not run because a previous action failed (${cmd.label})`,
          };
        }
      }
      break;
    }
  }
  manageResultMarkdownBody(property, commands, options.checkOnly, orgBranchName);
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
 * True when the action was not attempted because the metadata deployment failed.
 */
function isNotRun(cmd: PrePostCommand): boolean {
  return cmd.result?.statusCode === "not-run";
}

/**
 * True when the action result carries something worth displaying (not empty, not blank lines).
 */
function hasOutput(cmd: PrePostCommand): boolean {
  return (cmd.result?.output || '').trim() !== '';
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
    const prLinks = scopeInfo.pullRequests
      .map((pr) => (pr.webUrl ? `[#${pr.idStr}](${pr.webUrl})` : `#${pr.idStr}`))
      .join(', ');
    // Only name what the Pull Requests of the scope really carry
    const prConfigs = await Promise.all(
      scopeInfo.pullRequests.map((pr) => getPullRequestScopedSfdxHardisConfig(pr).catch(() => null))
    );
    const projectConfig = await getConfig('branch');
    const subjects = buildDeploymentScopeSubjects(prConfigs, projectConfig?.enableDeploymentApexTestClasses === true);
    const subjectsLabel = subjects.join(' and ');
    const paragraphs: string[] = [];
    if (checkOnly) {
      if (subjects.length > 0) {
        let collectedSentence = `ℹ️ ${subjectsLabel} are collected from the content of this Pull Request`;
        if (scopeInfo.pullRequests.length > 1) {
          collectedSentence += ` (${scopeInfo.pullRequests.length} Pull Requests carried: ${prLinks})`;
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
        return;
      }
      // Tense-neutral wording: this paragraph is also posted when the metadata deployment failed,
      // in which case the actions were collected but deliberately not run (see fix #2053)
      let collectedSentence = `ℹ️ ${subjectsLabel} were collected from ${scopeInfo.pullRequests.length} Pull Request(s): ${prLinks}.`;
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
 * checkboxes: the given Pull Requests (current one + those owning actions), plus - only when the
 * scope carries at least one deployment action - the batch Pull Requests of the scope
 * (major-branch or retrofit merges), because their deployment comments list the actions state
 * and manual action checklists of the other Pull Requests, and a user can tick a box there.
 * With no action in the whole scope, no comment can carry anything to record.
 *
 * Scope-only feature Pull Requests are left out on purpose: a feature / fix Pull Request without
 * a scripts/actions/.sfdx-hardis.<PR>.yml file (or a YAML block in its description) has no
 * action associated, so its comments only carry its own content, and scanning each Pull Request
 * of the scope costs one or more git provider API calls - on a repository with a large promotion
 * window, scanning thousands of them made CI jobs exceed their timeout (issue #2115).
 */
async function buildPrNumbersToScan(basePrNumbers: number[], scopeHasActions: boolean): Promise<number[]> {
  const scopePrs = scopeHasActions ? (getPullRequestScopeInfo()?.pullRequests || []) : [];
  let batchPrNumbers: number[] = [];
  if (scopePrs.length > 0) {
    const majorBranchNames = (await listMajorOrgs()).map((majorOrg: any) => majorOrg.branchName);
    batchPrNumbers = scopePrs
      .filter((pr) => !isSinglePullRequestScope(pr.sourceBranch, majorBranchNames))
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
    const propertyFormatted = property === 'commandsPreDeploy' ? 'preDeployCommandsResultMarkdownBody' : 'postDeployCommandsResultMarkdownBody';
    let prData = getPullRequestData()
    prData = Object.assign(prData, {
      messageKey: prData.messageKey ?? 'deployment',
      [propertyFormatted]: errorMessage
    });
    // When the deployment already failed, keep its error as the reported one: the draft file is a
    // secondary problem and must not take over the Pull Request comment title.
    if (deploySuccess !== false) {
      prData = Object.assign(prData, { title: "❌ Error: Draft deployment actions file found" });
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
    cmd.result = {
      statusCode: 'failed',
      output: (e as Error).message
    };
  }
}

function buildManualActionsSection(commands: PrePostCommand[], isPreDeploy: boolean, checkOnly: boolean, orgBranch?: string): string {
  if (isPreDeploy && !checkOnly) {
    return '';
  }
  if (!isPreDeploy && checkOnly) {
    return '';
  }
  // Pending actions render as unticked to-dos. Actions already performed in the org render as
  // TICKED items: rendering them unticked again would make the next job's checkbox sync re-tick
  // them in a loop, and would tell the reader to perform an action that is already done.
  // Actions not run because the deployment failed are not to-dos: nothing was deployed for them
  // to complete, and they will be listed again during the next successful deployment.
  // Structured skippedCode first; the wording match remains as a safety net for results built
  // by an older sfdx-hardis version in the same process chain
  const isDoneManual = (c: PrePostCommand) =>
    c.result?.statusCode === "skipped" &&
    (c.result.skippedCode === "already-run-in-org" || (c.result.skippedReason || '').startsWith("runOnlyOnceByOrg: already run"));
  // Failed manual actions (invalid customUsername, auth error...) stay in the checklist as
  // unticked to-dos: the operator still has to perform them.
  const manualCommands = commands.filter(c => c.type === "manual" &&
    (c.result?.statusCode === "manual" || c.result?.statusCode === "failed" || isDoneManual(c)));
  if (manualCommands.length === 0) {
    return '';
  }
  const title = isPreDeploy
    ? `#### Manual Actions to perform before proceeding with deployment:\n\n`
    : `#### Manual Actions to perform after deployment:\n\n`;
  let section = title;
  for (const cmd of manualCommands) {
    // Newlines in a label would break the checklist line and its hidden marker
    const singleLineLabel = (cmd.label || '').replace(/\r?\n/g, ' ');
    const labelCol = cmd.pullRequest
      ? `${singleLineLabel} ([${cmd.pullRequest.idStr || "?"}](${cmd.pullRequest.webUrl || ""}))`
      : singleLineLabel;
    // The hidden marker lets sfdx-hardis detect a ticked checkbox on the next job, record the
    // action as done for the org branch, and tick it in the other comments where it appears.
    const marker = orgBranch ? `${buildManualActionCheckboxMarker(cmd.id, orgBranch, cmd.pullRequest?.idNumber || 0, cmd.when)} ` : '';
    section += `- [${isDoneManual(cmd) ? 'x' : ' '}] ${marker}${labelCol}\n`;
  }
  section += `\n*Tick a box once the action has been performed in the org: the next sfdx-hardis job will record it as done.*\n`;
  section += `\n---\n\n`;
  return section;
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

// Status icons of the actions results table, in the order they are listed in the legend
const ACTION_STATUS_LEGEND: { icon: string; label: string }[] = [
  { icon: '✅', label: 'success' },
  { icon: '⚠️', label: 'warning (failed, allowed to fail)' },
  { icon: '❌', label: 'failed' },
  { icon: '👋', label: 'waiting for manual execution' },
  { icon: '⚪', label: 'skipped' },
  { icon: '⏭️', label: 'not run' },
  { icon: '❓', label: 'unknown' },
];

/**
 * Status icon of an action in the results table.
 */
function getActionStatusIcon(cmd: PrePostCommand): string {
  return cmd.result?.statusCode === "manual" ?
    "👋" :
    cmd.result?.statusCode === "success" ? '✅' :
      (cmd.result?.statusCode === "failed" && cmd.allowFailure === true) ? '⚠️' :
        (cmd.result?.statusCode === "failed") ? '❌' :
          cmd.result?.statusCode === "skipped" ? '⚪' :
            cmd.result?.statusCode === "not-run" ? '⏭️' : '❓';
}

/**
 * Legend of the actions results table, listing only the statuses actually present in it.
 * A legend explaining outcomes that do not appear in the table above it is noise.
 */
function buildActionStatusLegend(usedIcons: string[]): string {
  const used = new Set(usedIcons);
  const parts = ACTION_STATUS_LEGEND.filter((entry) => used.has(entry.icon)).map((entry) => `${entry.icon} ${entry.label}`);
  return parts.length > 0 ? `\n*Legend: ${parts.join(' · ')}*\n` : '';
}

/**
 * Build the "Actions Results" markdown section posted in the Pull Request comment.
 * Exported so it can be unit tested without a git provider or a config layer.
 */
export function buildActionsResultMarkdown(property: 'commandsPreDeploy' | 'commandsPostDeploy', commands: PrePostCommand[], checkOnly: boolean, orgBranch?: string): string {
  let markdownBody = `### ${property === 'commandsPreDeploy' ? 'Pre-deployment Actions' : 'Post-deployment Actions'} Results\n\n`;

  // Add manual actions section
  const isPreDeploy = property === 'commandsPreDeploy';
  markdownBody += buildManualActionsSection(commands, isPreDeploy, checkOnly, orgBranch);

  // Count labels so two distinct actions sharing the same label do not look like a duplicated row
  const labelCounts = new Map<string, number>();
  for (const cmd of commands) {
    labelCounts.set(cmd.label, (labelCounts.get(cmd.label) || 0) + 1);
  }
  const hasDuplicateLabels = [...labelCounts.values()].some((count) => count > 1);

  // Build markdown table
  markdownBody += `| <!-- --> | Label | Type | Status | Details |\n`;
  markdownBody += `|:--------:|-------|------|--------|---------|\n`;
  const usedStatusIcons: string[] = [];
  for (const cmd of commands) {
    const statusIcon = getActionStatusIcon(cmd);
    usedStatusIcons.push(statusIcon);
    const statusCol = cmd.result?.statusCode === "manual" ?
      'waiting for manual execution' :
      `${getReportedActionStatus(cmd) || 'not run'}`;
    const detailCol = (cmd.result?.statusCode === "skipped" || cmd.result?.statusCode === "not-run") ?
      (cmd.result?.skippedReason || '<!-- -->') :
      (cmd.result?.statusCode === "failed" && cmd.allowFailure === true) ?
        (cmd.result.skippedReason ? `${cmd.result.skippedReason} (Allowed to fail)` : "(Allowed to fail)") :
        (cmd.result?.statusCode === "failed" && cmd.result.skippedReason) ?
          cmd.result.skippedReason :
          cmd.result?.statusCode === "manual" ?
            "Instructions in the details section below" :
            "See details below";
    const labelCol = cmd.pullRequest ?
      `${cmd.label} ([${cmd.pullRequest.idStr || "?"}](${cmd.pullRequest.webUrl || ""}))` :
      cmd.label;
    markdownBody += `| ${statusIcon} | ${labelCol} | ${cmd.type || 'command'} | ${statusCol} | ${detailCol} |\n`;
  }
  if (hasDuplicateLabels) {
    markdownBody += `\n*Some rows share the same label but are distinct actions, each defined on its own Pull Request.*\n`;
  }
  markdownBody += buildActionStatusLegend(usedStatusIcons);
  // Add details in html <detail> blocks, embedded in a root <details> block to avoid markdown rendering issues
  const commandsInResults = commands.filter(c => hasOutput(c) || (c.type === "manual" && !isNotRun(c)));
  if (commandsInResults.length > 0) {
    markdownBody += `\n<details>\n<summary>Expand to see details for each action</summary>\n\n`;
    for (const cmd of commands) {
      if (hasOutput(cmd)) {
        // Truncate output if too long: Either the last 2000 characters, either the last 50 lines (if they are not more than 2000 characters)
        // Indicate when output has been truncated
        const maxOutputLength = 2000;
        let outputForMarkdown = cmd.result!.output as string;
        const outputLines = outputForMarkdown.split('\n');
        if (outputForMarkdown.length > maxOutputLength) {
          outputForMarkdown = outputForMarkdown.substring(outputForMarkdown.length - maxOutputLength);
        }
        if (outputLines.length > 50) {
          const last50Lines = outputLines.slice(-50).join('\n');
          if (last50Lines.length <= maxOutputLength) {
            outputForMarkdown = last50Lines;
          }
        }
        if (outputForMarkdown.length < (cmd.result!.output as string).length) {
          outputForMarkdown = `... (output truncated, total length was ${(cmd.result!.output as string).length} characters)\n` + outputForMarkdown;
        }

        const labelTitle = cmd.pullRequest ?
          `${cmd.label} (${cmd.pullRequest.idStr || "?"})` :
          cmd.label;
        markdownBody += `\n<details id="command-${cmd.id}">\n<summary>${labelTitle}</summary>\n\n`;
        markdownBody += '```\n';
        markdownBody += outputForMarkdown
        markdownBody += '\n```\n';
        markdownBody += '</details>\n';
      }
      else if (cmd.type === "manual" && !isNotRun(cmd)) {
        const labelTitle = cmd.pullRequest ?
          `${cmd.label} ([${cmd.pullRequest.idStr || "?"}](${cmd.pullRequest.webUrl || ""}))` :
          cmd.label;
        markdownBody += `\n<details id="command-${cmd.id}">\n<summary>${labelTitle}</summary>\n\n`;
        // Instructions are markdown written by humans: a blockquote keeps their lists, links and
        // bold text rendered, where a code fence would show them as raw text. Raw HTML tags are
        // neutralized so an instruction cannot close the enclosing <details> blocks.
        const instructions = (cmd?.parameters?.instructions || "No instructions provided.") as string;
        const safeInstructions = instructions.replace(/</g, '&lt;');
        markdownBody += safeInstructions.split('\n').map((line) => `> ${line}`).join('\n');
        markdownBody += '\n</details>\n';
      }
    }
    markdownBody += `\n</details>\n`;
  }
  return markdownBody;
}

function manageResultMarkdownBody(property: 'commandsPreDeploy' | 'commandsPostDeploy', commands: PrePostCommand[], checkOnly: boolean, orgBranch?: string) {
  const propertyFormatted = property === 'commandsPreDeploy' ? 'preDeployCommandsResultMarkdownBody' : 'postDeployCommandsResultMarkdownBody';
  const prData = {
    [propertyFormatted]: buildActionsResultMarkdown(property, commands, checkOnly, orgBranch)
  };
  setPullRequestData(prData);
}
