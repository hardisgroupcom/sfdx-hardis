import { getConfig } from '../../config/index.js';
import { prompts } from './prompts.js';
import c from 'chalk';
import fs from "fs-extra";
import * as path from "path";
import sortArray from 'sort-array';
import {
  arrayUniqueByKey,
  arrayUniqueByKeys,
  execCommand,
  execSfdxJson,
  extractRegexMatches,
  getCurrentGitBranch,
  getGitRepoRoot,
  getGitRepoUrl,
  git,
  gitFetch,
  uxLog,
} from './index.js';
import { CommonPullRequestInfo, GitProvider } from '../gitProvider/index.js';
import { Ticket, TicketProvider } from '../ticketProvider/index.js';
import { DefaultLogFields, ListLogLine } from 'simple-git';
import { flowDiffToMarkdownForPullRequest } from '../gitProvider/utilsMarkdown.js';
import { MessageAttachment } from '@slack/types';
import { getBranchMarkdown, getNotificationButtons, getOrgMarkdown } from './notifUtils.js';
import { NotifProvider, UtilsNotifs } from '../notifProvider/index.js';
import { setConnectionVariables } from './orgUtils.js';
import { WebSocketClient } from '../websocketClient.js';
import { countPackageXmlItems } from './xmlUtils.js';

export async function selectTargetBranch(options: { message?: string } = {}) {
  const gitUrl = await getGitRepoUrl() || '';
  const message =
    options.message ||
    `What will be the target branch of your new User Story ? (the branch where you will make your ${GitProvider.getMergeRequestName(gitUrl)} after the User Story is completed)`;
  const config = await getConfig('user');
  const availableTargetBranches = config.availableTargetBranches || null;
  // There is only once choice so return it
  if (availableTargetBranches === null && config.developmentBranch) {
    uxLog("action", this, c.cyan(`Automatically selected target branch is ${c.green(config.developmentBranch)}`));
    return config.developmentBranch;
  }

  // Request info to build branch name. ex features/config/MYTASK
  const response = await prompts([
    {
      type: availableTargetBranches ? 'select' : 'text',
      name: 'targetBranch',
      message: c.cyanBright(message),
      description: availableTargetBranches ? 'Choose the target branch for this operation' : 'Enter the name of the target branch',
      placeholder: availableTargetBranches ? undefined : 'Ex: integration',
      choices: availableTargetBranches
        ? availableTargetBranches.map((branch) => {
          return {
            title: branch.includes(',') ? branch.split(',').join(' - ') : branch,
            value: branch.includes(',') ? branch.split(',')[0] : branch,
          };
        })
        : [],
      initial: config.developmentBranch || 'integration',
    },
  ]);
  const targetBranch = response.targetBranch || 'integration';
  return targetBranch;
}

export async function getGitDeltaScope(currentBranch: string, targetBranch: string) {
  try {
    await gitFetch(['origin', `${targetBranch}:${targetBranch}`]);
  } catch (e) {
    uxLog(
      "other",
      this,
      `[Warning] Unable to fetch target branch ${targetBranch} to prepare call to sfdx-git-delta\n` +
      JSON.stringify(e)
    );
  }
  try {
    await gitFetch(['origin', `${currentBranch}:${currentBranch}`]);
  } catch (e) {
    uxLog(
      "other",
      this,
      `[Warning] Unable to fetch current branch ${currentBranch} to prepare call to sfdx-git-delta\n` +
      JSON.stringify(e)
    );
  }
  const logResult = await git().log([`${targetBranch}..${currentBranch}`]);
  const toCommit = logResult.latest;
  const mergeBaseCommand = `git merge-base ${targetBranch} ${currentBranch}`;
  const mergeBaseCommandResult = await execCommand(mergeBaseCommand, this, {
    fail: true,
  });
  const masterBranchLatestCommit = mergeBaseCommandResult.stdout.replace('\n', '').replace('\r', '');
  return { fromCommit: masterBranchLatestCommit, toCommit: toCommit, logResult: logResult };
}

export async function callSfdxGitDelta(from: string, to: string, outputDir: string, options: any = {}) {
  const packageXmlGitDeltaCommand = `sf sgd:source:delta --from "${from}" --to "${to}" --output ${outputDir} --ignore-whitespace`;
  const gitDeltaCommandRes = await execSfdxJson(packageXmlGitDeltaCommand, this, {
    output: true,
    fail: false,
    debug: options?.debugMode || false,
    cwd: await getGitRepoRoot(),
  });
  // Send results to UI if there is one
  if (WebSocketClient.isAliveWithLwcUI()) {
    const deltaPackageXml = path.join(outputDir, 'package', 'package.xml');
    const deltaPackageXmlExists = await fs.exists(deltaPackageXml);
    if (deltaPackageXmlExists) {
      const deltaNumberOfItems = await countPackageXmlItems(deltaPackageXml);
      if (deltaNumberOfItems > 0) {
        WebSocketClient.sendReportFileMessage(deltaPackageXml, `Git Delta package.xml (${deltaNumberOfItems})`, "report");
      }
    }
    const deltaDestructiveChangesXml = path.join(outputDir, 'destructiveChanges', 'destructiveChanges.xml');
    const deltaDestructiveChangesXmlExists = await fs.exists(deltaDestructiveChangesXml);
    if (deltaDestructiveChangesXmlExists) {
      const deltaDestructiveChangesNumberOfItems = await countPackageXmlItems(deltaDestructiveChangesXml);
      if (deltaDestructiveChangesNumberOfItems > 0) {
        WebSocketClient.sendReportFileMessage(deltaDestructiveChangesXml, `Git Delta destructiveChanges.xml (${deltaDestructiveChangesNumberOfItems})`, "report");
      }
    }
  }
  return gitDeltaCommandRes;
}

export function getPullRequestData(): any {
  return globalThis.pullRequestData || {};
}

export function setPullRequestData(prData: any): void {
  globalThis.pullRequestData = Object.assign(globalThis.pullRequestData || {}, prData);
}

export async function computeCommitsSummary(checkOnly, pullRequestInfo: CommonPullRequestInfo | null = null) {
  uxLog("action", this, c.cyan('Computing commits summary...'));
  const currentGitBranch = await getCurrentGitBranch();
  let logResults: (DefaultLogFields & ListLogLine)[] = [];
  let previousTargetBranchCommit = "";
  if (checkOnly || GitProvider.isDeployBeforeMerge()) {
    const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
    const deltaScope = await getGitDeltaScope(
      prInfo?.sourceBranch || currentGitBranch || "",
      prInfo?.targetBranch || process.env.FORCE_TARGET_BRANCH || ""
    );
    logResults = [...deltaScope.logResult.all];
    previousTargetBranchCommit = deltaScope.fromCommit;
  } else {
    const logRes = await git().log([`HEAD^..HEAD`]);
    previousTargetBranchCommit = "HEAD^"
    logResults = [...logRes.all];
  }
  logResults = arrayUniqueByKeys(logResults, ['message', 'body']).reverse();
  let commitsSummary = '## Commits summary\n\n';
  const manualActions: any[] = [];
  const tickets: Ticket[] = [];
  for (const logResult of logResults) {
    commitsSummary += '**' + logResult.message + '**, by ' + logResult.author_name;
    if (logResult.body) {
      commitsSummary += '<br/>' + logResult.body + '\n\n';
      await collectTicketsAndManualActions(
        currentGitBranch + '\n' + logResult.message + '\n' + logResult.body,
        tickets,
        manualActions,
        {
          commits: [logResult],
        }
      );
    } else {
      await collectTicketsAndManualActions(currentGitBranch + '\n' + logResult.message, tickets, manualActions, {
        commits: [logResult],
      });
      commitsSummary += '\n\n';
    }
  }

  // Tickets and references can also be in PR description
  if (pullRequestInfo) {
    const prText = (pullRequestInfo.title || '') + (pullRequestInfo.description || '');
    await collectTicketsAndManualActions(currentGitBranch + '\n' + prText, tickets, manualActions, {
      pullRequestInfo: pullRequestInfo,
    });
  }

  // Unify and sort tickets
  const ticketsSorted: Ticket[] = sortArray(arrayUniqueByKey(tickets, 'id'), { by: ['id'], order: ['asc'] });
  uxLog("log", this, c.grey(`[TicketProvider] Found ${ticketsSorted.length} tickets in commit bodies`));
  // Try to contact Ticketing servers to gather more info
  await TicketProvider.collectTicketsInfo(ticketsSorted);

  // Add manual actions in markdown
  const manualActionsSorted = [...new Set(manualActions)].reverse();
  if (manualActionsSorted.length > 0) {
    let manualActionsMarkdown = '## Manual actions\n\n';
    for (const manualAction of manualActionsSorted) {
      manualActionsMarkdown += '- ' + manualAction + '\n';
    }
    commitsSummary = manualActionsMarkdown + '\n\n' + commitsSummary;
  }

  // Add tickets in markdown
  if (ticketsSorted.length > 0) {
    let ticketsMarkdown = '## Tickets\n\n';
    for (const ticket of ticketsSorted) {
      if (ticket.foundOnServer) {
        ticketsMarkdown += '- [' + ticket.id + '](' + ticket.url + ') ' + ticket.subject;
        if (ticket.statusLabel) {
          ticketsMarkdown += ' (' + ticket.statusLabel + ')';
        }
        ticketsMarkdown += '\n'
      } else {
        ticketsMarkdown += '- [' + ticket.id + '](' + ticket.url + ')\n';
      }
    }
    commitsSummary = ticketsMarkdown + '\n\n' + commitsSummary;
  }

  // Add Flow diff in Markdown
  let flowDiffMarkdown: any = {};
  if ((checkOnly || GitProvider.isDeployBeforeMerge()) && !(process.env?.SFDX_DISABLE_FLOW_DIFF === "true")) {
    const flowList: string[] = [];
    for (const logResult of logResults) {
      const updatedFiles = await getCommitUpdatedFiles(logResult.hash);
      for (const updatedFile of updatedFiles) {
        if (updatedFile.endsWith(".flow-meta.xml")) {
          if (fs.existsSync(updatedFile)) {
            const flowName = path.basename(updatedFile, ".flow-meta.xml");
            flowList.push(flowName);
          }
          else {
            uxLog("warning", this, c.yellow(`[FlowGitDiff] Unable to find Flow file ${updatedFile} (probably has been deleted)`));
          }
        }
      }
    }
    const flowListUnique = [...new Set(flowList)].sort();
    // Truncate flows to the only 30 ones, to avoid flooding the pull request comments
    let truncatedNb = 0;
    const maxFlowsToShow = parseInt(process.env?.MAX_FLOW_DIFF_TO_SHOW || "30");
    if (flowListUnique.length > maxFlowsToShow) {
      truncatedNb = flowListUnique.length - maxFlowsToShow;
      flowListUnique.splice(maxFlowsToShow, flowListUnique.length - maxFlowsToShow);
      uxLog("warning", this, c.yellow(`[FlowGitDiff] Truncated flow list to 30 flows to avoid flooding Pull Request comments`));
      uxLog("warning", this, c.yellow(`[FlowGitDiff] If you want to see the diff of truncated flows, use the VS Code SFDX Hardis extension 😊`));
    }
    flowDiffMarkdown = await flowDiffToMarkdownForPullRequest(flowListUnique, previousTargetBranchCommit, (logResults.at(-1) || logResults[0]).hash, truncatedNb);
  }

  return {
    markdown: commitsSummary,
    logResults: logResults,
    manualActions: manualActionsSorted,
    tickets: ticketsSorted,
    flowDiffMarkdown: flowDiffMarkdown
  };
}

async function collectTicketsAndManualActions(str: string, tickets: Ticket[], manualActions: any[], options: any) {
  const foundTickets = await TicketProvider.getProvidersTicketsFromString(str, options);
  tickets.push(...foundTickets);
  // Extract manual actions if defined
  const manualActionsRegex = /MANUAL ACTION:(.*)/gm;
  const manualActionsMatches = await extractRegexMatches(manualActionsRegex, str);
  manualActions.push(...manualActionsMatches);
}

export async function getCommitUpdatedFiles(commitHash) {
  const result = await git().show(["--name-only", "--pretty=format:", commitHash]);
  // Split the result into lines (file paths) and remove empty lines
  const files = result.split('\n').filter(file => file.trim() !== '' && fs.existsSync(file));
  return files;
}

export async function buildCheckDeployCommitSummary() {
  try {
    const pullRequestInfo = await GitProvider.getPullRequestInfo({ useCache: true });
    const commitsSummary = await computeCommitsSummary(true, pullRequestInfo);
    const prDataCommitsSummary = {
      commitsSummary: commitsSummary.markdown,
      flowDiffMarkdown: commitsSummary.flowDiffMarkdown
    };
    setPullRequestData(prDataCommitsSummary);
  } catch (e3) {
    uxLog("warning", this, c.yellow('Unable to compute git summary:\n' + e3));
  }
}

export async function handlePostDeploymentNotifications(flags, targetUsername: any, quickDeploy: any, delta: boolean, debugMode: boolean, additionalMessage = "") {
  const pullRequestInfo = await GitProvider.getPullRequestInfo({ useCache: true });
  const attachments: MessageAttachment[] = [];
  try {
    // Build notification attachments & handle ticketing systems comments
    const commitsSummary = await collectNotifAttachments(attachments, pullRequestInfo);
    await TicketProvider.postDeploymentActions(
      commitsSummary.tickets,
      flags['target-org']?.getConnection()?.instanceUrl || targetUsername || '',
      pullRequestInfo
    );
  } catch (e4: any) {
    uxLog(
      "warning",
      this,
      c.yellow('Unable to handle commit info on TicketProvider post deployment actions:\n' + e4.message) +
      '\n' +
      c.gray(e4.stack)
    );
  }

  const orgMarkdown = await getOrgMarkdown(
    flags['target-org']?.getConnection()?.instanceUrl || targetUsername || ''
  );
  const branchMarkdown = await getBranchMarkdown();
  let notifMessage = `Deployment has been successfully processed from branch ${branchMarkdown} to org ${orgMarkdown}`;
  notifMessage += quickDeploy
    ? ' (🚀 quick deployment)'
    : delta
      ? ' (🌙 delta deployment)'
      : ' (🌕 full deployment)';
  if (additionalMessage) {
    notifMessage += '\n\n' + additionalMessage + "\n\n"
  }

  const notifButtons = await getNotificationButtons();
  if (pullRequestInfo) {
    if (debugMode) {
      uxLog("error", this, c.grey('PR info:\n' + JSON.stringify(pullRequestInfo)));
    }
    const prAuthor = pullRequestInfo?.authorName;
    notifMessage += `\nRelated: <${pullRequestInfo.webUrl}|${pullRequestInfo.title}>` + (prAuthor ? ` by ${prAuthor}` : '');
    const prButtonText = 'View Pull Request';
    notifButtons.push({ text: prButtonText, url: pullRequestInfo.webUrl });
  } else {
    uxLog("warning", this, c.yellow("WARNING: Unable to get Pull Request info, notif won't have a button URL"));
  }
  await setConnectionVariables(flags['target-org']?.getConnection(), true);// Required for some notifications providers like Email
  await NotifProvider.postNotifications({
    type: 'DEPLOYMENT',
    text: notifMessage,
    buttons: notifButtons,
    severity: 'success',
    attachments: attachments,
    logElements: [],
    data: { metric: 0 }, // Todo: if delta used, count the number of items deployed
    metrics: {
      DeployedItems: 0,
    },
  });
}


async function collectNotifAttachments(attachments: MessageAttachment[], pullRequestInfo: CommonPullRequestInfo | null) {
  const commitsSummary = await computeCommitsSummary(false, pullRequestInfo);
  // Tickets attachment
  if (commitsSummary.tickets.length > 0) {
    attachments.push({
      text: `*Tickets*\n${commitsSummary.tickets
        .map((ticket) => {
          if (ticket.foundOnServer) {
            let ticketsMarkdown = '• ' + UtilsNotifs.markdownLink(ticket.url, ticket.id) + ' ' + ticket.subject;
            if (ticket.statusLabel) {
              ticketsMarkdown += ' (' + ticket.statusLabel + ')';
            }
            return ticketsMarkdown;
          } else {
            return '• ' + UtilsNotifs.markdownLink(ticket.url, ticket.id);
          }
        })
        .join('\n')}`,
    });
  }
  // Manual actions attachment
  if (commitsSummary.manualActions.length > 0) {
    attachments.push({
      text: `*Manual actions*\n${commitsSummary.manualActions
        .map((manualAction) => {
          return '• ' + manualAction;
        })
        .join('\n')}`,
    });
  }
  // Commits attachment
  if (commitsSummary.logResults.length > 0) {
    attachments.push({
      text: `*Commits*\n${commitsSummary.logResults
        .map((logResult) => {
          return '• ' + logResult.message + ', by ' + logResult.author_name;
        })
        .join('\n')}`,
    });
  }
  return commitsSummary;
}

export function makeFileNameGitCompliant(fileName: string) {
  // Remove all characters that are not alphanumeric, underscore, hyphen, space or dot
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9_. -]/g, '_');
  return sanitizedFileName;
}

export function getFileAtCommit(commit: string, filePath: string) {
  return git().show([`${commit}:${filePath}`]);
}