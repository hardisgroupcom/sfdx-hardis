import { SfdxError } from "@salesforce/core";
import * as DOMPurify from "isomorphic-dompurify";
import * as c from "chalk";
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
    const emailAddresses = mainEmailAddress.split(",");
    // Add branch custom Teams channel if defined
    const customEmailChannelVariable = `NOTIF_EMAIL_ADDRESS_${(await getCurrentGitBranch()).toUpperCase()}`;
    if (getEnvVar(customEmailChannelVariable)) {
      emailAddresses.push(...getEnvVar(customEmailChannelVariable).split(","));
    }

    // Handle specific channel for Warnings and errors
    const warningsErrorsEmail = getEnvVar("MS_TEAMS_WEBHOOK_URL_ERRORS_WARNINGS");
    if (warningsErrorsEmail && ["critical", "error", "warning"].includes(notifMessage.severity || null)) {
      emailAddresses.push(...warningsErrorsEmail.split(","));
    }
    /* jscpd:ignore-start */
    // Main block
    const firstLineMarkdown = UtilsNotifs.prefixWithSeverityEmoji(
      UtilsNotifs.slackToTeamsMarkdown(notifMessage.text.split("\n")[0]),
      notifMessage.severity,
    );
    const emailSubject = "[sfdx-hardis] " + removeMarkdown(firstLineMarkdown);
    let emailBody = UtilsNotifs.prefixWithSeverityEmoji(UtilsNotifs.slackToTeamsMarkdown(notifMessage.text), notifMessage.severity);

    // Add text details
    if (notifMessage?.attachments?.length > 0) {
      let text = "\n\n";
      for (const attachment of notifMessage.attachments) {
        if (attachment.text) {
          text += attachment.text + "\n\n";
        }
      }
      if (text !== "") {
        emailBody += UtilsNotifs.slackToTeamsMarkdown(text) + "\n\n";
      }
    }
    /* jscpd:ignore-end */

    // Add action blocks
    if (notifMessage.buttons?.length > 0) {
      emailBody += "**Links:**\n\n";
      for (const button of notifMessage.buttons) {
        // Url button
        if (button.url) {
          emailBody += "  - " + UtilsNotifs.markdownLink(button.url, button.text, "teams") + "\n\n";
        }
      }
      emailBody += "\n\n";
    }

    // Add sfdx-hardis ref
    emailBody += "_Powered by [sfdx-hardis](https://sfdx-hardis.cloudity.com)_";

    // Send email
    const emailBodyHtml1 = marked.parse(emailBody);
    const emailBodyHtml = typeof emailBodyHtml1 === "string" ? emailBodyHtml1 : await emailBodyHtml1;
    const emailBodyHtmlSanitized = DOMPurify.sanitize(emailBodyHtml);
    const emailMessage: EmailMessage = {
      subject: emailSubject,
      body_html: emailBodyHtmlSanitized,
      to: emailAddresses,
      attachments: notifMessage?.attachedFiles || [],
    };
    const emailRes = await sendEmail(emailMessage);
    if (emailRes.success) {
      uxLog(this, c.cyan(`[EmailProvider] Sent email to ${emailAddresses.join(",")}`));
    } else {
      uxLog(this, c.yellow(`[EmailProvider] Error while sending email to ${emailAddresses.join(",")}`));
      uxLog(this, c.grey(JSON.stringify(emailRes.detail, null, 2)));
    }
    return;
  }
}
