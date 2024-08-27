/* jscpd:ignore-start */

import * as os from "os";
import { checkSfdxPlugin, git, uxLog, isCI, checkAppDependency, isGitRepo } from "../../common/utils";
import { getConfig } from "../../config";

export const hook = async (options: any) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.Command?.id || "";
  if (!commandId.startsWith("hardis")) {
    return;
  }
  if (commandId.startsWith("hardis:doc") || commandId.startsWith("hardis:org:files") || commandId.startsWith("hardis:org:data")) {
    return;
  }

  /* jscpd:ignore-end */
  // Check Git config and complete it if necessary (asynchronously so the script is not stopped)
  if (!isCI && isGitRepo()) {
    git()
      .listConfig()
      .then(async (gitConfig) => {
        const allConfigs = gitConfig.all;
        // User
        if (allConfigs["user.name"] == null) {
          const username = os.userInfo().username;
          await git({ output: true }).addConfig("user.name", username);
          uxLog(this, `Defined ${username} as git user.name`);
        }
        // Email
        if (allConfigs["user.email"] == null) {
          const config = await getConfig("user");
          const email = config.userEmail || "default@cloudity.com";
          await git({ output: true }).addConfig("user.email", email);
          uxLog(this, `Defined ${email} as git user.email` + (email === "default@cloudity.com") ? " (temporary)" : "");
        }
        // Manage special characters in git file / folder names
        if (allConfigs["core.quotepath"] == null || allConfigs["core.quotepath"] == "true") {
          await git({ output: true }).addConfig("core.quotepath", "false");
          uxLog(this, `Defined "false" as git core.quotepath`);
        }
        // Merge tool
        if (allConfigs["merge.tool"] == null) {
          await git({ output: true }).addConfig("merge.tool", "vscode");
          await git({ output: true }).addConfig("mergetool.vscode.cmd", "code --wait $MERGED");
          uxLog(this, "Defined vscode as git merge tool ");
        }
        // Diff tool
        if (allConfigs["diff.tool"] == null) {
          await git({ output: true }).addConfig("diff.tool", "vscode");
          await git({ output: true }).addConfig("difftool.vscode.cmd", "code --wait --diff $LOCAL $REMOTE");
          uxLog(this, "Defined vscode as git diff tool ");
        }
      });
  }

  // Check required sfdx-plugins to be installed
  const requiresSfdxPlugins = options?.Command?.requiresSfdxPlugins || [];
  for (const sfdxPluginName of requiresSfdxPlugins) {
    await checkSfdxPlugin(sfdxPluginName);
  }

  // Check required dependencies installed
  const requiresDependencies = options?.Command?.requiresDependencies || [];
  requiresDependencies.push("git");
  for (const appName of requiresDependencies) {
    await checkAppDependency(appName);
  }
};
