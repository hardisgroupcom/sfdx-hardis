import { getConfig } from "../../config";
import { prompts } from "./prompts";
import * as c from "chalk";
import * as child_process from "child_process";
import { execCommand, execSfdxJson, getGitRepoRoot, uxLog } from ".";

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

export async function getParentBranch() {
  const gitGetParentCommands = [
    "git show-branch -a 2>/dev/null", //  Get git branch
    "grep '*'",
    'grep -v "$(git rev-parse --abbrev-ref HEAD)"',
    "head -n1",
    "sed 's/.*\\[\\(.*\\)\\].*/\\1/'",
    "sed 's/[\\^~].*//'",
  ];

  const res = child_process.execSync(gitGetParentCommands.join(" | "), { cwd: process.cwd() }).toString().trim();
  if (res) {
    return res;
  }
  return null;
}
