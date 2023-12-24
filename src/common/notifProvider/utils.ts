export class UtilsNotifs {
  public static isSlackAvailable() {
    if (process.env.SLACK_TOKEN && process.env.SLACK_TOKEN.length > 5 && !process.env.SLACK_TOKEN.includes("SLACK_TOKEN")) {
      return true;
    }
    return false;
  }

  public static isMsTeamsAvailable() {
    if (
      process.env.MS_TEAMS_WEBHOOK_URL &&
      process.env.MS_TEAMS_WEBHOOK_URL.length > 5 &&
      !process.env.MS_TEAMS_WEBHOOK_URL.includes("MS_TEAMS_WEBHOOK_URL")
    ) {
      return true;
    }
    return false;
  }

  public static markdownLink(url: string, label: string, type = "slack") {
    if (type === "jira") {
      return `{ "label": "${label}", "url": "${url}"}`;
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
      backup: "https://raw.githubusercontent.com/hardisgroupcom/sfdx-hardis/alpha/docs/assets/notif/backup.png",
      test: "",
      monitoring: "",
      deployment: "",
    };
    return images[imageKey] || null;
  }
}
