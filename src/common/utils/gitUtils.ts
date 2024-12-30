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
  git,
  uxLog,
} from './index.js';
import { GitProvider } from '../gitProvider/index.js';
import { Ticket, TicketProvider } from '../ticketProvider/index.js';
import { DefaultLogFields, ListLogLine } from 'simple-git';
import { flowDiffToMarkdownForPullRequest } from '../gitProvider/utilsMarkdown.js';
import { MessageAttachment } from '@slack/types';
import { getBranchMarkdown, getNotificationButtons, getOrgMarkdown } from './notifUtils.js';
import { NotifProvider, UtilsNotifs } from '../notifProvider/index.js';

export async function selectTargetBranch(options: { message?: string } = {}) {
  const message =
    options.message ||
    'What will be the target branch of your new task ? (the branch where you will make your merge request after the task is completed)';
  const config = await getConfig('user');
  const availableTargetBranches = config.availableTargetBranches || null;
  // There is only once choice so return it
  if (availableTargetBranches === null && config.developmentBranch) {
    uxLog(this, c.cyan(`Selected target branch is ${c.green(config.developmentBranch)}`));
    return config.developmentBranch;
  }

  // Request info to build branch name. ex features/config/MYTASK
  const response = await prompts([
    {
      type: availableTargetBranches ? 'select' : 'text',
      name: 'targetBranch',
      message: c.cyanBright(message),
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
    await git().fetch(['origin', `${targetBranch}:${targetBranch}`]);
  } catch (e) {
    uxLog(
      this,
      c.gray(
        `[Warning] Unable to fetch target branch ${targetBranch} to prepare call to sfdx-git-delta\n` +
        JSON.stringify(e)
      )
    );
  }
  try {
    await git().fetch(['origin', `${currentBranch}:${currentBranch}`]);
  } catch (e) {
    uxLog(
      this,
      c.gray(
        `[Warning] Unable to fetch current branch ${currentBranch} to prepare call to sfdx-git-delta\n` +
        JSON.stringify(e)
      )
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
  return gitDeltaCommandRes;
}

export async function computeCommitsSummary(checkOnly, pullRequestInfo: any) {
  uxLog(this, c.cyan('Computing commits summary...'));
  const currentGitBranch = await getCurrentGitBranch();
  let logResults: (DefaultLogFields & ListLogLine)[] = [];
  let previousTargetBranchCommit = "";
  if (checkOnly || GitProvider.isDeployBeforeMerge()) {
    const prInfo = await GitProvider.getPullRequestInfo();
    const deltaScope = await getGitDeltaScope(
      prInfo?.sourceBranch || currentGitBranch,
      prInfo?.targetBranch || process.env.FORCE_TARGET_BRANCH
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
  uxLog(this, c.grey(`[TicketProvider] Found ${ticketsSorted.length} tickets in commit bodies`));
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
        ticketsMarkdown += '- [' + ticket.id + '](' + ticket.url + ') ' + ticket.subject + '\n';
      } else {
        ticketsMarkdown += '- [' + ticket.id + '](' + ticket.url + ')\n';
      }
    }
    commitsSummary = ticketsMarkdown + '\n\n' + commitsSummary;
  }

  // Add Flow diff in Markdown
  let flowDiffMarkdown: any = {};
  if (checkOnly || GitProvider.isDeployBeforeMerge() && !(process.env?.SFDX_DISABLE_FLOW_DIFF === "true")) {
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
            uxLog(this, c.yellow(`[FlowGitDiff] Unable to find Flow file ${updatedFile} (probably has been deleted)`));
          }
        }
      }
    }
    const flowListUnique = [...new Set(flowList)].sort();
    flowDiffMarkdown = await flowDiffToMarkdownForPullRequest(flowListUnique, previousTargetBranchCommit, (logResults.at(-1) || logResults[0]).hash);
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
    const pullRequestInfo = await GitProvider.getPullRequestInfo();
    const commitsSummary = await computeCommitsSummary(true, pullRequestInfo);
    const prDataCommitsSummary = {
      commitsSummary: commitsSummary.markdown,
      flowDiffMarkdown: commitsSummary.flowDiffMarkdown
    };
    globalThis.pullRequestData = Object.assign(globalThis.pullRequestData || {}, prDataCommitsSummary);
  } catch (e3) {
    uxLog(this, c.yellow('Unable to compute git summary:\n' + e3));
  }
}

export async function handlePostDeploymentNotifications(flags, targetUsername: any, quickDeploy: any, delta: boolean, debugMode: boolean) {
  const pullRequestInfo = await GitProvider.getPullRequestInfo();
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

  const notifButtons = await getNotificationButtons();
  if (pullRequestInfo) {
    if (debugMode) {
      uxLog(this, c.gray('PR info:\n' + JSON.stringify(pullRequestInfo)));
    }
    const prUrl = pullRequestInfo.web_url || pullRequestInfo.html_url || pullRequestInfo.url;
    const prAuthor = pullRequestInfo?.authorName || pullRequestInfo?.author?.login || pullRequestInfo?.author?.name || null;
    notifMessage += `\nRelated: <${prUrl}|${pullRequestInfo.title}>` + (prAuthor ? ` by ${prAuthor}` : '');
    const prButtonText = 'View Pull Request';
    notifButtons.push({ text: prButtonText, url: prUrl });
  } else {
    uxLog(this, c.yellow("WARNING: Unable to get Pull Request info, notif won't have a button URL"));
  }
  globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
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


async function collectNotifAttachments(attachments: MessageAttachment[], pullRequestInfo: any) {
  const commitsSummary = await computeCommitsSummary(false, pullRequestInfo);
  // Tickets attachment
  if (commitsSummary.tickets.length > 0) {
    attachments.push({
      text: `*Tickets*\n${commitsSummary.tickets
        .map((ticket) => {
          if (ticket.foundOnServer) {
            return '• ' + UtilsNotifs.markdownLink(ticket.url, ticket.id) + ' ' + ticket.subject;
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