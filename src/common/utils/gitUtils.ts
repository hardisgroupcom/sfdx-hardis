import { getConfig } from "../../config";
import { prompts } from "./prompts";
import * as c from "chalk";
import { uxLog } from ".";

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
