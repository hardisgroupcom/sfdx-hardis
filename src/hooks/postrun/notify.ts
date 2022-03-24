import * as changedGitFiles from "changed-git-files";
import * as c from "chalk";
import { elapseEnd, isGitRepo, uxLog } from "../../common/utils";
import { canSendNotifications, sendNotification } from "../../common/utils/notifUtils";

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
    const diffFiles = await listChangedFiles();
    // No notif if no updated file
    if (diffFiles.length === 0) {
      return;
    }
    // Send WebHook
    const jobUrl = process.env.CI_JOB_URL || "Missing CI_JOB_URL variable";
    const projectName = process.env.CI_PROJECT_NAME || "Missing CI_PROJECT_NAME variable";
    const branchName = process.env.CI_COMMIT_REF_NAME || "Missing CI_COMMIT_REF_NAME variable";
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

// List updated files and reformat them as string
async function listChangedFiles(): Promise<string[]> {
  if (!isGitRepo()) {
    return [];
  }
  const files = await new Promise<string[]>((resolve) => {
    changedGitFiles((err: any, result: any[]) => {
      if (result == null) {
        console.warn(JSON.stringify(err, null, 2));
        resolve([]);
      }
      resolve(result);
    });
  });
  const filesTextLines = files
    .sort((a: any, b: any) => (a.filename > b.filename ? 1 : -1))
    .map((fileInfo: any) => `${fileInfo.status} - ${fileInfo.filename}`);
  return filesTextLines;
}
