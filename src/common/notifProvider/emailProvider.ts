import { SfdxError } from "@salesforce/core";
import * as DOMPurify from "isomorphic-dompurify";
import { NotifProviderRoot } from "./notifProviderRoot";
import { getCurrentGitBranch, uxLog } from "../utils";
import { NotifMessage, UtilsNotifs } from ".";
import { getEnvVar } from "../../config";
import { marked } from "marked";
import { EmailMessage, sendEmail } from "../utils/emailUtils";
import { removeMarkdown } from "../utils/notifUtils";

export class EmailProvider extends NotifProviderRoot {
  public getLabel(): string {
    return "sfdx-hardis Email connector";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(notifMessage: NotifMessage): Promise<void> {
    const mainEmailAddress = getEnvVar("NOTIF_EMAIL_ADDRESS");
    if (mainEmailAddress == null) {
      throw new SfdxError("[EmailProvider] You need to define a variable NOTIF_EMAIL_ADDRESS to use sfdx-hardis Email notifications");
    }
    const emailAdresses = mainEmailAddress.split(",");
    // Add branch custom Teams channel if defined
    const customEmailChannelVariable = `NOTIF_EMAIL_ADDRESS_${(await getCurrentGitBranch()).toUpperCase()}`;
    if (getEnvVar(customEmailChannelVariable)) {
      emailAdresses.push(...getEnvVar(customEmailChannelVariable).split(","));
    }

    // Handle specific channel for Warnings and errors
    const warningsErrorsEmail = getEnvVar("MS_TEAMS_WEBHOOK_URL_ERRORS_WARNINGS");
    if (warningsErrorsEmail && ["critical", "error", "warning"].includes(notifMessage.severity || null)) {
      emailAdresses.push(...warningsErrorsEmail.split(","));
    }

    // Main block
    const firstLineMarkdown = UtilsNotifs.prefixWithSeverityEmoji(this.slackToTeamsMarkdown(notifMessage.text.split("\n")[0]), notifMessage.severity);
    const emailSubject = "[sfdx-hardis] " + removeMarkdown(firstLineMarkdown);
    let emailBody = UtilsNotifs.prefixWithSeverityEmoji(this.slackToTeamsMarkdown(notifMessage.text), notifMessage.severity);

    // Add text details
    if (notifMessage?.attachments?.length > 0) {
      let text = "\n\n";
      for (const attachment of notifMessage.attachments) {
        if (attachment.text) {
          text += attachment.text + "\n\n";
        }
      }
      if (text !== "") {
        emailBody += this.slackToTeamsMarkdown(text) + "\n\n";
      }
    }

    // Add action blocks
    if (notifMessage.buttons?.length > 0) {
      emailBody += "**Links:**\n\n";
      for (const button of notifMessage.buttons) {
        // Url button
        if (button.url) {
          emailBody += "  - " + UtilsNotifs.markdownLink(button.url, button.text, "teams") + "\n\n";
          emailBody += "  - " + UtilsNotifs.markdownLink(button.url, button.text, "teams");
        }
      }
      emailBody += "\n\n";
    }

    // Add sfdx-hardis ref
    emailBody += "_Powered by [sfdx-hardis](https://sfdx-hardis.cloudity.com)_";

    // Send email
    const emailBodyHtml1 = marked.parse(emailBody);
    const emailBodyHtml = typeof emailBodyHtml1 === 'string' ? emailBodyHtml1 : await emailBodyHtml1;
    const emailBodyHtmlSanitized = DOMPurify.sanitize(emailBodyHtml);
    const emailMessage: EmailMessage = {
      subject: emailSubject,
      body_html: emailBodyHtmlSanitized,
      to: emailAdresses
    }
    const emailRes = await sendEmail(emailMessage);
    if (emailRes) {
      uxLog(this, `[EmailProvider] Sent email to ${emailAdresses.join(";")}`);
    }
    return;
  }

  public slackToTeamsMarkdown(text: string) {
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
