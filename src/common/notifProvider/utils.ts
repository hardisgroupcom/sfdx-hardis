import type { NotifSeverity, NotificationConfigEntry } from "./types.js";
import { getEnvVar } from "../../config/index.js";
import { isEmailChannelObject } from "./notificationConfig.js";

export class UtilsNotifs {
  public static isSlackAvailable() {
    if (getEnvVar("SLACK_TOKEN")) {
      return true;
    }
    return false;
  }

  public static isMsTeamsAvailable() {
    if (getEnvVar("MS_TEAMS_WEBHOOK_URL")) {
      return true;
    }
    return false;
  }

  // Email is available when:
  //   - the global NOTIF_EMAIL_ADDRESS env var is set, OR
  //   - at least one .sfdx-hardis.yml notificationConfig entry declares email recipients;
  // and a Salesforce connection is available (emails are dispatched via Salesforce Messaging).
  public static isEmailAvailable(userConfig?: { notificationConfig?: NotificationConfigEntry[] }) {
    if (!globalThis.jsForceConn) {
      return false;
    }
    if (getEnvVar("NOTIF_EMAIL_ADDRESS")) {
      return true;
    }
    const entries = userConfig?.notificationConfig ?? [];
    return entries.some((entry) => {
      const email = entry?.notifications?.email;
      return (
        isEmailChannelObject(email) && Array.isArray(email.recipients) && email.recipients.some((r) => r && r.trim().length > 0)
      );
    });
  }

  public static isApiAvailable() {
    if (getEnvVar("NOTIF_API_URL")) {
      return true;
    }
    return false;
  }

  public static markdownLink(url: string, label: string, type = "slack") {
    if (type == "teams") {
      return `[${label}](${url})`;
    }
    if (type === "jira") {
      return `{ "label": "${label}", "url": "${url}"}`;
    }
    if (type == "html") {
      return `<a href="${url}">${label}</a>`;
    }
    return `<${url}|*${label}*>`;
  }

  public static prefixWithSeverityEmoji(text: string, severity: NotifSeverity | null) {
    const emojis: any = {
      critical: "💥",
      error: "❌",
      warning: "⚠️",
      info: "ℹ️",
      success: "✅",
    };
    const emoji = emojis[severity || ""] || emojis["info"];
    return `${emoji} ${text}`;
  }

  public static getImageUrl(imageKey: string) {
    const images = {
      backup: "https://raw.githubusercontent.com/hardisgroupcom/sfdx-hardis/main/docs/assets/notif/backup.png",
      test: "",
      monitoring: "",
      deployment: "",
    };
    return images[imageKey] || null;
  }

  public static slackToTeamsMarkdown(text: string) {
    // Bold
    const boldRegex = /(\*(.*?)\*)/gm;
    text = text.replace(boldRegex, "**$2**");
    // Carriage return
    const carriageReturnRegex = /\n/gm;
    text = text.replace(carriageReturnRegex, "\n\n");
    // Hyperlink
    const hyperlinkRegex = /<(.*?)\|(.*?)>/gm;
    text = text.replace(hyperlinkRegex, "[$2]($1)");
    return text;
  }
}
