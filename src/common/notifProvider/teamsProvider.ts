import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot";
import { getCurrentGitBranch, uxLog } from "../utils";
import { NotifMessage, UtilsNotifs } from ".";
import { IncomingWebhook } from "ms-teams-webhook";
import { getEnvVar } from "../../config";

export class TeamsProvider extends NotifProviderRoot {
  public getLabel(): string {
    return "sfdx-hardis MsTeams connector";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(notifMessage: NotifMessage): Promise<void> {
    const mainTeamsHook = getEnvVar("MS_TEAMS_WEBHOOK_URL");
    if (mainTeamsHook == null) {
      throw new SfdxError("[MsTeamsProvider] You need to define a variable MS_TEAMS_WEBHOOK_URL to use sfdx-hardis MsTeams Integration");
    }
    const teamsHooks = mainTeamsHook.split(",");
    // Add branch custom Teams channel if defined
    const customMSTeamsChannelVariable = `MS_TEAMS_WEBHOOK_URL_${(await getCurrentGitBranch()).toUpperCase()}`;
    if (getEnvVar(customMSTeamsChannelVariable)) {
      teamsHooks.push(...getEnvVar(customMSTeamsChannelVariable).split(","));
    }

    // Handle specific channel for Warnings and errors
    const warningsErrorsChannelId = getEnvVar("MS_TEAMS_WEBHOOK_URL_ERRORS_WARNINGS");
    if (warningsErrorsChannelId && ["critical", "error", "warning"].includes(notifMessage.severity || null)) {
      teamsHooks.push(...warningsErrorsChannelId.split(","));
    }

    // Main block
    const initText =
      "## " + UtilsNotifs.prefixWithSeverityEmoji(UtilsNotifs.slackToTeamsMarkdown(notifMessage.text) + "\n\n", notifMessage.severity) + "\n\n";
    const teamsHookData: any = {
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      themeColor: "0078D7",
      text: initText,
      potentialAction: [],
    };
    // Add text details
    if (notifMessage?.attachments?.length > 0) {
      let text = "";
      for (const attachment of notifMessage.attachments) {
        if (attachment.text) {
          text = attachment.text + "\n";
        }
      }
      if (text !== "") {
        teamsHookData.text += "\n\n\n\n" + UtilsNotifs.slackToTeamsMarkdown(text);
      }
    }

    // Add action blocks
    if (notifMessage.buttons?.length > 0) {
      for (const button of notifMessage.buttons) {
        // Url button
        if (button.url) {
          const btnTeams = {
            "@type": "OpenUri",
            name: button.text,
            targets: [
              {
                os: "default",
                uri: button.url,
              },
            ],
          };
          teamsHookData.potentialAction.push(btnTeams);
        }
      }
    }
    // Post messages
    for (const hookUrl of teamsHooks) {
      try {
        const webhook = new IncomingWebhook(hookUrl);
        const response = await webhook.send(teamsHookData);
        uxLog(this, c.gray(`[MsTeamsProvider] Sent Ms Teams notification to Web Hook ${hookUrl}: ${response.text}`));
      } catch (error) {
        uxLog(this, c.gray("[MsTeamsProvider] " + JSON.stringify(teamsHookData, null, 2)));
        uxLog(this, c.red(`[MsTeamsProvider] Error while sending Teams notification to Web Hook ${hookUrl}\n${JSON.stringify(error)}`));
      }
    }
    return;
  }
}
