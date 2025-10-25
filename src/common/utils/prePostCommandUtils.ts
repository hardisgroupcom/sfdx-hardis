import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import fs from 'fs-extra';
import yaml from 'js-yaml';

import * as path from 'path';
import { getConfig } from '../../config/index.js';
import { execCommand, uxLog } from './index.js';
import { CommonPullRequestInfo, GitProvider } from '../gitProvider/index.js';
import { checkSfdxHardisTraceAvailable, listMajorOrgs } from './orgConfigUtils.js';
import { soqlQuery } from './apiUtils.js';
import { findDataWorkspaceByName, importData } from './dataUtils.js';
import { setPullRequestData } from './gitUtils.js';


export interface PrePostCommand {
  id: string;
  label: string;
  type: 'command' | 'data' | 'apex' | 'publish-community';
  parameters?: Map<string, any>;
  command: string;
  context: 'all' | 'check-deployment-only' | 'process-deployment-only';
  skipIfError?: boolean;
  allowFailure?: boolean;
  runOnlyOnceByOrg?: boolean;
  // If command comes from a PR, we attach PR info
  pullRequest?: CommonPullRequestInfo;
  result?: {
    statusCode: "success" | "failed" | "skipped";
    output?: string;
    skippedReason?: string;
  };
}

export async function executePrePostCommands(property: 'commandsPreDeploy' | 'commandsPostDeploy', options: { success: boolean, checkOnly: boolean, conn: Connection, extraCommands?: any[] }) {
  const branchConfig = await getConfig('branch');
  const commands: PrePostCommand[] = [...(branchConfig[property] || []), ...(options.extraCommands || [])];
  await completeWithCommandsFromPullRequests(property, commands);
  if (commands.length === 0) {
    uxLog("log", this, c.grey(`No ${property} found to run`));
    return;
  }
  const actionLabel = property === 'commandsPreDeploy' ? 'Pre-deployment actions' : 'Post-deployment actions';
  uxLog("action", this, c.cyan(`[DeploymentActions] Found ${commands.length} ${actionLabel} to run`));
  for (const cmd of commands) {
    // If if skipIfError is true and deployment failed
    if (options.success === false && cmd.skipIfError === true) {
      uxLog("warning", this, c.yellow(`[DeploymentActions] Skipping skipIfError=true action [${cmd.id}]: ${cmd.label}`));
      cmd.result = {
        statusCode: "skipped",
        skippedReason: "skipIfError is true and deployment failed"
      };
      continue;
    }
    // Skip if we are in another context than the requested one
    const cmdContext = cmd.context || "all";
    if (cmdContext === "check-deployment-only" && options.checkOnly === false) {
      uxLog("log", this, c.grey(`[DeploymentActions] Skipping check-deployment-only action as we are in process deployment mode [${cmd.id}]: ${cmd.label}`));
      cmd.result = {
        statusCode: "skipped",
        skippedReason: "Action context is check-deployment-only but we are in process deployment mode"
      };
      continue;
    }
    if (cmdContext === "process-deployment-only" && options.checkOnly === true) {
      uxLog("log", this, c.grey(`[DeploymentActions] Skipping process-deployment-only action as we are in check deployment mode [${cmd.id}]: ${cmd.label}`));
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
        uxLog("log", this, c.grey(`[DeploymentActions] Skipping action [${cmd.id}]: ${cmd.label} because it has been defined with runOnlyOnceByOrg and has already been run on ${commandTraceRes.records[0].CreatedDate}`));
        cmd.result = {
          statusCode: "skipped",
          skippedReason: "runOnlyOnceByOrg is true and command has already been run on this org"
        };
        continue;
      }
    }
    // Run command
    uxLog("action", this, c.cyan(`[DeploymentActions] Running action [${cmd.id}]: ${cmd.label}`));
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
      uxLog("error", this, c.red(`[DeploymentActions] Action [${cmd.id}] failed, stopping execution of further actions.`));
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
      await GitProvider.managePostPullRequestComment();
      throw new SfError(`One or more ${actionLabel} have failed. See logs for more details.`);
    }
  }
}

async function completeWithCommandsFromPullRequests(property: 'commandsPreDeploy' | 'commandsPostDeploy', commands: PrePostCommand[]) {
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

async function executeAction(cmd: PrePostCommand): Promise<void> {
  switch (cmd.type) {
    case 'command':
      await executeActionCommand(cmd);
      break;
    case 'apex':
      await executeActionApex(cmd);
      break;
    case 'data':
      await executeActionData(cmd);
      break;
    case 'publish-community':
      await executeActionPublishCommunity(cmd);
      break;
    default:
      uxLog("error", this, c.yellow(`[DeploymentActions] Action type [${cmd.type}] is not yet implemented for action [${cmd.id}]: ${cmd.label}`));
      cmd.result = {
        statusCode: "failed",
        skippedReason: `Action type [${cmd.type}] is not implemented`
      };
      break;
  }
}

/* jscpd:ignore-start */
async function executeActionCommand(cmd: PrePostCommand): Promise<void> {
  const commandRes = await execCommand(cmd.command, this, { fail: false, output: true });
  if (commandRes.status === 0) {
    uxLog("success", this, c.green(`[DeploymentActions] Action [${cmd.id}] executed successfully`));
    cmd.result = {
      statusCode: "success",
      output: (commandRes.stdout || "") + "\n" + (commandRes.stderr || "")
    };
  } else {
    uxLog("error", this, c.red(`[DeploymentActions] Action [${cmd.id}] failed with status code ${commandRes.status}`));
    cmd.result = {
      statusCode: "failed",
      output: (commandRes.stdout || "") + "\n" + (commandRes.stderr || "")
    };
  }
}

async function executeActionApex(cmd: PrePostCommand): Promise<void> {
  const apexScript = cmd.parameters?.get('apexScript') || '';
  if (!apexScript) {
    uxLog("error", this, c.red(`[DeploymentActions] No apexScript parameter provided for action [${cmd.id}]: ${cmd.label}`));
    cmd.result = {
      statusCode: "failed",
      skippedReason: "No apexScript parameter provided"
    };
    return;
  }
  if (!fs.existsSync(apexScript)) {
    uxLog("error", this, c.red(`[DeploymentActions] Apex script file ${apexScript} does not exist for action [${cmd.id}]: ${cmd.label}`));
    cmd.result = {
      statusCode: "failed",
      skippedReason: `Apex script file ${apexScript} does not exist`
    };
    return;
  }
  const apexCommand = `sf apex run --file ${apexScript}`;
  const commandRes = await execCommand(apexCommand, this, { fail: false, output: true });
  if (commandRes.status === 0) {
    uxLog("success", this, c.green(`[DeploymentActions] Apex action [${cmd.id}] executed successfully`));
    cmd.result = {
      statusCode: "success",
      output: (commandRes.stdout || "") + "\n" + (commandRes.stderr || "")
    };
  } else {
    uxLog("error", this, c.red(`[DeploymentActions] Apex action [${cmd.id}] failed with status code ${commandRes.status}`));
    cmd.result = {
      statusCode: "failed",
      output: (commandRes.stdout || "") + "\n" + (commandRes.stderr || "")
    };
  }
}

async function executeActionData(cmd: PrePostCommand): Promise<void> {
  const sfdmuProject = cmd.parameters?.get('sfdmuProject') || '';
  if (!sfdmuProject) {
    uxLog("error", this, c.red(`[DeploymentActions] No sfdmuProject parameter provided for action [${cmd.id}]: ${cmd.label}`));
    cmd.result = {
      statusCode: "failed",
      skippedReason: "No sfdmuProject parameter provided"
    };
    return;
  }
  const sfdmuPath = await findDataWorkspaceByName(sfdmuProject);
  if (!sfdmuPath) {
    uxLog("error", this, c.red(`[DeploymentActions] sfdmu project ${sfdmuProject} not found for action [${cmd.id}]: ${cmd.label}`));
    cmd.result = {
      statusCode: "failed",
      skippedReason: `sfdmu project ${sfdmuProject} not found`
    };
    return;
  }
  let res: any;
  try {
    res = await importData(sfdmuPath, this);
  } catch (e) {
    uxLog("error", this, c.red(`[DeploymentActions] Data import action [${cmd.id}] failed: ${(e as Error).message}`));
    cmd.result = {
      statusCode: "failed",
      output: (e as Error).message
    };
    return;
  }
  uxLog("success", this, c.green(`[DeploymentActions] Data import action [${cmd.id}] executed successfully`));
  cmd.result = {
    statusCode: "success",
    output: (res.stdout || "") + "\n" + (res.stderr || "")
  };
}

async function executeActionPublishCommunity(cmd: PrePostCommand): Promise<void> {
  const communityName = cmd.parameters?.get('communityName') || '';
  if (!communityName) {
    uxLog("error", this, c.red(`[DeploymentActions] No communityName parameter provided for action [${cmd.id}]: ${cmd.label}`));
    cmd.result = {
      statusCode: "failed",
      skippedReason: "No communityName parameter provided"
    };
    return;
  }
  const publishCommand = `sf community publish --name "${communityName}"`;
  const commandRes = await execCommand(publishCommand, this, { fail: false, output: true });
  if (commandRes.status === 0) {
    uxLog("success", this, c.green(`[DeploymentActions] Publish community action [${cmd.id}] executed successfully`));
    cmd.result = {
      statusCode: "success",
      output: (commandRes.stdout || "") + "\n" + (commandRes.stderr || "")
    };
  } else {
    uxLog("error", this, c.red(`[DeploymentActions] Publish community action [${cmd.id}] failed with status code ${commandRes.status}`));
    cmd.result = {
      statusCode: "failed",
      output: (commandRes.stdout || "") + "\n" + (commandRes.stderr || "")
    };
  }
}
/* jscpd:ignore-end */

function manageResultMarkdownBody(property: 'commandsPreDeploy' | 'commandsPostDeploy', commands: PrePostCommand[]) {
  let markdownBody = `### ${property === 'commandsPreDeploy' ? 'Pre-deployment Actions' : 'Post-deployment Actions'} Results\n\n`;
  // Build markdown table
  markdownBody += `| ID | Label | Type | Status | Details |\n`;
  markdownBody += `|----|-------|------|--------|---------|\n`;
  for (const cmd of commands) {
    const statusIcon = cmd.result?.statusCode === "success" ? '✅' :
      cmd.result?.statusCode === "failed" ? '❌' :
        cmd.result?.statusCode === "skipped" ? '⚪' : '❓';
    const detailsLink = cmd.result?.output ? `[View Details](#command-${cmd.id})` : 'N/A';
    markdownBody += `| ${cmd.id} | ${cmd.label} | ${cmd.type} | ${statusIcon} ${cmd.result?.statusCode || 'not run'} | ${detailsLink} |\n`;
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
      markdownBody += `\n<details id="command-${cmd.id}">\n<summary>Details for command ${cmd.id} - ${cmd.label}</summary>\n\n`;
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
