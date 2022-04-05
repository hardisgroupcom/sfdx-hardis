import { uxLog } from ".";
import * as c from "chalk";
import { IncomingWebhook } from "ms-teams-webhook";
import { getConfig } from "../../config";

// Check if current process can send notifications
export async function canSendNotifications(): Promise<boolean> {
  const config = await getConfig("user");
  return (
    process.env.MS_TEAMS_WEBHOOK_URL ||
    process.env.MS_TEAMS_WEBHOOK_URL_CRITICAL ||
    process.env.MS_TEAMS_WEBHOOK_URL_SEVERE ||
    process.env.MS_TEAMS_WEBHOOK_URL_WARNING ||
    process.env.MS_TEAMS_WEBHOOK_URL_INFO ||
    config.msTeamsWebhookUrl
  );
}

// Send notification to targets defined in env variables
export async function sendNotification(options: {
  title: string;
  text?: string;
  summary?: string;
  buttons?: Array<any>;
  severity?: "critical" | "severe" | "warning" | "info";
}): Promise<any> {
  let title = options.title || "No title defined for notification";
  // Add repo & branch name in title if available and not already included
  const repoName = process.env.CI_PROJECT_NAME || null;
  const branchName = process.env.CI_COMMIT_BRANCH || null;
  let repoInfo = "";
  if (repoName && !title.includes(repoName)) {
    repoInfo += ` ${repoName}`;
  }
  if (branchName && !title.includes(branchName)) {
    repoInfo += `/${branchName}`;
  }
  if (repoInfo !== "") {
    title = repoInfo + " | " + title;
  }
  const text = options.text || "";
  const summary = options.summary || "";
  const buttons = options.buttons || [];
  const severity = options.severity || "info";
  const teamsNotif = sendMsTeamsNotification(title, text, summary, buttons, severity);
  return await Promise.all([teamsNotif]);
}

// Microsoft Teams Notification: Requires env var MS_TEAMS_WEBHOOK_URL to be defined
async function sendMsTeamsNotification(title, text, summary, buttons, severity) {
  const config = await getConfig("user");
  const hooksUrls = [];
  // Classic hook url
  const msTeamsWebhookUrl = process.env.MS_TEAMS_WEBHOOK_URL || config.msTeamsWebhookUrl;
  if (msTeamsWebhookUrl) {
    hooksUrls.push(msTeamsWebhookUrl);
  }
  // Critical hook URL
  if (severity === "critical") {
    const msTeamsCriticalHookUrl = process.env.MS_TEAMS_WEBHOOK_URL_CRITICAL || config.msTeamsWebhookUrlCritical;
    if (msTeamsCriticalHookUrl) {
      hooksUrls.push(msTeamsCriticalHookUrl);
    }
  }
  // Severe hook URL
  if (severity === "severe") {
    const msTeamsSevereHookUrl = process.env.MS_TEAMS_WEBHOOK_URL_SEVERE || config.msTeamsWebhookUrlSevere;
    if (msTeamsSevereHookUrl) {
      hooksUrls.push(msTeamsSevereHookUrl);
    }
  }
  // Warning hook URL
  if (severity === "warning") {
    const msTeamsWarningHookUrl = process.env.MS_TEAMS_WEBHOOK_URL_WARNING || config.msTeamsWebhookUrlWarning;
    if (msTeamsWarningHookUrl) {
      hooksUrls.push(msTeamsWarningHookUrl);
    }
  }
  // Info hook URL
  if (severity === "info") {
    const msTeamsInfoHookUrl = process.env.MS_TEAMS_WEBHOOK_URL_INFO || config.msTeamsWebhookUrlInfo;
    if (msTeamsInfoHookUrl) {
      hooksUrls.push(msTeamsInfoHookUrl);
    }
  }
  // Call MsTeams hooks
  for (const hookUrl of hooksUrls) {
    await sendMsTeamsHook(hookUrl, title, text, summary, buttons);
  }
}

async function sendMsTeamsHook(msTeamsWebhookUrl, title, text, summary, buttons) {
  const webhook = new IncomingWebhook(msTeamsWebhookUrl);
  const teamsHookData = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    summary: summary,
    themeColor: "0078D7",
    title: title,
    text: text,
    potentialAction: buttons.map((btnInfo) => {
      const btnTeams = {
        "@type": "OpenUri",
        name: btnInfo.title,
        targets: [
          {
            os: "default",
            uri: btnInfo.url,
          },
        ],
      };
      return btnTeams;
    }),
  };

  // Add link to JOB URL if provided
  if (process.env.CI_JOB_URL) {
    teamsHookData.potentialAction.push({
      "@type": "OpenUri",
      name: "View CI Job",
      targets: [
        {
          os: "default",
          uri: process.env.CI_JOB_URL,
        },
      ],
    });
  }
  await webhook.send(JSON.stringify(teamsHookData));
  uxLog(this, c.grey("Sent Ms Teams notification to " + msTeamsWebhookUrl + " : " + teamsHookData.title));
}
