import c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot.js";
import { getCurrentGitBranch, uxLog } from "../utils/index.js";
import { NotifMessage, UtilsNotifs } from "./index.js";
import { getEnvVar } from "../../config/index.js";

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
const ERROR_SEVERITIES = ["critical", "error", "warning"];
const MAIN_ENV_VAR = "MS_TEAMS_WEBHOOK_URL";
const ERRORS_WARNINGS_ENV_VAR = "MS_TEAMS_WEBHOOK_URL_ERRORS_WARNINGS";

export class TeamsProvider extends NotifProviderRoot {
  public getLabel(): string {
    return "sfdx-hardis MsTeams connector";
  }

  public async postNotification(notifMessage: NotifMessage): Promise<void> {
    const webhookUrls = await this.getWebhookUrls(notifMessage);
    if (webhookUrls.length === 0) {
      uxLog("error", this, c.red("[TeamsProvider] MS_TEAMS_WEBHOOK_URL is not defined"));
      return;
    }

    const adaptiveCard = this.buildAdaptiveCard(notifMessage);
    const payload = this.buildPayload(adaptiveCard);

    await this.sendToWebhooks(webhookUrls, payload);
  }

  private async getWebhookUrls(notifMessage: NotifMessage): Promise<string[]> {
    const mainWebhookUrl = getEnvVar(MAIN_ENV_VAR);
    if (!mainWebhookUrl) {
      return [];
    }

    const webhookUrls = mainWebhookUrl.split(",");

    // Add branch-specific webhook if defined
    const currentBranch = await getCurrentGitBranch();
    if (currentBranch) {
      const branchWebhookVar = `${MAIN_ENV_VAR}_${currentBranch.toUpperCase()}`;
      const branchWebhook = getEnvVar(branchWebhookVar);
      if (branchWebhook) {
        webhookUrls.push(...branchWebhook.split(","));
      }
    }

    // Add errors/warnings webhook if applicable
    if (ERROR_SEVERITIES.indexOf(notifMessage.severity) > -1) {
      const errorsWebhook = getEnvVar(ERRORS_WARNINGS_ENV_VAR);
      if (errorsWebhook) {
        webhookUrls.push(...errorsWebhook.split(","));
      }
    }

    return webhookUrls;
  }

  private buildPayload(adaptiveCard: AdaptiveCard): object {
    return {
      attachments: [
        {
          contentType: CONTENT_TYPE_ADAPTIVE_CARD,
          content: adaptiveCard,
        },
      ],
    };
  }

  private async sendToWebhooks(webhookUrls: string[], payload: object): Promise<void> {
    for (const webhookUrl of webhookUrls) {
      try {
        const response = await fetch(webhookUrl.trim(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          uxLog("log", this, c.cyan("[TeamsProvider] Sent Teams notification to webhook"));
        } else {
          const errorText = await response.text();
          uxLog("error", this, c.grey("[TeamsProvider] Failed Teams message content:\n" + JSON.stringify(payload, null, 2)));
          uxLog("error", this, c.red(`[TeamsProvider] Error while sending message to webhook\n${response.status} - ${errorText}`));
        }
      } catch (error) {
        uxLog("error", this, c.red(`[TeamsProvider] Error while sending message to webhook\n${(error as Error).message}`));
      }
    }
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
    const messageText = UtilsNotifs.slackToTeamsMarkdown(
      UtilsNotifs.prefixWithSeverityEmoji(notifMessage.text, notifMessage.severity)
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
        text: UtilsNotifs.slackToTeamsMarkdown(attachment.text),
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
