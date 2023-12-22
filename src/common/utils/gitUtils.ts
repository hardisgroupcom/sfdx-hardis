import { getConfig } from "../../config";
import { prompts } from "./prompts";
import * as c from "chalk";
import { execCommand, execSfdxJson, getCurrentGitBranch, getGitRepoRoot, git, uxLog } from ".";
import { GitProvider } from "../gitProvider";

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

export async function computeCommitsSummary() {
  const currentGitBranch = await getCurrentGitBranch();
  const prInfo = await GitProvider.getPullRequestInfo();
  const deltaScope = await getGitDeltaScope(prInfo?.sourceBranch || currentGitBranch, prInfo?.targetBranch || process.env.FORCE_TARGET_BRANCH);
  let commitsSummary = '## Commits summary\n\n';
  const manualActions = [];
  const jiraTickets = [];
  for (const logResult of deltaScope.logResult.all) {
    commitsSummary += "### " + logResult.message + ", by" + logResult.author_name + "\n\n"
    if (logResult.body) {
      commitsSummary += logResult.body + "\n\n";
      // Extract JIRAs if defined
      const httpRegex = /^https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)$/
      let m;
      while ((m = httpRegex.exec(logResult.body)) !== null) {
        if (m.index === httpRegex.lastIndex) {
          httpRegex.lastIndex++;
        }
        m.forEach((match: string) => {
          if (match.includes("jira")) {
            jiraTickets.push(match.trim());
          }
        });
      }
      // Extract manual actions if defined
      const regex = /MANUAL ACTION:(.*)/gm;
      let m2;
      while ((m2 = regex.exec(logResult.body)) !== null) {
        if (m2.index === regex.lastIndex) {
          regex.lastIndex++;
        }
        m2.forEach((match: string) => {
          manualActions.push(match.trim());
        });
      }
    }
  }
  if (manualActions.length > 0) {
    commitsSummary += '\n\n## JIRA Tickets\n\n';
    for (const jiraTicket of jiraTickets) {
      commitsSummary += "- " + jiraTicket+"\n";
    }
  }
  if (manualActions.length > 0) {
    commitsSummary += '\n\n## Manual actions\n\n';
    for (const manualAction of manualActions) {
      commitsSummary += "- " + manualAction+"\n";
    }
  }

  const prDataCommitsSummary = { commitsSummary: commitsSummary };
  globalThis.pullRequestData = Object.assign(globalThis.pullRequestData || {}, prDataCommitsSummary);
  return {
    markdown: commitsSummary,
    manualActions: manualActions
  }
}