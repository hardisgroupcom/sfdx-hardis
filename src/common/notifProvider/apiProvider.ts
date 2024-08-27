import { SfError } from "@salesforce/core";
import c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot";
import { getCurrentGitBranch, getGitRepoName, uxLog } from "../utils";
import { NotifMessage, NotifSeverity, UtilsNotifs } from "./index.js";
import { getEnvVar } from "../../config/index.js";

import { getSeverityIcon, removeMarkdown } from "../utils/notifUtils.js";
import { Connection } from "jsforce";
import { GitProvider } from "../gitProvider/index.js";
import axios, { AxiosRequestConfig } from "axios";

const MAX_LOKI_LOG_LENGTH = Number(process.env.MAX_LOKI_LOG_LENGTH || 200000);
const TRUNCATE_LOKI_ELEMENTS_LENGTH = Number(process.env.TRUNCATE_LOKI_ELEMENTS_LENGTH || 500);

export class ApiProvider extends NotifProviderRoot {
  protected apiUrl: string;
  public payload: ApiNotifMessage;
  public payloadFormatted: any;

  protected metricsApiUrl: string;
  public metricsPayload: string;

  public getLabel(): string {
    return "sfdx-hardis Api connector";
  }

  // Always send notifications to API endpoint
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public isApplicableForNotif(notifMessage: NotifMessage) {
    return true;
  }

  public isUserNotifProvider() {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(notifMessage: NotifMessage): Promise<void> {
    const apiPromises: Promise<void>[] = []; // Use Promises to optimize performances with api calls
    this.apiUrl = getEnvVar("NOTIF_API_URL");
    if (this.apiUrl == null) {
      throw new SfError("[ApiProvider] You need to define a variable NOTIF_API_URL to use sfdx-hardis Api notifications");
    }
    // Build initial payload data from notifMessage
    await this.buildPayload(notifMessage);
    // Format payload according to API endpoint: for example, Grafana loki
    await this.formatPayload();
    // Send notif
    apiPromises.push(this.sendToApi());
    // Handle Metrics API if provided
    this.metricsApiUrl = getEnvVar("NOTIF_API_METRICS_URL");
    if (this.metricsApiUrl !== null) {
      this.buildMetricsPayload();
      if (this.metricsPayload.length > 0) {
        apiPromises.push(this.sendToMetricsApi());
      }
    }
    await Promise.allSettled(apiPromises);
    return;
  }

  // Build message
  private async buildPayload(notifMessage: NotifMessage) {
    const firstLineMarkdown = UtilsNotifs.prefixWithSeverityEmoji(
      UtilsNotifs.slackToTeamsMarkdown(notifMessage.text.split("\n")[0]),
      notifMessage.severity,
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

    // Build payload
    const repoName = (await getGitRepoName()).replace(".git", "");
    const currentGitBranch = await getCurrentGitBranch();
    const conn: Connection = globalThis.jsForceConn;
    const orgIdentifier = conn.instanceUrl.replace("https://", "").replace(".my.salesforce.com", "").replace(/\./gm, "__");
    const notifKey = orgIdentifier + "!!" + notifMessage.type;
    this.payload = {
      source: "sfdx-hardis",
      type: notifMessage.type,
      orgIdentifier: orgIdentifier,
      gitIdentifier: `${repoName}/${currentGitBranch}`,
      severity: notifMessage.severity,
      data: Object.assign(notifMessage.data, {
        _dateTime: new Date().toISOString(),
        _severityIcon: getSeverityIcon(notifMessage.severity),
        _title: logTitle,
        _logBodyText: logBodyText,
        _logElements: notifMessage.logElements,
        _metrics: notifMessage.metrics,
        _metricsKeys: Object.keys(notifMessage.metrics),
        _notifKey: notifKey,
      }),
    };
    // Add job url if available
    const jobUrl = await GitProvider.getJobUrl();
    if (jobUrl) {
      this.payload.data._jobUrl = jobUrl;
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
    const payloadCopy = Object.assign({}, this.payload);
    delete payloadCopy.data;
    let payloadDataJson = JSON.stringify(this.payload.data);
    const bodyBytesLen = new TextEncoder().encode(payloadDataJson).length;
    // Truncate log elements if log entry is too big
    if (bodyBytesLen > MAX_LOKI_LOG_LENGTH) {
      const newPayloadData = Object.assign({}, this.payload.data);
      const logElements: Array<any> = newPayloadData._logElements;
      if (logElements.length > TRUNCATE_LOKI_ELEMENTS_LENGTH) {
        const truncatedLogElements = logElements.slice(0, TRUNCATE_LOKI_ELEMENTS_LENGTH);
        newPayloadData._logElements = truncatedLogElements;
        newPayloadData._logElementsTruncated = true;
        payloadDataJson = JSON.stringify(newPayloadData);
        uxLog(
          this,
          c.grey(
            `[ApiProvider] Truncated _logElements from ${logElements.length} to ${truncatedLogElements.length} to avoid Loki entry max size reached (initial size: ${bodyBytesLen} bytes)`,
          ),
        );
      } else {
        newPayloadData._logBodyText = (newPayloadData._logBodyText || "").slice(0, 100) + "\n ... (truncated)";
        payloadDataJson = JSON.stringify(newPayloadData);
        uxLog(this, c.grey(`[ApiProvider] Truncated _logBodyText to 100 to avoid Loki entry max size reached (initial size: ${bodyBytesLen} bytes)`));
      }
    }
    this.payloadFormatted = {
      streams: [
        {
          stream: payloadCopy,
          values: [[`${currentTimeNanoseconds}`, payloadDataJson]],
        },
      ],
    };
  }

  // Call remote API
  private async sendToApi() {
    const axiosConfig: AxiosRequestConfig = {
      responseType: "json",
    };
    // Basic Auth
    if (getEnvVar("NOTIF_API_BASIC_AUTH_USERNAME") != null) {
      axiosConfig.auth = {
        username: getEnvVar("NOTIF_API_BASIC_AUTH_USERNAME"),
        password: getEnvVar("NOTIF_API_BASIC_AUTH_PASSWORD"),
      };
    }
    // Bearer token
    else if (getEnvVar("NOTIF_API_BEARER_TOKEN") != null) {
      axiosConfig.headers = { Authorization: `Bearer ${getEnvVar("NOTIF_API_BEARER_TOKEN")}` };
    }
    // POST message
    try {
      const axiosResponse = await axios.post(this.apiUrl, this.payloadFormatted, axiosConfig);
      const httpStatus = axiosResponse.status;
      if (httpStatus > 200 && httpStatus < 300) {
        uxLog(this, c.cyan(`[ApiProvider] Posted message to API ${this.apiUrl} (${httpStatus})`));
        if (getEnvVar("NOTIF_API_DEBUG") === "true") {
          uxLog(this, c.cyan(JSON.stringify(this.payloadFormatted, null, 2)));
        }
      }
    } catch (e) {
      uxLog(this, c.yellow(`[ApiProvider] Error while sending message to API ${this.apiUrl}: ${(e as Error).message}`));
      uxLog(this, c.grey("Request body: \n" + JSON.stringify(this.payloadFormatted)));
      uxLog(this, c.grey("Response body: \n" + JSON.stringify(e?.response?.data || {})));
    }
  }

  // Build something like MetricName,source=sfdx-hardis,orgIdentifier=hardis-group metric=12.7,min=0,max=70,percent=0.63
  private buildMetricsPayload() {
    // Build tag field
    const metricTags =
      `source=${this.payload.source},` +
      `type=${this.payload.type},` +
      `orgIdentifier=${this.payload.orgIdentifier},` +
      `gitIdentifier=${this.payload.gitIdentifier}`;
    // Add extra fields and value
    const metricsPayloadLines: any[] = [];
    for (const metricId of Object.keys(this.payload.data._metrics)) {
      const metricData = this.payload.data._metrics[metricId];
      let metricPayloadLine = metricId + "," + metricTags + " ";
      if (typeof metricData === "number") {
        metricPayloadLine += "metric=" + metricData.toFixed(2);
        metricsPayloadLines.push(metricPayloadLine);
      } else if (typeof metricData === "object") {
        const metricFields: any[] = [];
        if (metricData.min) {
          metricFields.push("min=" + metricData.min.toFixed(2));
        }
        if (metricData.max) {
          metricFields.push("max=" + metricData.max.toFixed(2));
        }
        if (metricData.percent) {
          metricFields.push("percent=" + metricData.percent.toFixed(2));
        }
        metricFields.push("metric=" + metricData.value.toFixed(2));
        metricPayloadLine += metricFields.join(",");
        metricsPayloadLines.push(metricPayloadLine);
      }
    }

    // Result as single string with carriage returns
    this.metricsPayload = metricsPayloadLines.join("\n");
  }

  // Call remote API
  private async sendToMetricsApi() {
    const axiosConfig: AxiosRequestConfig = {
      responseType: "json",
    };
    // Basic Auth
    if (getEnvVar("NOTIF_API_METRICS_BASIC_AUTH_USERNAME") != null) {
      axiosConfig.auth = {
        username: getEnvVar("NOTIF_API_METRICS_BASIC_AUTH_USERNAME"),
        password: getEnvVar("NOTIF_API_METRICS_BASIC_AUTH_PASSWORD"),
      };
    }
    // Bearer token
    else if (getEnvVar("NOTIF_API_METRICS_BEARER_TOKEN") != null) {
      axiosConfig.headers = { Authorization: `Bearer ${getEnvVar("NOTIF_API_METRICS_BEARER_TOKEN")}` };
    }
    // POST message
    try {
      const axiosResponse = await axios.post(this.metricsApiUrl, this.metricsPayload, axiosConfig);
      const httpStatus = axiosResponse.status;
      if (httpStatus > 200 && httpStatus < 300) {
        uxLog(this, c.cyan(`[ApiMetricProvider] Posted message to API ${this.metricsApiUrl} (${httpStatus})`));
        if (getEnvVar("NOTIF_API_DEBUG") === "true") {
          uxLog(this, c.cyan(JSON.stringify(this.metricsPayload, null, 2)));
        }
      }
    } catch (e) {
      uxLog(this, c.yellow(`[ApiMetricProvider] Error while sending message to API ${this.metricsApiUrl}: ${(e as Error).message}`));
      uxLog(this, c.grey("Request body: \n" + JSON.stringify(this.metricsPayload)));
      uxLog(this, c.grey("Response body: \n" + JSON.stringify(e?.response?.data || {})));
    }
  }
}

export interface ApiNotifMessage {
  source: string;
  type: string;
  severity: NotifSeverity;
  orgIdentifier: string;
  gitIdentifier: string;
  data: any;
}
