import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot";
import { getCurrentGitBranch, getGitRepoName, getGitRepoUrl, uxLog } from "../utils";
import { NotifButton, NotifMessage, UtilsNotifs } from ".";
import { getEnvVar } from "../../config";

import { removeMarkdown } from "../utils/notifUtils";
import { Connection } from "jsforce";
import { GitProvider } from "../gitProvider";
import axios from "axios";

export class ApiProvider extends NotifProviderRoot {
  public payload: ApiNotifMessage;

  public getLabel(): string {
    return "sfdx-hardis Api connector";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(notifMessage: NotifMessage): Promise<void> {
    const apiUrl = getEnvVar("NOTIF_API_URL");
    if (apiUrl == null) {
      throw new SfdxError("[ApiProvider] You need to define a variable NOTIF_API_URL to use sfdx-hardis Api notifications");
    }
    // Build initial payload data from notifMessage
    this.buildPlayload(notifMessage);
    // Add SF org  & git info
    await this.addPayloadContext();

    // Send notif
    await this.sendToApi(apiUrl);
    return;
  }

  // Build message
  private buildPlayload(notifMessage: NotifMessage) {
    const firstLineMarkdown = UtilsNotifs.prefixWithSeverityEmoji(
      UtilsNotifs.slackToTeamsMarkdown(notifMessage.text.split("\n")[0]),
      notifMessage.severity
    );
    const logTitle = removeMarkdown(firstLineMarkdown);
    let logBodyText = UtilsNotifs.prefixWithSeverityEmoji(UtilsNotifs.slackToTeamsMarkdown(notifMessage.text), notifMessage.severity);

    // Add text details
    if (notifMessage?.attachments?.length > 0) {
      let text = "\n\n";
      for (const attachment of notifMessage.attachments) {
        if (attachment.text) {
          text += attachment.text + "\n\n";
        }
      }
      if (text !== "") {
        logBodyText += UtilsNotifs.slackToTeamsMarkdown(text) + "\n\n";
      }
    }

    // Add action blocks
    if (notifMessage.buttons?.length > 0) {
      logBodyText += "Links:\n\n";
      for (const button of notifMessage.buttons) {
        // Url button
        if (button.url) {
          logBodyText += "  - " + button.text + ": " + button.url + "\n\n";
        }
      }
      logBodyText += "\n\n";
    }

    // Add sfdx-hardis ref
    logBodyText += "Powered by sfdx-hardis: https://sfdx-hardis.cloudity.com";
    logBodyText = removeMarkdown(logBodyText);

    this.payload = {
      source: 'sfdx-hardis',
      type: notifMessage.type,
      severity: notifMessage.severity || 'info',
      logElements: notifMessage.logElements,
      metric: notifMessage.metric || notifMessage.logElements.length,
      additionalData: notifMessage.additionalData || {},
      links: notifMessage.buttons || [],
      title: logTitle,
      bodyText: logBodyText,
      _initialText: notifMessage.text,
      _initialAttachments: notifMessage.attachments || [],
    };
  }

  // Add source context infos
  private async addPayloadContext() {
    // Add SF org info
    const conn: Connection = globalThis.jsForceConn || null;
    if (conn && conn.instanceUrl) {
      this.payload.instanceUrl = conn.instanceUrl;
      this.payload.username = (await conn.identity())?.username || "";
    }
    // Add git info
    const repoName = await getGitRepoName();
    if (repoName) {
      this.payload.gitRepoName = repoName;
    }
    const repoUrl = await getGitRepoUrl();
    if (repoUrl) {
      this.payload.gitRepoUrl = repoUrl;
    }
    const currentGitBranch = await getCurrentGitBranch();
    if (currentGitBranch) {
      this.payload.gitBranch = currentGitBranch;
    }
    const branchUrl = await GitProvider.getCurrentBranchUrl();
    if (branchUrl) {
      this.payload.gitBranchUrl = branchUrl;
    }
  }

  // Call remote API
  private async sendToApi(apiUrl: string) {
    try {
      const axiosResponse = await axios({
        method: "post",
        url: apiUrl,
        responseType: "json",
        data: this.payload,
      });
      const httpStatus = axiosResponse.status;
      if (httpStatus > 200 && httpStatus < 300) {
        uxLog(this, c.grey(`[ApiProvider] Sent message to API ${apiUrl} (${httpStatus})`));
      }
    } catch (e) {
      uxLog(this, c.yellow(`[ApiProvider] Error while sending message to API ${apiUrl}`));
      uxLog(this, c.grey(e.message));
    }
  }
}

export interface ApiNotifMessage {
  source: string;
  type: string;
  severity: "critical" | "error" | "warning" | "info" | "success";
  links?: NotifButton[];
  title: string;
  bodyText: string;
  logElements: any[];
  metric: number,
  additionalData?: any;
  instanceUrl?: string;
  username?: string;
  gitRepoName?: string;
  gitRepoUrl?: string;
  gitBranch?: string;
  gitBranchUrl?: string;
  _initialText?: string;
  _initialAttachments?: any[];
}