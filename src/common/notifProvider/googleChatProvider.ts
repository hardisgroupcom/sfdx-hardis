import { WebhookNotifProviderRoot } from "./webhookNotifProviderRoot.js";
import type { NotificationChannel, NotifMessage } from "./types.js";
import { UtilsNotifs } from "./utils.js";
import { convertMarkdownToGoogleChatMarkup } from "./googleChatMarkup.js";
import { clampBlockText, SizeGuardLimits } from "./messageSizeGuard.js";

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

const CARD_ID = "sfdx-hardis-notif";
const LOG_PREFIX = "[GoogleChatProvider]";

// Google Chat caps a card message payload at 32 KB, and a single textParagraph widget at 4096
// characters. Overridable for orgs on different limits.
const GOOGLE_CHAT_SIZE_LIMITS: SizeGuardLimits = {
  maxAttachmentsChars: Number(process.env.GOOGLE_CHAT_MAX_ATTACHMENTS_CHARS || 20000),
  maxBlockChars: Number(process.env.GOOGLE_CHAT_MAX_BLOCK_CHARS || 4000),
  // NOT ENFORCED: Google Chat documents no widget count cap for a card. The payload budget governs.
  maxBlocks: Number(process.env.GOOGLE_CHAT_MAX_BLOCKS || 100),
};

export class GoogleChatProvider extends WebhookNotifProviderRoot {
  public getLabel(): string {
    return "sfdx-hardis Google Chat connector";
  }

  public getChannel(): NotificationChannel {
    return "messaging";
  }

  protected getMainEnvVar(): string {
    return "GOOGLE_CHAT_WEBHOOK_URL";
  }

  protected getErrorsWarningsEnvVar(): string {
    return "GOOGLE_CHAT_WEBHOOK_URL_ERRORS_WARNINGS";
  }

  protected getLogPrefix(): string {
    return LOG_PREFIX;
  }

  protected getContentType(): string {
    return "application/json; charset=UTF-8";
  }

  protected getSizeLimits(): SizeGuardLimits {
    return GOOGLE_CHAT_SIZE_LIMITS;
  }

  protected buildPayload(notifMessage: NotifMessage): object {
    const card = this.buildCardV2(notifMessage);
    return { cardsV2: [{ cardId: CARD_ID, card }] };
  }

  private buildCardV2(notifMessage: NotifMessage): CardV2 {
    const { headerTitle, bodyMarkup } = this.splitMessageForCard(notifMessage);

    const sections: CardV2Section[] = [];
    if (bodyMarkup) {
      sections.push({
        widgets: [
          {
            textParagraph: {
              text: clampBlockText(
                bodyMarkup,
                GOOGLE_CHAT_SIZE_LIMITS.maxBlockChars,
                notifMessage.translateMessages !== false,
              ),
              textSyntax: "MARKDOWN",
            },
          },
        ],
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
        textParagraph: {
          // A textParagraph widget is capped at 4096 characters on its own, independently of the
          // whole-payload budget already applied by the size guard.
          text: clampBlockText(
            convertMarkdownToGoogleChatMarkup(attachment.text),
            GOOGLE_CHAT_SIZE_LIMITS.maxBlockChars,
            notifMessage.translateMessages !== false,
          ),
          textSyntax: "MARKDOWN",
        },
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
