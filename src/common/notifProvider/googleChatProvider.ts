import c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot.js";
import { getCurrentGitBranch, uxLog } from "../utils/index.js";
import type { NotificationChannel, NotifMessage } from "./types.js";
import { UtilsNotifs } from "./utils.js";
import { convertMarkdownToGoogleChatMarkup } from "./googleChatMarkup.js";
import { getEnvVar } from "../../config/index.js";

interface CardV2Widget {
  [key: string]: any;
}

interface CardV2Section {
  header?: string;
  collapsible?: boolean;
  uncollapsibleWidgetsCount?: number;
  widgets: CardV2Widget[];
}

interface CardV2Header {
  title: string;
  subtitle?: string;
}

interface CardV2 {
  header?: CardV2Header;
  sections: CardV2Section[];
}

const ERROR_SEVERITIES = ["critical", "error", "warning"];
const MAIN_ENV_VAR = "GOOGLE_CHAT_WEBHOOK_URL";
const ERRORS_WARNINGS_ENV_VAR = "GOOGLE_CHAT_WEBHOOK_URL_ERRORS_WARNINGS";
const CARD_ID = "sfdx-hardis-notif";

export class GoogleChatProvider extends NotifProviderRoot {
  public getLabel(): string {
    return "sfdx-hardis Google Chat connector";
  }

  public getChannel(): NotificationChannel {
    return "messaging";
  }

  public async postNotification(notifMessage: NotifMessage): Promise<void> {
    const webhookUrls = await this.getWebhookUrls(notifMessage);
    if (webhookUrls.length === 0) {
      uxLog("error", this, c.red("[GoogleChatProvider] GOOGLE_CHAT_WEBHOOK_URL is not defined"));
      return;
    }

    const card = this.buildCardV2(notifMessage);
    const payload = { cardsV2: [{ cardId: CARD_ID, card }] };

    await this.sendToWebhooks(webhookUrls, payload);
  }

  private async getWebhookUrls(notifMessage: NotifMessage): Promise<string[]> {
    const mainWebhookUrl = getEnvVar(MAIN_ENV_VAR);
    if (!mainWebhookUrl) {
      return [];
    }

    const webhookUrls = mainWebhookUrl.split(",");

    const currentBranch = await getCurrentGitBranch();
    if (currentBranch) {
      const branchWebhookVar = `${MAIN_ENV_VAR}_${currentBranch.toUpperCase()}`;
      const branchWebhook = getEnvVar(branchWebhookVar);
      if (branchWebhook) {
        webhookUrls.push(...branchWebhook.split(","));
      }
    }

    if (ERROR_SEVERITIES.indexOf(notifMessage.severity) > -1) {
      const errorsWebhook = getEnvVar(ERRORS_WARNINGS_ENV_VAR);
      if (errorsWebhook) {
        webhookUrls.push(...errorsWebhook.split(","));
      }
    }

    return webhookUrls;
  }

  private async sendToWebhooks(webhookUrls: string[], payload: object): Promise<void> {
    for (const webhookUrl of webhookUrls) {
      try {
        const response = await fetch(webhookUrl.trim(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          uxLog("log", this, c.cyan("[GoogleChatProvider] Sent Google Chat notification to webhook"));
        } else {
          const errorText = await response.text();
          uxLog("error", this, c.grey("[GoogleChatProvider] Failed Google Chat message content:\n" + JSON.stringify(payload, null, 2)));
          uxLog("error", this, c.red(`[GoogleChatProvider] Error while sending message to webhook\n${response.status} - ${errorText}`));
        }
      } catch (error) {
        uxLog("error", this, c.red(`[GoogleChatProvider] Error while sending message to webhook\n${(error as Error).message}`));
      }
    }
  }

  private buildCardV2(notifMessage: NotifMessage): CardV2 {
    const { headerTitle, bodyMarkup } = this.splitMessageForCard(notifMessage);

    const sections: CardV2Section[] = [];
    if (bodyMarkup) {
      sections.push({
        widgets: [{ textParagraph: { text: bodyMarkup, textSyntax: "MARKDOWN" } }],
      });
    }

    const attachmentsSection = this.buildAttachmentsSection(notifMessage);
    if (attachmentsSection) {
      sections.push(attachmentsSection);
    }

    const buttonsSection = this.buildButtonsSection(notifMessage);
    if (buttonsSection) {
      sections.push(buttonsSection);
    }

    if (sections.length === 0) {
      sections.push({ widgets: [{ textParagraph: { text: " ", textSyntax: "MARKDOWN" } }] });
    }

    const header: CardV2Header = { title: headerTitle };
    const branch = (notifMessage.data && notifMessage.data.gitBranch) || undefined;
    if (typeof branch === "string" && branch.length > 0) {
      header.subtitle = branch;
    }

    return { header, sections };
  }

  private splitMessageForCard(notifMessage: NotifMessage): { headerTitle: string; bodyMarkup: string } {
    const rawText = notifMessage.text || "";
    const lines = rawText.split(/\r?\n/);

    let firstNonEmptyIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().length > 0) {
        firstNonEmptyIndex = i;
        break;
      }
    }

    let firstLinePlain = "";
    if (firstNonEmptyIndex >= 0) {
      firstLinePlain = lines[firstNonEmptyIndex]
        .replace(/^[ \t]{0,3}#{1,6}[ \t]+/, "")
        .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
        .replace(/[*_~`]/g, "")
        .trim();
    }
    const headerTitle = UtilsNotifs.prefixWithSeverityEmoji(firstLinePlain || "sfdx-hardis notification", notifMessage.severity);

    const remainder = firstNonEmptyIndex >= 0 ? lines.slice(firstNonEmptyIndex + 1).join("\n").trim() : rawText.trim();
    const bodyMarkup = remainder ? convertMarkdownToGoogleChatMarkup(remainder) : "";

    return { headerTitle, bodyMarkup };
  }

  private buildAttachmentsSection(notifMessage: NotifMessage): CardV2Section | undefined {
    if (!notifMessage.attachments?.length) {
      return undefined;
    }

    const widgets: CardV2Widget[] = notifMessage.attachments
      .filter((attachment) => attachment && typeof attachment.text === "string" && attachment.text.length > 0)
      .map((attachment) => ({
        textParagraph: { text: convertMarkdownToGoogleChatMarkup(attachment.text), textSyntax: "MARKDOWN" },
      }));

    if (widgets.length === 0) {
      return undefined;
    }

    return {
      header: "Details",
      collapsible: true,
      uncollapsibleWidgetsCount: 0,
      widgets,
    };
  }

  private buildButtonsSection(notifMessage: NotifMessage): CardV2Section | undefined {
    if (!notifMessage.buttons?.length) {
      return undefined;
    }

    const buttons = notifMessage.buttons
      .filter((button) => button && button.url)
      .map((button) => ({
        text: button.text,
        onClick: { openLink: { url: button.url } },
      }));

    if (buttons.length === 0) {
      return undefined;
    }

    return {
      widgets: [{ buttonList: { buttons } }],
    };
  }
}
