import { WebhookNotifProviderRoot } from "./webhookNotifProviderRoot.js";
import type { NotificationChannel, NotifMessage } from "./types.js";
import { UtilsNotifs } from "./utils.js";
import { convertMarkdownToTeamsMrkdwn } from "./teamsMarkdown.js";
import { SizeGuardLimits } from "./messageSizeGuard.js";

interface AdaptiveCardElement {
  type: string;
  [key: string]: any;
}

interface AdaptiveCard {
  type: string;
  version: string;
  body: AdaptiveCardElement[];
  actions?: AdaptiveCardElement[];
}

const ADAPTIVE_CARD_VERSION = "1.0";
const CONTENT_TYPE_ADAPTIVE_CARD = "application/vnd.microsoft.card.adaptive";
const DETAILS_CONTAINER_ID = "detailsContainer";
const LOG_PREFIX = "[TeamsProvider]";

// Teams rejects an Adaptive Card payload over roughly 28 KB. TextBlock has no documented
// per-element cap, so the payload budget governs. Overridable for orgs on different limits.
const TEAMS_SIZE_LIMITS: SizeGuardLimits = {
  maxAttachmentsChars: Number(process.env.TEAMS_MAX_ATTACHMENTS_CHARS || 18000),
  maxBlockChars: Number(process.env.TEAMS_MAX_BLOCK_CHARS || 18000),
  maxBlocks: Number(process.env.TEAMS_MAX_BLOCKS || 100),
};

export class TeamsProvider extends WebhookNotifProviderRoot {
  public getLabel(): string {
    return "sfdx-hardis MsTeams connector";
  }

  public getChannel(): NotificationChannel {
    return "messaging";
  }

  protected getMainEnvVar(): string {
    return "MS_TEAMS_WEBHOOK_URL";
  }

  protected getErrorsWarningsEnvVar(): string {
    return "MS_TEAMS_WEBHOOK_URL_ERRORS_WARNINGS";
  }

  protected getLogPrefix(): string {
    return LOG_PREFIX;
  }

  protected getSizeLimits(): SizeGuardLimits {
    return TEAMS_SIZE_LIMITS;
  }

  protected buildPayload(notifMessage: NotifMessage): object {
    const adaptiveCard = this.buildAdaptiveCard(notifMessage);
    return {
      attachments: [
        {
          contentType: CONTENT_TYPE_ADAPTIVE_CARD,
          content: adaptiveCard,
        },
      ],
    };
  }

  private buildAdaptiveCard(notifMessage: NotifMessage): AdaptiveCard {
    const body = this.buildCardBody(notifMessage);
    const actions = this.buildCardActions(notifMessage);

    return {
      type: "AdaptiveCard",
      version: ADAPTIVE_CARD_VERSION,
      body,
      ...(actions && { actions }),
    };
  }

  private buildCardBody(notifMessage: NotifMessage): AdaptiveCardElement[] {
    const messageText = UtilsNotifs.prefixWithSeverityEmoji(
      convertMarkdownToTeamsMrkdwn(notifMessage.text),
      notifMessage.severity,
    );

    const body: AdaptiveCardElement[] = [
      {
        type: "TextBlock",
        text: messageText,
        wrap: true,
      },
    ];

    // Add collapsible attachments section if present
    const attachmentElements = this.buildAttachmentElements(notifMessage);
    if (attachmentElements.length > 0) {
      body.push(...attachmentElements);
    }

    return body;
  }

  private buildAttachmentElements(notifMessage: NotifMessage): AdaptiveCardElement[] {
    if (!notifMessage.attachments?.length) {
      return [];
    }

    const attachmentItems: AdaptiveCardElement[] = notifMessage.attachments
      .filter((attachment) => attachment.text)
      .map((attachment) => ({
        type: "TextBlock",
        text: convertMarkdownToTeamsMrkdwn(attachment.text),
        wrap: true,
      }));

    if (attachmentItems.length === 0) {
      return [];
    }

    return [
      {
        type: "Container",
        id: DETAILS_CONTAINER_ID,
        style: "emphasis",
        isVisible: false,
        items: attachmentItems,
      },
      {
        type: "ActionSet",
        actions: [
          {
            type: "Action.ToggleVisibility",
            title: "Toggle details",
            targetElements: [DETAILS_CONTAINER_ID],
          },
        ],
      },
    ];
  }

  private buildCardActions(notifMessage: NotifMessage): AdaptiveCardElement[] | undefined {
    if (!notifMessage.buttons?.length) {
      return undefined;
    }

    return notifMessage.buttons.map((button) => ({
      type: "Action.OpenUrl",
      title: button.text,
      url: button.url,
    }));
  }
}
