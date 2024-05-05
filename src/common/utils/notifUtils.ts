/* eslint-disable no-useless-escape */
/*
This class is deprecated and kept for backward compatibility
Use NotifProvider class instead :)
*/
import { getCurrentGitBranch, uxLog } from ".";
import * as c from "chalk";
import { IncomingWebhook } from "ms-teams-webhook";
import { getConfig } from "../../config";
import { GitProvider } from "../gitProvider";
import { NotifSeverity, UtilsNotifs } from "../notifProvider";

// Check if current process can send notifications
export async function canSendNotifications(): Promise<boolean> {
  if (globalThis?.skipLegacyNotifications === true) {
    // Skip legacy notifications if NotifProvider has been used
    return false;
  }
  const config = await getConfig("user");
  return (
    process.env.MS_TEAMS_WEBHOOK_URL ||
    process.env.MS_TEAMS_WEBHOOK_URL_CRITICAL ||
    process.env.MS_TEAMS_WEBHOOK_URL_SEVERE ||
    process.env.MS_TEAMS_WEBHOOK_URL_WARNING ||
    process.env.MS_TEAMS_WEBHOOK_URL_INFO ||
    config.msTeamsWebhookUrl
  );
}

// Send notification to targets defined in env variables
export async function sendNotification(options: {
  title: string;
  text?: string;
  summary?: string;
  buttons?: Array<any>;
  severity?: "critical" | "severe" | "warning" | "info";
}): Promise<any> {
  let title = options.title || "No title defined for notification";
  // Add repo & branch name in title if available and not already included
  const repoName = process.env.CI_PROJECT_NAME || null;
  const branchName = process.env.CI_COMMIT_BRANCH || null;
  let repoInfo = "";
  if (repoName && !title.includes(repoName)) {
    repoInfo += ` ${repoName}`;
  }
  if (branchName && !title.includes(branchName)) {
    repoInfo += `/${branchName}`;
  }
  if (repoInfo !== "") {
    title = repoInfo + " | " + title;
  }
  const text = options.text || "";
  const summary = options.summary || "";
  const buttons = options.buttons || [];
  const severity = options.severity || "info";
  const teamsNotif = sendMsTeamsNotification(title, text, summary, buttons, severity);
  return await Promise.all([teamsNotif]);
}

// Microsoft Teams Notification: Requires env var MS_TEAMS_WEBHOOK_URL to be defined
async function sendMsTeamsNotification(title, text, summary, buttons, severity) {
  const config = await getConfig("user");
  const hooksUrls = [];
  // Classic hook url
  const msTeamsWebhookUrl = process.env.MS_TEAMS_WEBHOOK_URL || config.msTeamsWebhookUrl;
  if (msTeamsWebhookUrl) {
    hooksUrls.push(msTeamsWebhookUrl);
  }
  // Critical hook URL
  if (severity === "critical") {
    const msTeamsCriticalHookUrl = process.env.MS_TEAMS_WEBHOOK_URL_CRITICAL || config.msTeamsWebhookUrlCritical;
    if (msTeamsCriticalHookUrl) {
      hooksUrls.push(msTeamsCriticalHookUrl);
    }
  }
  // Severe hook URL
  if (severity === "severe") {
    const msTeamsSevereHookUrl = process.env.MS_TEAMS_WEBHOOK_URL_SEVERE || config.msTeamsWebhookUrlSevere;
    if (msTeamsSevereHookUrl) {
      hooksUrls.push(msTeamsSevereHookUrl);
    }
  }
  // Warning hook URL
  if (severity === "warning") {
    const msTeamsWarningHookUrl = process.env.MS_TEAMS_WEBHOOK_URL_WARNING || config.msTeamsWebhookUrlWarning;
    if (msTeamsWarningHookUrl) {
      hooksUrls.push(msTeamsWarningHookUrl);
    }
  }
  // Info hook URL
  if (severity === "info") {
    const msTeamsInfoHookUrl = process.env.MS_TEAMS_WEBHOOK_URL_INFO || config.msTeamsWebhookUrlInfo;
    if (msTeamsInfoHookUrl) {
      hooksUrls.push(msTeamsInfoHookUrl);
    }
  }
  // Call MsTeams hooks
  for (const hookUrl of hooksUrls) {
    await sendMsTeamsHook(hookUrl, title, text, summary, buttons);
  }
}

async function sendMsTeamsHook(msTeamsWebhookUrl, title, text, summary, buttons) {
  const teamsHookData = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    summary: summary,
    themeColor: "0078D7",
    title: title,
    text: text,
    potentialAction: buttons.map((btnInfo) => {
      const btnTeams = {
        "@type": "OpenUri",
        name: btnInfo.title,
        targets: [
          {
            os: "default",
            uri: btnInfo.url,
          },
        ],
      };
      return btnTeams;
    }),
  };

  // Add link to JOB URL if provided
  if (process.env.CI_JOB_URL) {
    teamsHookData.potentialAction.push({
      "@type": "OpenUri",
      name: "View CI Job",
      targets: [
        {
          os: "default",
          uri: process.env.CI_JOB_URL,
        },
      ],
    });
  }
  const webhook = new IncomingWebhook(msTeamsWebhookUrl);
  await webhook.send(teamsHookData);
  uxLog(this, c.grey("Sent Ms Teams notification to " + msTeamsWebhookUrl + " : " + teamsHookData.title));
}

/**
 * @description This function retrieves the job URL from the GitProvider and creates a notification button if the job URL exists.
 * The notification button is an object with a 'text' property set to "View Job" and a 'url' property set to the job URL.
 * It returns an array of such notification buttons.
 *
 * @returns {Promise<{ text: string; url: string }[]>} - A Promise that resolves to an array of notification buttons.
 */
export async function getNotificationButtons(): Promise<{ text: string; url: string }[]> {
  const notifButtons = [];
  const jobUrl = await GitProvider.getJobUrl();
  if (jobUrl) {
    notifButtons.push({ text: "View Job", url: jobUrl });
  }
  return notifButtons;
}

/**
 * @descriptionThis function retrieves the current Git branch and its URL from the GitProvider.
 * It then generates a markdown string for the branch.
 * If the branch URL exists, it creates a markdown link with the branch name as the link text.
 * Otherwise, it simply formats the branch name in markdown.
 *
 * @returns {Promise<string>} - A Promise that resolves to a markdown string for the current Git branch.
 */
export async function getBranchMarkdown(type = "slack"): Promise<string> {
  const currentGitBranch = await getCurrentGitBranch();
  let branchMd =
    type === "jira"
      ? `{ "label": "${currentGitBranch}"}`
      : type === "teams"
        ? `**${currentGitBranch}**`
        : type == "html"
          ? `<strong>${currentGitBranch}</strong>`
          : `*${currentGitBranch}*`;
  const branchUrl = await GitProvider.getCurrentBranchUrl();
  if (branchUrl) {
    branchMd = UtilsNotifs.markdownLink(branchUrl, currentGitBranch, type);
  }
  return branchMd;
}

/**
 * @descriptionThis function retrieves the current Git branch and its URL from the GitProvider.
 * It then generates a markdown string for the branch.
 * If the branch URL exists, it creates a markdown link with the branch name as the link text.
 * Otherwise, it simply formats the branch name in markdown.
 *
 * @returns {Promise<string>} - A Promise that resolves to a markdown string for the current Git branch.
 */
export async function getOrgMarkdown(instanceUrl: string, type = "slack"): Promise<string> {
  if (!instanceUrl) {
    return await getBranchMarkdown(type);
  }
  const linkMarkdown = UtilsNotifs.markdownLink(instanceUrl, instanceUrl.replace("https://", "").replace(".my.salesforce.com", ""), type);
  return linkMarkdown;
}

type RemoveMarkdownOptions = {
  stripListLeaders?: boolean;
  listUnicodeChar: string | boolean;
  gfm?: boolean;
  useImgAltText?: boolean;
  preserveLinks?: boolean;
};
/**
 * @function removeMarkdown
 *
 * @description
 * Parse the markdown and returns a string
 *
 * @param markdown - The markdown string to parse
 * @param options - The options for the function
 *
 * @returns The parsed plain text
 */
export function removeMarkdown(
  markdown: string,
  optionsIn: RemoveMarkdownOptions = {
    listUnicodeChar: "",
  },
) {
  const options: any = optionsIn || {};
  // eslint-disable-next-line no-prototype-builtins
  options.listUnicodeChar = options.hasOwnProperty("listUnicodeChar") ? options.listUnicodeChar : false;
  // eslint-disable-next-line no-prototype-builtins
  options.stripListLeaders = options.hasOwnProperty("stripListLeaders") ? options.stripListLeaders : true;
  // eslint-disable-next-line no-prototype-builtins
  options.gfm = options.hasOwnProperty("gfm") ? options.gfm : true;
  // eslint-disable-next-line no-prototype-builtins
  options.useImgAltText = options.hasOwnProperty("useImgAltText") ? options.useImgAltText : true;
  // eslint-disable-next-line no-prototype-builtins
  options.preserveLinks = options.hasOwnProperty("preserveLinks") ? options.preserveLinks : false;

  let output = markdown || "";

  // Remove horizontal rules (stripListHeaders conflict with this rule, which is why it has been moved to the top)
  output = output.replace(/^(-\s*?|\*\s*?|_\s*?){3,}\s*$/gm, "");

  try {
    if (options.stripListLeaders) {
      if (options.listUnicodeChar) output = output.replace(/^([\s\t]*)([\*\-\+]|\d+\.)\s+/gm, options.listUnicodeChar + " $1");
      else output = output.replace(/^([\s\t]*)([\*\-\+]|\d+\.)\s+/gm, "$1");
    }
    if (options.gfm) {
      output = output
        // Header
        .replace(/\n={2,}/g, "\n")
        // Fenced codeblocks
        .replace(/~{3}.*\n/g, "")
        // Strikethrough
        .replace(/~~/g, "")
        // Fenced codeblocks
        .replace(/`{3}.*\n/g, "");
    }
    if (options.preserveLinks) {
      // Remove inline links while preserving the links
      output = output.replace(/\[(.*?)\][\[\(](.*?)[\]\)]/g, "$1 ($2)");
    }
    output = output
      // Remove HTML tags
      .replace(/<[^>]*>/g, "")
      // Remove setext-style headers
      .replace(/^[=\-]{2,}\s*$/g, "")
      // Remove footnotes?
      .replace(/\[\^.+?\](\: .*?$)?/g, "")
      .replace(/\s{0,2}\[.*?\]: .*?$/g, "")
      // Remove images
      .replace(/\!\[(.*?)\][\[\(].*?[\]\)]/g, options.useImgAltText ? "$1" : "")
      // Remove inline links
      .replace(/\[(.*?)\][\[\(].*?[\]\)]/g, "$1")
      // Remove blockquotes
      .replace(/^\s{0,3}>\s?/g, "")
      .replace(/(^|\n)\s{0,3}>\s?/g, "\n\n")
      // Remove reference-style links?
      .replace(/^\s{1,2}\[(.*?)\]: (\S+)( ".*?")?\s*$/g, "")
      // Remove atx-style headers
      .replace(/^(\n)?\s{0,}#{1,6}\s+| {0,}(\n)?\s{0,}#{0,} {0,}(\n)?\s{0,}$/gm, "$1$2$3")
      // Remove emphasis (repeat the line to remove double emphasis)
      .replace(/([\*_]{1,3})(\S.*?\S{0,1})\1/g, "$2")
      .replace(/([\*_]{1,3})(\S.*?\S{0,1})\1/g, "$2")
      // Remove code blocks
      .replace(/(`{3,})(.*?)\1/gm, "$2")
      // Remove inline code
      .replace(/`(.+?)`/g, "$1")
      // Replace two or more newlines with exactly two? Not entirely sure this belongs here...
      .replace(/\n{2,}/g, "\n\n");
  } catch (e) {
    console.error(e);

    return markdown;
  }
  return output;
}

export function getSeverityIcon(severity: NotifSeverity) {
  const severityIcons = {
    critical: "⛔",
    error: "❌",
    warning: "⚠️",
    info: "📄",
    success: "✅",
    log: "📰"
  };
  return severityIcons[severity] || "❔";
}
