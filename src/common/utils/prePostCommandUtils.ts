import { Connection } from '@salesforce/core';
import c from 'chalk';
import fs from 'fs-extra';
import yaml from 'js-yaml';

import * as path from 'path';
import { getConfig } from '../../config/index.js';
import { execCommand, uxLog } from './index.js';
import { GitProvider } from '../gitProvider/index.js';
import { checkSfdxHardisTraceAvailable, listMajorOrgs } from './orgConfigUtils.js';
import { soqlQuery } from './apiUtils.js';


export async function executePrePostCommands(property: 'commandsPreDeploy' | 'commandsPostDeploy', options: { success: boolean, checkOnly: boolean, conn: Connection, extraCommands?: any[] }) {
  const branchConfig = await getConfig('branch');
  const commands = [...(branchConfig[property] || []), ...(options.extraCommands || [])];
  await completeWithCommandsFromPullRequests(property, commands);
  if (commands.length === 0) {
    uxLog("log", this, c.grey(`No ${property} found to run`));
    return;
  }
  uxLog("action", this, c.cyan(`Processing ${property} found in .sfdx-hardis.yml configuration...`));
  for (const cmd of commands) {
    // If if skipIfError is true and deployment failed
    if (options.success === false && cmd.skipIfError === true) {
      uxLog("warning", this, c.yellow(`Skipping skipIfError=true command [${cmd.id}]: ${cmd.label}`));
      continue;
    }
    // Skip if we are in another context than the requested one
    const cmdContext = cmd.context || "all";
    if (cmdContext === "check-deployment-only" && options.checkOnly === false) {
      uxLog("log", this, c.grey(`Skipping check-deployment-only command as we are in process deployment mode [${cmd.id}]: ${cmd.label}`));
      continue;
    }
    if (cmdContext === "process-deployment-only" && options.checkOnly === true) {
      uxLog("log", this, c.grey(`Skipping process-deployment-only command as we are in check deployment mode [${cmd.id}]: ${cmd.label}`));
      continue;
    }
    const runOnlyOnceByOrg = cmd.runOnlyOnceByOrg || false;
    if (runOnlyOnceByOrg) {
      await checkSfdxHardisTraceAvailable(options.conn);
      const commandTraceQuery = `SELECT Id,CreatedDate FROM SfdxHardisTrace__c WHERE Type__c='${property}' AND Key__c='${cmd.id}' LIMIT 1`;
      const commandTraceRes = await soqlQuery(commandTraceQuery, options.conn);
      if (commandTraceRes?.records?.length > 0) {
        uxLog("log", this, c.grey(`Skipping command [${cmd.id}]: ${cmd.label} because it has been defined with runOnlyOnceByOrg and has already been run on ${commandTraceRes.records[0].CreatedDate}`));
        continue;
      }
    }
    // Run command
    uxLog("action", this, c.cyan(`Running [${cmd.id}]: ${cmd.label}`));
    const commandRes = await execCommand(cmd.command, this, { fail: false, output: true });
    if (commandRes.status === 0 && runOnlyOnceByOrg) {
      const hardisTraceRecord = {
        Name: property + "--" + cmd.id,
        Type__c: property,
        Key__c: cmd.id
      }
      const insertRes = await options.conn.insert("SfdxHardisTrace__c", [hardisTraceRecord]);
      if (insertRes[0].success) {
        uxLog("success", this, c.green(`Stored SfdxHardisTrace__c entry ${insertRes[0].id} with command [${cmd.id}] so it is not run again in the future (runOnlyOnceByOrg: true)`));
      }
      else {
        uxLog("error", this, c.red(`Error storing SfdxHardisTrace__c entry :` + JSON.stringify(insertRes, null, 2)));
      }
    }
  }
}

async function completeWithCommandsFromPullRequests(property: 'commandsPreDeploy' | 'commandsPostDeploy', commands: any[]) {
  const gitProvider = await GitProvider.getInstance();
  if (!gitProvider) {
    uxLog("warning", this, c.yellow('No git provider configured, skipping retrieval of commands from pull requests'));
    return;
  }
  const pullRequestInfo = await gitProvider.getPullRequestInfo();
  if (!pullRequestInfo) {
    uxLog("warning", this, c.yellow('No pull request info available, skipping retrieval of commands from pull requests'));
    return;
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
  for (const pr of pullRequests) {
    // Check if there is a .sfdx-hardis.PULL_REQUEST_ID.yml file in the PR
    const prConfigFileName = path.join("scripts", "actions", `.sfdx-hardis.${pr.idStr}.yml`);
    if (fs.existsSync(prConfigFileName)) {
      try {
        const prConfig = await fs.readFile(prConfigFileName, 'utf8');
        const prConfigParsed = yaml.load(prConfig) as any;
        if (prConfigParsed && prConfigParsed[property] && Array.isArray(prConfigParsed[property])) {
          for (const cmd of prConfigParsed[property]) {
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