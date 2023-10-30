import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot";
import { ActionsBlock, Block, Button, SectionBlock, WebClient } from "@slack/web-api";
import { getCurrentGitBranch, uxLog } from "../utils";
import { NotifMessage, UtilsNotifs } from ".";

export class SlackProvider extends NotifProviderRoot {
  private slackClient: InstanceType<typeof WebClient>;

  constructor() {
    super();
    this.token = process.env.SLACK_TOKEN;
    this.slackClient = new WebClient(this.token);
  }

  public getLabel(): string {
    return "sfdx-hardis Slack connector";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(notifMessage: NotifMessage): Promise<void> {
    const mainNotifsChannelId = process.env.SLACK_CHANNEL_ID || null;
    if (mainNotifsChannelId == null) {
      throw new SfdxError(
        "You need to define a variable SLACK_CHANNEL_ID to use sfdx-hardis Slack Integration. Otherwise, remove variable SLACK_TOKEN",
      );
    }
    const slackChannelsIds = [mainNotifsChannelId];
    // Add branch custom slack channel if defined
    const customSlackChannelVariable = `SLACK_CHANNEL_ID_${(await getCurrentGitBranch()).toUpperCase()}`;
    if (process.env[customSlackChannelVariable]) {
      slackChannelsIds.push(process.env[customSlackChannelVariable]);
    }
    // Main block
    const blocks: Block[] = [];
    const block: SectionBlock = {
      type: "section",
      text: {
        type: "mrkdwn",
        text: UtilsNotifs.prefixWithSeverityEmoji(notifMessage.text, notifMessage.severity),
      },
    };
    /* Disable until we don't know how to use it cleanly
    if (notifMessage.sideImage) {
      block.accessory = {
        "type": "image",
        "image_url": notifMessage.sideImage,
        "alt_text": "sfdx-hardis"
      }
    } */
    blocks.push(block);
    // Add action blocks
    if (notifMessage.buttons?.length > 0) {
      const actionElements = [];
      for (const button of notifMessage.buttons) {
        // Url button
        if (button.url) {
          const actionsElement: Button = {
            type: "button",
            text: {
              type: "plain_text",
              text: button.text,
            },
            style: button.style || "primary",
            url: button.url,
          };
          actionElements.push(actionsElement);
        }
      }
      const actionsBlock: ActionsBlock = {
        type: "actions",
        elements: actionElements,
      };
      blocks.push(actionsBlock);
    }
    // Post messages
    for (const slackChannelId of slackChannelsIds) {
      try {
        const resp = await this.slackClient.chat.postMessage({
          text: notifMessage.text,
          attachments: notifMessage.attachments,
          blocks: blocks,
          channel: slackChannelId,
          unfurl_links: false,
          unfurl_media: false,
        });
        uxLog(this, c.gray(`Sent slack notification to channel ${mainNotifsChannelId}: ${resp.ok}`));
      } catch (error) {
        uxLog(this, c.red(`Error while sending message to channel ${mainNotifsChannelId}\n${error.message}`));
      }
    }
    return;
  }
}
