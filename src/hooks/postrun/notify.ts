import * as c from "chalk";
import { elapseEnd, getCurrentGitBranch, getGitRepoName, uxLog } from "../../common/utils";
import { canSendNotifications, sendNotification } from "../../common/utils/notifUtils";
import { MetadataUtils } from "../../common/metadata-utils";

export const hook = async (options: any) => {
  if (globalThis.hardisLogFileStream) {
    globalThis.hardisLogFileStream.end();
    globalThis.hardisLogFileStream = null;
  }

  // Skip hooks from other commands than hardis commands
  const commandId = options?.Command?.id || "";
  if (!commandId.startsWith("hardis")) {
    return;
  }
  elapseEnd(`${options?.Command?.id} execution time`);
  if (commandId.startsWith("hardis:doc")) {
    return;
  }

  // Close WebSocketClient if existing
  if (globalThis.webSocketClient) {
    try {
      globalThis.webSocketClient.dispose();
    } catch (e) {
      uxLog(this, c.yellow("Unable to close webSocketClient") + "\n" + e.message);
    }
    globalThis.webSocketClient = null;
  }

  // Send hook to microsoft ?teams if MS_TEAMS_WEBHOOK_URL env var is set, or msTeamsWebhookUrl in config
  if ((await canSendNotifications()) && options?.Command?.triggerNotification === true) {
    const diffFiles = await MetadataUtils.listChangedFiles();
    // No notif if no updated file
    if (diffFiles.length === 0) {
      return;
    }
    // Send WebHook
    const jobUrl = process.env.CI_JOB_URL || "Missing CI_JOB_URL variable";
    const projectName = process.env.CI_PROJECT_NAME || (await getGitRepoName()) || "Missing CI_PROJECT_NAME variable";
    const branchName = process.env.CI_COMMIT_REF_NAME || (await getCurrentGitBranch({ formatted: true })) || "Missing CI_COMMIT_REF_NAME variable";
    const envName = projectName + "/" + branchName;
    await sendNotification({
      title: `Updates detected in org ${envName}`,
      text: `<pre>${diffFiles.join("\n")}</pre>`,
      summary: `Changes on metadatas has been detected on ${envName}. You may want to have a look !`,
      buttons: [{ title: "View commit", url: jobUrl }],
      severity: "info",
    });
  }
};

