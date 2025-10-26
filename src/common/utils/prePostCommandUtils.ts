import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import fs from 'fs-extra';
import yaml from 'js-yaml';

import * as path from 'path';
import { getConfig } from '../../config/index.js';
import { uxLog } from './index.js';
import { CommonPullRequestInfo, GitProvider } from '../gitProvider/index.js';
import { checkSfdxHardisTraceAvailable, listMajorOrgs } from './orgConfigUtils.js';
import { soqlQuery } from './apiUtils.js';
// data import moved to DataAction class in actionsProvider
import { getPullRequestData, setPullRequestData } from './gitUtils.js';
import { ActionsProvider, PrePostCommand } from '../actionsProvider/actionsProvider.js';

export async function executePrePostCommands(property: 'commandsPreDeploy' | 'commandsPostDeploy', options: { success: boolean, checkOnly: boolean, conn: Connection, extraCommands?: any[] }) {
  const actionLabel = property === 'commandsPreDeploy' ? 'Pre-deployment actions' : 'Post-deployment actions';
  uxLog("action", this, c.cyan(`[DeploymentActions] Listing ${actionLabel}...`));
  const branchConfig = await getConfig('branch');
  const commands: PrePostCommand[] = [...(branchConfig[property] || []), ...(options.extraCommands || [])];
  await completeWithCommandsFromPullRequests(property, commands, options.checkOnly);
  if (commands.length === 0) {
    uxLog("action", this, c.cyan(`[DeploymentActions] No ${actionLabel} defined in branch config or pull requests`));
    uxLog("log", this, c.grey(`No ${property} found to run`));
    return;
  }
  uxLog("action", this, c.cyan(`[DeploymentActions] Found ${commands.length} ${actionLabel} to run`));
  uxLog("log", this, c.grey(commands.map(c => `- ${c.label} (${c.type || 'command'})`).join('\n')));
  for (const cmd of commands) {
    const actionsInstance = await ActionsProvider.buildActionInstance(cmd);
    const actionsIssues = await actionsInstance.checkValidityIssues(cmd);
    if (actionsIssues) {
      cmd.result = actionsIssues;
      uxLog("error", this, c.red(`[DeploymentActions] Action ${cmd.label} is not valid: ${actionsIssues.skippedReason}`));
      continue;
    }
    // If if skipIfError is true and deployment failed
    if (options.success === false && cmd.skipIfError === true) {
      uxLog("action", this, c.yellow(`[DeploymentActions] Skipping ${cmd.label} (skipIfError=true) `));
      cmd.result = {
        statusCode: "skipped",
        skippedReason: "skipIfError is true and deployment failed"
      };
      continue;
    }
    // Skip if we are in another context than the requested one
    const cmdContext = cmd.context || "all";
    if (cmdContext === "check-deployment-only" && options.checkOnly === false) {
      uxLog("action", this, c.grey(`[DeploymentActions] Skipping ${cmd.label}: check-deployment-only action, and we are in process deployment mode`));
      cmd.result = {
        statusCode: "skipped",
        skippedReason: "Action context is check-deployment-only but we are in process deployment mode"
      };
      continue;
    }
    if (cmdContext === "process-deployment-only" && options.checkOnly === true) {
      uxLog("action", this, c.grey(`[DeploymentActions] Skipping ${cmd.label}: process-deployment-only action as we are in check deployment mode`));
      cmd.result = {
        statusCode: "skipped",
        skippedReason: "Action context is process-deployment-only but we are in check deployment mode"
      };
      continue;
    }
    const runOnlyOnceByOrg = cmd.runOnlyOnceByOrg || false;
    if (runOnlyOnceByOrg) {
      await checkSfdxHardisTraceAvailable(options.conn);
      const commandTraceQuery = `SELECT Id,CreatedDate FROM SfdxHardisTrace__c WHERE Type__c='${property}' AND Key__c='${cmd.id}' LIMIT 1`;
      const commandTraceRes = await soqlQuery(commandTraceQuery, options.conn);
      if (commandTraceRes?.records?.length > 0) {
        uxLog("action", this, c.grey(`[DeploymentActions] Skipping ${cmd.label}: it has been defined with runOnlyOnceByOrg and has already been run on ${commandTraceRes.records[0].CreatedDate}`));
        cmd.result = {
          statusCode: "skipped",
          skippedReason: "runOnlyOnceByOrg is true and command has already been run on this org"
        };
        continue;
      }
    }
    // Run command
    uxLog("action", this, c.cyan(`[DeploymentActions] Running action ${cmd.label}`));
    await executeAction(cmd);
    if (cmd.result?.statusCode === "success" && runOnlyOnceByOrg) {
      const hardisTraceRecord = {
        Name: property + "--" + cmd.id,
        Type__c: property,
        Key__c: cmd.id
      }
      const insertRes = await options.conn.insert("SfdxHardisTrace__c", [hardisTraceRecord]);
      if (insertRes[0].success) {
        uxLog("success", this, c.green(`[DeploymentActions] Stored SfdxHardisTrace__c entry ${insertRes[0].id} with command [${cmd.id}] so it is not run again in the future (runOnlyOnceByOrg: true)`));
      }
      else {
        uxLog("error", this, c.red(`[DeploymentActions] Error storing SfdxHardisTrace__c entry :` + JSON.stringify(insertRes, null, 2)));
      }
    }
    else if (cmd.result?.statusCode === "failed" && cmd.allowFailure !== true) {
      uxLog("error", this, c.red(`[DeploymentActions] Action ${cmd.label} failed, stopping execution of further actions.`));
      break;
    }
  }
  manageResultMarkdownBody(property, commands);
  // Check commands results
  const failedCommands = commands.filter(c => c.result?.statusCode === "failed");
  if (failedCommands.length > 0) {
    uxLog("error", this, c.red(`[DeploymentActions] ${failedCommands.length} action(s) failed during ${actionLabel}:`));
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

async function completeWithCommandsFromPullRequests(property: 'commandsPreDeploy' | 'commandsPostDeploy', commands: PrePostCommand[], checkOnly: boolean) {
  await checkForDraftCommandsFile(property, checkOnly);
  const pullRequests = await listAllPullRequestsToUse();
  for (const pr of pullRequests) {
    // Check if there is a .sfdx-hardis.PULL_REQUEST_ID.yml file in the PR
    const prConfigFileName = path.join("scripts", "actions", `.sfdx-hardis.${pr.idStr}.yml`);
    if (fs.existsSync(prConfigFileName)) {
      try {
        const prConfig = await fs.readFile(prConfigFileName, 'utf8');
        const prConfigParsed = yaml.load(prConfig) as any;
        if (prConfigParsed && prConfigParsed[property] && Array.isArray(prConfigParsed[property])) {
          const prConfigCommands = prConfigParsed[property] as PrePostCommand[];
          for (const cmd of prConfigCommands) {
            cmd.pullRequest = pr;
            commands.push(cmd);
          }
        }
      } catch (e) {
        uxLog("error", this, c.red(`Error while parsing ${prConfigFileName} file: ${(e as Error).message}`));
      }
    }
  }
}

let _cachedPullRequests: CommonPullRequestInfo[] | null = null;

async function listAllPullRequestsToUse(): Promise<CommonPullRequestInfo[]> {
  if (_cachedPullRequests) {
    return _cachedPullRequests;
  }
  const gitProvider = await GitProvider.getInstance();
  if (!gitProvider) {
    uxLog("warning", this, c.yellow('No git provider configured, skipping retrieval of commands from pull requests'));
    return [];
  }
  const pullRequestInfo = await gitProvider.getPullRequestInfo();
  if (!pullRequestInfo) {
    uxLog("warning", this, c.yellow('No pull request info available, skipping retrieval of commands from pull requests'));
    return [];
  }
  const majorOrgs = await listMajorOrgs();
  const childBranchesNames = recursiveGetChildBranches(
    pullRequestInfo.targetBranch,
    majorOrgs,
  );
  const pullRequests = await gitProvider.listPullRequestsInBranchSinceLastMerge(
    pullRequestInfo.sourceBranch,
    pullRequestInfo.targetBranch,
    [...childBranchesNames]
  );
  if (!pullRequests.some(pr => pr.idStr === pullRequestInfo.idStr)) {
    pullRequests.push(pullRequestInfo);
  }
  _cachedPullRequests = pullRequests;
  return pullRequests
}

function recursiveGetChildBranches(
  branchName: string,
  majorOrgs: any[],
  collected: Set<string> = new Set(),
): Set<string> {
  const directChildren = majorOrgs
    .filter((o) => o.mergeTargets.includes(branchName))
    .map((o) => o.branchName);
  for (const child of directChildren) {
    if (!collected.has(child)) {
      collected.add(child);
      recursiveGetChildBranches(child, majorOrgs, collected);
    }
  }
  return collected;
}

async function checkForDraftCommandsFile(property: 'commandsPreDeploy' | 'commandsPostDeploy', checkOnly: boolean) {
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
      title: "❌ Error: Draft deployment actions file found",
      messageKey: prData.messageKey ?? 'deployment',
      [propertyFormatted]: errorMessage
    });
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

function manageResultMarkdownBody(property: 'commandsPreDeploy' | 'commandsPostDeploy', commands: PrePostCommand[]) {
  let markdownBody = `### ${property === 'commandsPreDeploy' ? 'Pre-deployment Actions' : 'Post-deployment Actions'} Results\n\n`;
  // Build markdown table
  markdownBody += `| Label | Type | Status | Details |\n`;
  markdownBody += `|-------|------|--------|---------|\n`;
  for (const cmd of commands) {
    const statusIcon = cmd.result?.statusCode === "success" ? '✅' :
      (cmd.result?.statusCode === "failed" && cmd.allowFailure === true) ? '⚠️' :
        (cmd.result?.statusCode === "failed") ? '❌' :
          cmd.result?.statusCode === "skipped" ? '⚪' : '❓';
    const statusCol = `${statusIcon} ${cmd.result?.statusCode || 'not run'}`;
    const detailCol = cmd.result?.statusCode === "skipped" ?
      (cmd.result?.skippedReason || '<!-- -->') :
      (cmd.result?.statusCode === "failed" && cmd.allowFailure === true) ?
        "Allowed to fail" :
        "See details below";
    markdownBody += `| ${cmd.label} | ${cmd.type || 'command'} | ${statusCol} | ${detailCol} |\n`;
  }
  // Add details in html <detail> blocks, embedded in a root <details> block to avoid markdown rendering issues
  markdownBody += `\n<details>\n<summary>Expand to see details for each action</summary>\n\n`;
  for (const cmd of commands) {
    if (cmd.result?.output) {
      // Truncate output if too long
      const maxOutputLength = 10000;
      let outputForMarkdown = cmd.result.output;
      if (outputForMarkdown.length > maxOutputLength) {
        outputForMarkdown = outputForMarkdown.substring(0, maxOutputLength) + `\n\n... Output truncated to ${maxOutputLength} characters ...`;
      }
      markdownBody += `\n<details id="command-${cmd.id}">\n<summary>${cmd.label}</summary>\n\n`;
      markdownBody += '```\n';
      markdownBody += outputForMarkdown
      markdownBody += '\n```\n';
      markdownBody += '</details>\n';
    }
  }
  markdownBody += `\n</details>\n`;
  const propertyFormatted = property === 'commandsPreDeploy' ? 'preDeployCommandsResultMarkdownBody' : 'postDeployCommandsResultMarkdownBody';
  const prData = {
    [propertyFormatted]: markdownBody
  };
  setPullRequestData(prData);
}
