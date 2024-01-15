import { getConfig } from "../../config";
import { prompts } from "./prompts";
import * as c from "chalk";
import * as sortArray from "sort-array";
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
} from ".";
import { GitProvider } from "../gitProvider";
import { Ticket, TicketProvider } from "../ticketProvider";
import { DefaultLogFields, ListLogLine } from "simple-git";

export async function selectTargetBranch(options: { message?: string } = {}) {
  const message =
    options.message ||
    "What will be the target branch of your new task ? (the branch where you will make your merge request after the task is completed)";
  const config = await getConfig("user");
  const availableTargetBranches = config.availableTargetBranches || null;
  // There is only once choice so return it
  if (availableTargetBranches === null && config.developmentBranch) {
    uxLog(this, c.cyan(`Selected target branch is ${c.green(config.developmentBranch)}`));
    return config.developmentBranch;
  }

  // Request info to build branch name. ex features/config/MYTASK
  const response = await prompts([
    {
      type: availableTargetBranches ? "select" : "text",
      name: "targetBranch",
      message: c.cyanBright(message),
      choices: availableTargetBranches
        ? availableTargetBranches.map((branch) => {
            return { title: branch, value: branch };
          })
        : [],
      initial: config.developmentBranch || "developpement",
    },
  ]);
  const targetBranch = response.targetBranch || "developpement";
  return targetBranch;
}

export async function getGitDeltaScope(currentBranch: string, targetBranch: string) {
  try {
    await git().fetch(["origin", `${targetBranch}:${targetBranch}`]);
  } catch (e) {
    uxLog(this, c.gray(`[Warning] Unable to fetch target branch ${targetBranch} to prepare call to sfdx-git-delta\n` + JSON.stringify(e)));
  }
  try {
    await git().fetch(["origin", `${currentBranch}:${currentBranch}`]);
  } catch (e) {
    uxLog(this, c.gray(`[Warning] Unable to fetch current branch ${currentBranch} to prepare call to sfdx-git-delta\n` + JSON.stringify(e)));
  }
  const logResult = await git().log([`${targetBranch}..${currentBranch}`]);
  const toCommit = logResult.latest;
  const mergeBaseCommand = `git merge-base ${targetBranch} ${currentBranch}`;
  const mergeBaseCommandResult = await execCommand(mergeBaseCommand, this, {
    fail: true,
  });
  const masterBranchLatestCommit = mergeBaseCommandResult.stdout.replace("\n", "").replace("\r", "");
  return { fromCommit: masterBranchLatestCommit, toCommit: toCommit, logResult: logResult };
}

export async function callSfdxGitDelta(from: string, to: string, outputDir: string, options: any = {}) {
  const sgdHelp = (await execCommand(" sfdx sgd:source:delta --help", this, { fail: false, output: false, debug: options?.debugMode || false }))
    .stdout;
  const packageXmlGitDeltaCommand =
    `sfdx sgd:source:delta --from "${from}" --to "${to}" --output ${outputDir}` +
    (sgdHelp.includes("--ignore-whitespace") ? " --ignore-whitespace" : "");
  const gitDeltaCommandRes = await execSfdxJson(packageXmlGitDeltaCommand, this, {
    output: true,
    fail: false,
    debug: options?.debugMode || false,
    cwd: await getGitRepoRoot(),
  });
  return gitDeltaCommandRes;
}

export async function computeCommitsSummary(checkOnly, pullRequestInfo: any) {
  uxLog(this, c.cyan("Computing commits summary..."));
  const currentGitBranch = await getCurrentGitBranch();
  let logResults: (DefaultLogFields & ListLogLine)[] = [];
  if (checkOnly) {
    const prInfo = await GitProvider.getPullRequestInfo();
    const deltaScope = await getGitDeltaScope(prInfo?.sourceBranch || currentGitBranch, prInfo?.targetBranch || process.env.FORCE_TARGET_BRANCH);
    logResults = [...deltaScope.logResult.all];
  } else {
    const logRes = await git().log([`HEAD^..HEAD`]);
    logResults = [...logRes.all];
  }
  logResults = arrayUniqueByKeys(logResults, ["message", "body"]).reverse();
  let commitsSummary = "## Commits summary\n\n";
  const manualActions = [];
  const tickets: Ticket[] = [];
  for (const logResult of logResults) {
    commitsSummary += "**" + logResult.message + "**, by " + logResult.author_name;
    if (logResult.body) {
      commitsSummary += "<br/>" + logResult.body + "\n\n";
      await collectTicketsAndManualActions(logResult.message + "\n" + logResult.body, tickets, manualActions, { commits: [logResult] });
    } else {
      await collectTicketsAndManualActions(logResult.message, tickets, manualActions, { commits: [logResult] });
      commitsSummary += "\n\n";
    }
  }

  // Tickets and references can also be in PR description
  if (pullRequestInfo) {
    const prText = (pullRequestInfo.title || "") + (pullRequestInfo.description || "");
    await collectTicketsAndManualActions(prText, tickets, manualActions, { pullRequestInfo: pullRequestInfo });
  }

  // Unify and sort tickets
  const ticketsSorted = sortArray(arrayUniqueByKey(tickets, "id"), { by: ["id"], order: ["asc"] });
  uxLog(this, c.grey(`[TicketProvider] Found ${ticketsSorted.length} tickets in commit bodies`));
  // Try to contact Ticketing servers to gather more info
  await TicketProvider.collectTicketsInfo(ticketsSorted);

  // Add manual actions in markdown
  const manualActionsSorted = [...new Set(manualActions)].reverse();
  if (manualActionsSorted.length > 0) {
    let manualActionsMarkdown = "## Manual actions\n\n";
    for (const manualAction of manualActionsSorted) {
      manualActionsMarkdown += "- " + manualAction + "\n";
    }
    commitsSummary = manualActionsMarkdown + "\n\n" + commitsSummary;
  }

  // Add tickets in markdown
  if (ticketsSorted.length > 0) {
    let ticketsMarkdown = "## Tickets\n\n";
    for (const ticket of ticketsSorted) {
      if (ticket.foundOnServer) {
        ticketsMarkdown += "- [" + ticket.id + "](" + ticket.url + ") " + ticket.subject + "\n";
      } else {
        ticketsMarkdown += "- [" + ticket.id + "](" + ticket.url + ")\n";
      }
    }
    commitsSummary = ticketsMarkdown + "\n\n" + commitsSummary;
  }

  return {
    markdown: commitsSummary,
    logResults: logResults,
    manualActions: manualActionsSorted,
    tickets: ticketsSorted,
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
