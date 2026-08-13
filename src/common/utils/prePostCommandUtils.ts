import { SfError } from '@salesforce/core';
import c from 'chalk';
import fs from 'fs-extra';

import * as path from 'path';
import { getConfig } from '../../config/index.js';
import { getCurrentGitBranch, uxLog } from './index.js';
import { GitProvider } from '../gitProvider/index.js';
import { loadDeploymentActionsState, checkActionInState, upsertActionInState, persistDeploymentActionsState, getJobInfoWithUrl } from './deploymentActionsStateUtils.js';
// data import moved to DataAction class in actionsProvider
import { getPullRequestData, setPullRequestData } from './gitUtils.js';
import { ActionsProvider, PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { getPullRequestScopedSfdxHardisConfig, listAllPullRequestsForCurrentScope } from './pullRequestUtils.js';
import { t } from './i18n.js';
import { ActionWhen, getPrIdFromUserConfig } from './actionUtils.js';
import { recordExecutedDeploymentActions } from './deploymentActionsRegistry.js';

export async function executePrePostCommands(property: 'commandsPreDeploy' | 'commandsPostDeploy', options: { success: boolean, checkOnly: boolean, extraCommands?: any[] }) {
  const actionLabel = property === 'commandsPreDeploy' ? 'Pre-deployment actions' : 'Post-deployment actions';
  uxLog("action", this, c.cyan(`[DeploymentActions] Listing ${actionLabel}...`));
  const branchConfig = await getConfig('branch');
  const deployWhen: ActionWhen = property === 'commandsPreDeploy' ? 'pre-deploy' : 'post-deploy';
  const extraCommands = (options.extraCommands || []).filter(cmd => cmd.preOrPost === property);
  const commands: PrePostCommand[] = [...(branchConfig[property] || []), ...(extraCommands || [])];
  try {
    await completeWithCommandsFromPullRequests(property, commands, options.checkOnly, options.success);
  } catch (e) {
    uxLog("error", this, c.red(`[DeploymentActions] Error while retrieving commands from pull requests: ${(e as Error).message}\n ${(e as Error).stack}\n You might report the issue on sfdx-hardis GitHub repository.`));
  }
  for (const cmd of commands) {
    cmd.when ??= deployWhen;
  }
  if (commands.length === 0) {
    uxLog("action", this, c.cyan(`[DeploymentActions] No ${actionLabel} defined in branch config or pull requests`));
    uxLog("log", this, c.grey(t('noFoundToRun', { property })));
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

  // Pre-load deployment actions state from all source PRs
  const hasGitProvider = (await GitProvider.getInstance()) !== null;
  if (hasGitProvider) {
    const sourcePrNumbers = collectSourcePrNumbers(commands, currentPrNumber);
    await loadDeploymentActionsState(sourcePrNumbers);
  }

  for (let cmdIndex = 0; cmdIndex < commands.length; cmdIndex++) {
    const cmd = commands[cmdIndex];
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
      uxLog("action", this, c.grey(`[DeploymentActions] Skipping ${cmd.label}: check-deployment-only action, and we are in process deployment mode`));
      cmd.result = {
        statusCode: "skipped",
        skippedReason: "Action context is check-deployment-only but we are in process deployment mode"
      };
      skipAction = true;
    } else if (cmdContext === "process-deployment-only" && options.checkOnly === true) {
      uxLog("action", this, c.grey(`[DeploymentActions] Skipping ${cmd.label}: process-deployment-only action as we are in check deployment mode`));
      cmd.result = {
        statusCode: "skipped",
        skippedReason: "Action context is process-deployment-only but we are in check deployment mode"
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
              `[DeploymentActions] Skipping ${cmd.label}: already run in ${orgBranchName} on ${existingEntry.date}`
            ));
            cmd.result = {
              statusCode: "skipped",
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
      uxLog("action", this, c.cyan(`[DeploymentActions] Running action ${cmd.label}`));
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
        status: cmd.result.statusCode as 'success' | 'failed' | 'manual' | 'skipped',
        jobId,
        jobUrl,
        date: new Date().toISOString(),
        output: cmd.result.output,
      }, sourcePrNumber);
      await persistDeploymentActionsState();
    }
    if (cmd.result?.statusCode === "failed" && cmd.allowFailure !== true) {
      uxLog("error", this, c.red(`[DeploymentActions] Action ${cmd.label} failed, stopping execution of further actions.`));
      break;
    }
  }
  manageResultMarkdownBody(property, commands, options.checkOnly);
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
      });
      setPullRequestData(prData);
      await GitProvider.managePostPullRequestComment(options.checkOnly);
      throw new SfError(`One or more ${actionLabel} have failed. See logs for more details.`);
    }
  }
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

function buildManualActionsSection(commands: PrePostCommand[], isPreDeploy: boolean, checkOnly: boolean): string {
  if (isPreDeploy && !checkOnly) {
    return '';
  }
  if (!isPreDeploy && checkOnly) {
    return '';
  }
  // Actions not run because the deployment failed are not to-dos: nothing was deployed for them
  // to complete, and they will be listed again during the next successful deployment.
  const manualCommands = commands.filter(c => c.type === "manual" && !isNotRun(c));
  if (manualCommands.length === 0) {
    return '';
  }
  const title = isPreDeploy
    ? `#### Manual Actions to perform before proceeding with deployment:\n\n`
    : `#### Manual Actions to perform after deployment:\n\n`;
  let section = title;
  for (const cmd of manualCommands) {
    const labelCol = cmd.pullRequest
      ? `${cmd.label} ([${cmd.pullRequest.idStr || "?"}](${cmd.pullRequest.webUrl || ""}))`
      : cmd.label;
    section += `- [ ] ${labelCol}\n`;
  }
  section += `\n---\n\n`;
  return section;
}

/**
 * Build the "Actions Results" markdown section posted in the Pull Request comment.
 * Exported so it can be unit tested without a git provider or a config layer.
 */
export function buildActionsResultMarkdown(property: 'commandsPreDeploy' | 'commandsPostDeploy', commands: PrePostCommand[], checkOnly: boolean): string {
  let markdownBody = `### ${property === 'commandsPreDeploy' ? 'Pre-deployment Actions' : 'Post-deployment Actions'} Results\n\n`;

  // Add manual actions section
  const isPreDeploy = property === 'commandsPreDeploy';
  markdownBody += buildManualActionsSection(commands, isPreDeploy, checkOnly);

  // Build markdown table
  markdownBody += `| <!-- --> | Label | Type | Status | Details |\n`;
  markdownBody += `|:--------:|-------|------|--------|---------|\n`;
  for (const cmd of commands) {
    const statusIcon = cmd.result?.statusCode === "manual" ?
      "👋" :
      cmd.result?.statusCode === "success" ? '✅' :
        (cmd.result?.statusCode === "failed" && cmd.allowFailure === true) ? '⚠️' :
          (cmd.result?.statusCode === "failed") ? '❌' :
            cmd.result?.statusCode === "skipped" ? '⚪' :
              cmd.result?.statusCode === "not-run" ? '⏭️' : '❓';
    const statusCol = `${cmd.result?.statusCode || 'not run'}`;
    const detailCol = (cmd.result?.statusCode === "skipped" || cmd.result?.statusCode === "not-run") ?
      (cmd.result?.skippedReason || '<!-- -->') :
      (cmd.result?.statusCode === "failed" && cmd.allowFailure === true) ?
        (cmd.result.skippedReason ? `${cmd.result.skippedReason} (Allowed to fail)` : "(Allowed to fail)") :
        (cmd.result?.statusCode === "failed" && cmd.result.skippedReason) ?
          cmd.result.skippedReason :
          "See details below";
    const labelCol = cmd.pullRequest ?
      `${cmd.label} ([${cmd.pullRequest.idStr || "?"}](${cmd.pullRequest.webUrl || ""}))` :
      cmd.label;
    markdownBody += `| ${statusIcon} | ${labelCol} | ${cmd.type || 'command'} | ${statusCol} | ${detailCol} |\n`;
  }
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
        markdownBody += '```\n';
        markdownBody += cmd?.parameters?.instructions || "No instructions provided.";
        markdownBody += '\n```\n';
        markdownBody += '</details>\n';
      }
    }
    markdownBody += `\n</details>\n`;
  }
  return markdownBody;
}

function manageResultMarkdownBody(property: 'commandsPreDeploy' | 'commandsPostDeploy', commands: PrePostCommand[], checkOnly: boolean) {
  const propertyFormatted = property === 'commandsPreDeploy' ? 'preDeployCommandsResultMarkdownBody' : 'postDeployCommandsResultMarkdownBody';
  const prData = {
    [propertyFormatted]: buildActionsResultMarkdown(property, commands, checkOnly)
  };
  setPullRequestData(prData);
}
