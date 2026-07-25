import { SfError } from "@salesforce/core";
import c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot.js";
import { ActionsBlock, Block, Button, SectionBlock, WebClient } from "@slack/web-api";
import { getCurrentGitBranch, uxLog } from "../utils/index.js";
import type { NotificationChannel, NotifMessage } from "./types.js";
import { UtilsNotifs } from "./utils.js";
import { convertMarkdownToSlackBlocks, convertMarkdownToSlackMrkdwn } from "./slackMarkdown.js";
import { getEnvVar } from "../../config/index.js";
import { applyMessageSizeGuard, clampBlockText, SizeGuardLimits } from "./messageSizeGuard.js";

// Slack refuses a chat.postMessage call when a section block's text exceeds 3000 characters or the
// message carries more than 50 blocks (invalid_blocks). Overridable for orgs on different limits.
const SLACK_SIZE_LIMITS: SizeGuardLimits = {
  maxAttachmentsChars: Number(process.env.SLACK_MAX_ATTACHMENTS_CHARS || 12000),
  maxBlockChars: Number(process.env.SLACK_MAX_BLOCK_CHARS || 2900),
  maxBlocks: Number(process.env.SLACK_MAX_BLOCKS || 45),
};

export class SlackProvider extends NotifProviderRoot {
  private slackClient: InstanceType<typeof WebClient>;

  constructor() {
    super();
    this.token = process.env.SLACK_TOKEN || "";
    this.slackClient = new WebClient(this.token);
  }

  public getLabel(): string {
    return "sfdx-hardis Slack connector";
  }

  public getChannel(): NotificationChannel {
    return "messaging";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(inputNotifMessage: NotifMessage): Promise<void> {
    // Trim oversized attachments before conversion. Slack is not a webhook provider, so it applies
    // the guard itself instead of inheriting it from WebhookNotifProviderRoot.
    const notifMessage = applyMessageSizeGuard(inputNotifMessage, SLACK_SIZE_LIMITS);
    const mainNotifsChannelId = getEnvVar("SLACK_CHANNEL_ID");
    if (mainNotifsChannelId == null) {
      throw new SfError(
        "[SlackProvider] You need to define a variable SLACK_CHANNEL_ID to use sfdx-hardis Slack Integration. Otherwise, remove variable SLACK_TOKEN",
      );
    }
    const slackChannelsIds = mainNotifsChannelId.split(",");
    // Add branch custom slack channel if defined
    const customSlackChannelVariable = `SLACK_CHANNEL_ID_${(await getCurrentGitBranch() || "").toUpperCase()}`;
    if (getEnvVar(customSlackChannelVariable)) {
      slackChannelsIds.push(...(getEnvVar(customSlackChannelVariable) || "").split(","));
    }
    // Handle specific channel for Warnings and errors
    const warningsErrorsChannelId = getEnvVar("SLACK_CHANNEL_ID_ERRORS_WARNINGS");
    if (warningsErrorsChannelId && ["critical", "error", "warning"].includes(notifMessage.severity || null)) {
      slackChannelsIds.push(...warningsErrorsChannelId.split(","));
    }

    // Convert CommonMark / GitHub-flavored markdown (as emitted by AI prompts and many
    // call sites) into Slack Block Kit blocks. Pipe tables become native `table` blocks
    // so columns render aligned in Slack's UI; everything else becomes a `section` with
    // mrkdwn text. The plain `text` field below is the fallback for notification
    // previews and accessibility, so we still produce a flat mrkdwn string.
    const slackText = convertMarkdownToSlackMrkdwn(notifMessage.text);
    const slackAttachments = (notifMessage.attachments || []).map((att) => {
      if (att && typeof att === "object" && typeof att.text === "string") {
        return { ...att, text: convertMarkdownToSlackMrkdwn(att.text) };
      }
      return att;
    });

    // Main blocks: split markdown into section + table blocks, then prefix the
    // severity emoji to the first section. If the message starts with a table, fall
    // back to inserting a dedicated emoji-only section block before it.
    const blocks: Block[] = convertMarkdownToSlackBlocks(notifMessage.text);
    const firstSectionIndex = blocks.findIndex(
      (b) => b.type === "section" && (b as SectionBlock).text?.type === "mrkdwn",
    );
    if (firstSectionIndex >= 0) {
      const firstSection = blocks[firstSectionIndex] as SectionBlock;
      if (firstSection.text) {
        firstSection.text = {
          type: "mrkdwn",
          text: UtilsNotifs.prefixWithSeverityEmoji(firstSection.text.text || "", notifMessage.severity),
        };
      }
    } else {
      const emojiBlock: SectionBlock = {
        type: "section",
        text: {
          type: "mrkdwn",
          text: UtilsNotifs.prefixWithSeverityEmoji("", notifMessage.severity).trim(),
        },
      };
      blocks.unshift(emojiBlock);
    }
    /* Disable until we don't know how to use it cleanly
    if (notifMessage.sideImage) {
      (blocks[firstSectionIndex >= 0 ? firstSectionIndex : 0] as SectionBlock).accessory = {
        "type": "image",
        "image_url": notifMessage.sideImage,
        "alt_text": "sfdx-hardis"
      }
    } */
    // Add action blocks
    if (notifMessage.buttons?.length && notifMessage.buttons?.length > 0) {
      const actionElements: any[] = [];
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
    // Clamp section text and block count so Slack does not reject the message with invalid_blocks
    for (const block of blocks) {
      if (block.type === "section") {
        const sectionBlock = block as SectionBlock;
        if (sectionBlock.text?.text) {
          sectionBlock.text.text = clampBlockText(
            sectionBlock.text.text,
            SLACK_SIZE_LIMITS.maxBlockChars,
            notifMessage.translateMessages !== false,
          );
        }
      }
    }
    const cappedBlocks = blocks.length > SLACK_SIZE_LIMITS.maxBlocks ? blocks.slice(0, SLACK_SIZE_LIMITS.maxBlocks) : blocks;
    // Post messages
    for (const slackChannelId of slackChannelsIds) {
      const slackMessage = {
        text: slackText,
        attachments: slackAttachments,
        blocks: cappedBlocks,
        channel: slackChannelId,
        unfurl_links: false,
        unfurl_media: false,
      };
      try {
        const resp = await this.slackClient.chat.postMessage(slackMessage);
        uxLog("action", this, c.cyan(`[SlackProvider] Sent slack notification to channel ${mainNotifsChannelId}: ${resp.ok}`));
      } catch (error) {
        uxLog("error", this, c.grey("[SlackProvider] Failed slack message content: \n" + JSON.stringify(slackMessage, null, 2)));
        uxLog("error", this, c.red(`[SlackProvider] Error while sending message to channel ${mainNotifsChannelId}\n${(error as any).message}`));
      }
    }
    return;
  }
}
