/* eslint-disable no-useless-escape */
/*
This class is deprecated and kept for backward compatibility
Use NotifProvider class instead 😊
*/
import { getCurrentGitBranch } from "./index.js";
import { GitProvider } from "../gitProvider/index.js";
import { NotifSeverity, UtilsNotifs } from "../notifProvider/index.js";

/**
 * @description This function retrieves the job URL from the GitProvider and creates a notification button if the job URL exists.
 * The notification button is an object with a 'text' property set to "View Job" and a 'url' property set to the job URL.
 * It returns an array of such notification buttons.
 *
 * @returns {Promise<{ text: string; url: string }[]>} - A Promise that resolves to an array of notification buttons.
 */
export async function getNotificationButtons(): Promise<{ text: string; url: string }[]> {
  const notifButtons: any[] = [];
  const jobUrl = await GitProvider.getJobUrl();
  if (jobUrl) {
    notifButtons.push({ text: "View Job", url: jobUrl });
  }
  return notifButtons;
}

/**
 * Returns a CommonMark / GitHub-flavored markdown representation of the current
 * Git branch. Notification providers (Slack, Teams, Email, etc.) convert this
 * to their own dialect on the way out.
 */
export async function getBranchMarkdown(): Promise<string> {
  const currentGitBranch = (await getCurrentGitBranch()) || "";
  const branchUrl = await GitProvider.getCurrentBranchUrl();
  if (branchUrl) {
    return UtilsNotifs.markdownLink(branchUrl, currentGitBranch);
  }
  return `**${currentGitBranch}**`;
}

/**
 * Returns a CommonMark / GitHub-flavored markdown representation of the
 * Salesforce org. When the org has no instance URL, falls back to the branch
 * markdown. Notification providers convert this to their own dialect on the
 * way out.
 */
export async function getOrgMarkdown(instanceUrl: string): Promise<string> {
  if (!instanceUrl) {
    return await getBranchMarkdown();
  }
  const label = instanceUrl.replace("https://", "").replace(".my.salesforce.com", "");
  return UtilsNotifs.markdownLink(instanceUrl, label);
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
    log: "📰",
  };
  return severityIcons[severity] || "❔";
}
