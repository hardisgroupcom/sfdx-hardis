import { uxLog } from ".";
import * as c from "chalk";
import { IncomingWebhook } from "ms-teams-webhook";
import { getConfig } from "../../config";

// Check if current process can send notifications
export async function canSendNotifications(): Promise<boolean> {
  const config = await getConfig("user");
  return process.env.MS_TEAMS_WEBHOOK_URL || config.msTeamsWebhookUrl;
}

// Send notification to targets defined in env variables
export async function sendNotification(options: { title: string; text?: string; summary?: string; buttons?: Array<any> }): Promise<any> {
  const title = options.title || "No title defined for notification";
  const text = options.text || "";
  const summary = options.summary || "";
  const buttons = options.buttons || [];
  const teamsNotif = sendMsTeamsNotification(title, text, summary, buttons);
  return await Promise.all([teamsNotif]);
}

// Microsoft Teams Notification: Requires env var MS_TEAMS_WEBHOOK_URL to be defined
async function sendMsTeamsNotification(title, text, summary, buttons) {
  const config = await getConfig("user");
  const msTeamsWebhookUrl = process.env.MS_TEAMS_WEBHOOK_URL || config.msTeamsWebhookUrl;
  if (msTeamsWebhookUrl === null) {
    return;
  }
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
      name: "CI Job",
      targets: [
        {
          os: "default",
          uri: process.env.CI_JOB_URL,
        },
      ],
    });
  }
  await webhook.send(JSON.stringify(teamsHookData));
  uxLog(this, c.grey("Sent Ms Teams notification: " + teamsHookData.title));
}
