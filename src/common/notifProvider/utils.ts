import { getEnvVar } from "../../config";

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

  public static isEmailAvailable() {
    if (getEnvVar("NOTIF_EMAIL_ADDRESS") && globalThis.jsForceConn) {
      return true;
    }
    return false;
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

  public static prefixWithSeverityEmoji(text: string, severity: "critical" | "error" | "warning" | "info" | "success" | null) {
    const emojis = {
      critical: "💥",
      error: "❌",
      warning: "⚠️",
      info: "ℹ️",
      success: "✅",
    };
    const emoji = emojis[severity] || emojis["info"];
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
