import * as changedGitFiles from "changed-git-files";
import { IncomingWebhook } from "ms-teams-webhook";
import { elapseEnd, isGitRepo } from "../../common/utils";
import { getConfig } from "../../config";

export const hook = async (options: any) => {
  if (globalThis.hardisLogFileStream) {
    globalThis.hardisLogFileStream.end();
    globalThis.hardisLogFileStream = null ;
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
    globalThis.webSocketClient.dispose();
    globalThis.webSocketClient = null;
  }

  // Send hook to microsoft ?teams if MS_TEAMS_WEBHOOK_URL env var is set, or msTeamsWebhookUrl in config
  const config = await getConfig("user");
  const msTeamsWebhookUrl = process.env.MS_TEAMS_WEBHOOK_URL || config.msTeamsWebhookUrl;
  if (msTeamsWebhookUrl && options?.Command?.triggerNotification === true) {
    const diffFiles = await listChangedFiles();
    // No notif if no updated file
    if (diffFiles.length === 0) {
      return;
    }
    // Send WebHook
    const webhook = new IncomingWebhook(msTeamsWebhookUrl);
    const jobUrl = process.env.CI_JOB_URL || "Missing CI_JOB_URL variable";
    const projectName = process.env.CI_PROJECT_NAME || "Missing CI_PROJECT_NAME variable";
    const branchName = process.env.CI_COMMIT_REF_NAME || "Missing CI_COMMIT_REF_NAME variable";
    const envName = projectName + "/" + branchName;
    await webhook.send(
      JSON.stringify({
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        summary: `Changes on metadatas has been detected on ${envName}. You may want to have a look !`,
        themeColor: "0078D7",
        title: `Updates detected in org ${envName}`,
        text: `<pre>${diffFiles.join("\n")}</pre>`,
        potentialAction: [
          {
            "@type": "OpenUri",
            name: "View commit",
            targets: [
              {
                os: "default",
                uri: jobUrl,
              },
            ],
          },
        ],
      })
    );
    console.info("[sfdx-hardis] Sent notification to MsTeams channel");
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
