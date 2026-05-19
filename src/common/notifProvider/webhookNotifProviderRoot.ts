import c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot.js";
import { getCurrentGitBranch, uxLog } from "../utils/index.js";
import type { NotifMessage } from "./types.js";
import { getEnvVar } from "../../config/index.js";

const ERROR_SEVERITIES = ["critical", "error", "warning"];

export abstract class WebhookNotifProviderRoot extends NotifProviderRoot {
  protected abstract getMainEnvVar(): string;
  protected abstract getErrorsWarningsEnvVar(): string;
  protected abstract getLogPrefix(): string;
  protected abstract buildPayload(notifMessage: NotifMessage): object;
  protected getContentType(): string {
    return "application/json";
  }

  public async postNotification(notifMessage: NotifMessage): Promise<void> {
    const webhookUrls = await this.getWebhookUrls(notifMessage);
    if (webhookUrls.length === 0) {
      uxLog("error", this, c.red(`${this.getLogPrefix()} ${this.getMainEnvVar()} is not defined`));
      return;
    }

    const payload = this.buildPayload(notifMessage);
    await this.sendToWebhooks(webhookUrls, payload);
  }

  protected async getWebhookUrls(notifMessage: NotifMessage): Promise<string[]> {
    const mainWebhookUrl = getEnvVar(this.getMainEnvVar());
    if (!mainWebhookUrl) {
      return [];
    }

    const webhookUrls = mainWebhookUrl.split(",");

    const currentBranch = await getCurrentGitBranch();
    if (currentBranch) {
      const branchWebhookVar = `${this.getMainEnvVar()}_${currentBranch.toUpperCase()}`;
      const branchWebhook = getEnvVar(branchWebhookVar);
      if (branchWebhook) {
        webhookUrls.push(...branchWebhook.split(","));
      }
    }

    if (ERROR_SEVERITIES.indexOf(notifMessage.severity) > -1) {
      const errorsWebhook = getEnvVar(this.getErrorsWarningsEnvVar());
      if (errorsWebhook) {
        webhookUrls.push(...errorsWebhook.split(","));
      }
    }

    return webhookUrls;
  }

  protected async sendToWebhooks(webhookUrls: string[], payload: object): Promise<void> {
    const logPrefix = this.getLogPrefix();
    for (const webhookUrl of webhookUrls) {
      try {
        const response = await fetch(webhookUrl.trim(), {
          method: "POST",
          headers: {
            "Content-Type": this.getContentType(),
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          uxLog("log", this, c.cyan(`${logPrefix} Sent notification to webhook`));
        } else {
          const errorText = await response.text();
          uxLog("error", this, c.grey(`${logPrefix} Failed message content:\n${JSON.stringify(payload, null, 2)}`));
          uxLog("error", this, c.red(`${logPrefix} Error while sending message to webhook\n${response.status} - ${errorText}`));
        }
      } catch (error) {
        uxLog("error", this, c.red(`${logPrefix} Error while sending message to webhook\n${(error as Error).message}`));
      }
    }
  }
}
