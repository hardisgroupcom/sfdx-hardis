import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot";
import { getCurrentGitBranch, getGitRepoName, getGitRepoUrl, uxLog } from "../utils";
import { NotifButton, NotifMessage, NotifSeverity, UtilsNotifs } from ".";
import { getEnvVar } from "../../config";

import { removeMarkdown } from "../utils/notifUtils";
import { Connection } from "jsforce";
import { GitProvider } from "../gitProvider";
import axios, { AxiosRequestConfig } from "axios";

export class ApiProvider extends NotifProviderRoot {
  protected apiUrl: string;
  public payload: ApiNotifMessage;
  public payloadFormatted: any;

  public getLabel(): string {
    return "sfdx-hardis Api connector";
  }

  // Always send notifications to API endpoint
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public isApplicableForNotif(notifMessage: NotifMessage) {
    return true
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(notifMessage: NotifMessage): Promise<void> {
    this.apiUrl = getEnvVar("NOTIF_API_URL");
    if (this.apiUrl == null) {
      throw new SfdxError("[ApiProvider] You need to define a variable NOTIF_API_URL to use sfdx-hardis Api notifications");
    }
    // Build initial payload data from notifMessage
    this.buildPlayload(notifMessage);
    // Add SF org  & git info
    await this.addPayloadContext();
    // Format payload according to API endpoint: for example, Grafana loki
    await this.formatPayload();
    // Send notif
    await this.sendToApi();
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

  private async formatPayload() {
    if (this.apiUrl.includes("loki/api/v1/push")) {
      await this.formatPayloadLoki();
      return;
    }
    this.payloadFormatted = this.payload;
  }

  private async formatPayloadLoki() {
    const currentTimeNanoseconds = Date.now() * 1000 * 1000;
    this.payloadFormatted = {
      "streams": [
        {
          "stream": {
            "source": this.payload.source,
            "type": this.payload.type,
            "severity": this.payload.severity,
            "metric": this.payload.metric,
            "instanceUrl": this.payload.instanceUrl || "unknown",
            "username": this.payload.username || "unknown",
            "gitRepoName": this.payload.gitRepoName || "unknown",
            "gitRepoUrl": this.payload.gitRepoUrl || "unknown",
            "gitBranch": this.payload.gitBranch || "unknown",
          },
          "values": [
            [`${currentTimeNanoseconds}`, JSON.stringify(this.payload)]
          ]
        }]
    }
  }

  // Call remote API
  private async sendToApi() {
    const axiosConfig: AxiosRequestConfig = {
      responseType: "json",
    }
    // Basic Auth
    if (getEnvVar("NOTIF_API_BASIC_AUTH_USERNAME") != null) {
      axiosConfig.auth = {
        username: getEnvVar("NOTIF_API_BASIC_AUTH_USERNAME"),
        password: getEnvVar("NOTIF_API_BASIC_AUTH_PASSWORD")
      }
    }
    // Bearer token
    else if (getEnvVar("NOTIF_API_BEARER_TOKEN") != null) {
      axiosConfig.headers = { Authorization: `Bearer ${getEnvVar("NOTIF_API_BEARER_TOKEN")}` }
    }
    // POST message
    try {
      const axiosResponse = await axios.post(this.apiUrl, this.payloadFormatted, axiosConfig);
      const httpStatus = axiosResponse.status;
      if (httpStatus > 200 && httpStatus < 300) {
        uxLog(this, c.cyan(`[ApiProvider] Posted message to API ${this.apiUrl} (${httpStatus})`));
      }
    } catch (e) {
      uxLog(this, c.yellow(`[ApiProvider] Error while sending message to API ${this.apiUrl}: ${e.message}`));
      uxLog(this, c.grey("Request body: \n" + JSON.stringify(this.payloadFormatted)));
      uxLog(this, c.grey("Response body: \n" + JSON.stringify(e?.response?.data || {})));
    }
  }
}

export interface ApiNotifMessage {
  source: string;
  type: string;
  severity: NotifSeverity;
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