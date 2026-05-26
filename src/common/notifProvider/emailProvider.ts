import { SfError } from "@salesforce/core";
import c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot.js";
import { getCurrentGitBranch, uxLog } from "../utils/index.js";
import type { NotificationChannel, NotifMessage } from "./types.js";
import { UtilsNotifs } from "./utils.js";
import { convertMarkdownToHtml } from "./markdownToHtml.js";
import { convertMarkdownToPlainText } from "./markdownToPlainText.js";
import { CONSTANTS, getBannerMarkdownAndLink, getEnvVar } from "../../config/index.js";
import { EmailMessage, extractEmailSoapErrors, getEmailErrorAdviceKeys, sendEmail } from "../utils/emailUtils.js";
import { getEffectiveNotificationConfig, getEmailRecipientsConfig } from "./notificationConfig.js";
import { t } from "../utils/i18n.js";

export class EmailProvider extends NotifProviderRoot {
  public getLabel(): string {
    return "sfdx-hardis Email connector";
  }

  public getChannel(): NotificationChannel {
    return "email";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(notifMessage: NotifMessage): Promise<void> {
    const effectiveConfig = await getEffectiveNotificationConfig(notifMessage.type);
    const { recipients: yamlRecipients, replace: replaceRecipients } = getEmailRecipientsConfig(effectiveConfig);
    const sanitizedYamlRecipients = yamlRecipients.map((address) => address.trim()).filter((address) => address.length > 0);

    let emailAddresses: string[] = [];
    if (replaceRecipients && sanitizedYamlRecipients.length > 0) {
      emailAddresses = [...sanitizedYamlRecipients];
      uxLog(
        "log",
        this,
        c.grey(t("emailRecipientsReplacedByConfig", { type: notifMessage.type, recipients: emailAddresses.join(",") })),
      );
    } else {
      const mainEmailAddress = getEnvVar("NOTIF_EMAIL_ADDRESS");
      if (mainEmailAddress == null && sanitizedYamlRecipients.length === 0) {
        throw new SfError("[EmailProvider] You need to define a variable NOTIF_EMAIL_ADDRESS to use sfdx-hardis Email notifications");
      }
      if (mainEmailAddress != null) {
        emailAddresses.push(...mainEmailAddress.split(","));
      }
      // Add branch custom emails if defined
      const customEmailChannelVariable = `NOTIF_EMAIL_ADDRESS_${(await getCurrentGitBranch() || "").toUpperCase()}`;
      if (getEnvVar(customEmailChannelVariable)) {
        emailAddresses.push(...(getEnvVar(customEmailChannelVariable) || "").split(","));
      }
      // Add notif type custom emails if defined
      const customEmailNotifTypeVariable = `NOTIF_EMAIL_ADDRESS_${notifMessage.type.toUpperCase()}`;
      if (getEnvVar(customEmailNotifTypeVariable)) {
        emailAddresses.push(...(getEnvVar(customEmailNotifTypeVariable) || "").split(","));
      }
      if (sanitizedYamlRecipients.length > 0) {
        emailAddresses.push(...sanitizedYamlRecipients);
        uxLog(
          "log",
          this,
          c.grey(
            t("emailRecipientsAppendedFromConfig", { type: notifMessage.type, recipients: sanitizedYamlRecipients.join(",") }),
          ),
        );
      }
    }
    // Deduplicate while preserving order
    emailAddresses = Array.from(
      new Set(emailAddresses.map((address) => address.trim()).filter((address) => address.length > 0)),
    );

    /* jscpd:ignore-start */
    // Subject: first line of the CommonMark body, with severity emoji prefix, stripped to plain text.
    const firstLinePlain = UtilsNotifs.prefixWithSeverityEmoji(
      convertMarkdownToPlainText(notifMessage.text.split("\n")[0]),
      notifMessage.severity,
    );
    const emailSubject = "[sfdx-hardis] " + firstLinePlain;

    // Body is authored in CommonMark by the caller; we just prefix the severity emoji and append.
    let emailBody = UtilsNotifs.prefixWithSeverityEmoji(notifMessage.text, notifMessage.severity);

    // Add text details
    if (notifMessage?.attachments?.length && notifMessage?.attachments?.length > 0) {
      let text = "\n\n";
      for (const attachment of notifMessage.attachments) {
        if (attachment.text) {
          text += attachment.text + "\n\n";
        }
      }
      if (text !== "") {
        emailBody += text + "\n\n";
      }
    }
    /* jscpd:ignore-end */

    // Add action blocks
    if (notifMessage.buttons?.length && notifMessage.buttons?.length > 0) {
      emailBody += "**Links:**\n\n";
      for (const button of notifMessage.buttons) {
        // Url button
        if (button.url) {
          emailBody += "  - " + UtilsNotifs.markdownLink(button.url, button.text) + "\n\n";
        }
      }
      emailBody += "\n\n";
    }

    // Add sfdx-hardis ref
    emailBody += `_Powered by [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT})_`;

    emailBody += "\n\n" + getBannerMarkdownAndLink() + "\n\n";

    // Convert CommonMark to sanitized HTML.
    const emailBodyHtmlSanitized = await convertMarkdownToHtml(emailBody);
    const emailMessage: EmailMessage = {
      subject: emailSubject,
      body_html: emailBodyHtmlSanitized,
      to: emailAddresses,
      attachments: notifMessage?.attachedFiles || [],
    };
    const emailRes = await sendEmail(emailMessage);
    if (emailRes?.success) {
      uxLog("log", this, c.cyan(`[EmailProvider] Sent email to ${emailAddresses.join(",")}`));
    } else {
      uxLog("warning", this, c.yellow(`[EmailProvider] Error while sending email to ${emailAddresses.join(",")}`));
      /* Parse the SOAP envelope, surface a concise statusCode + message line per error, then a remediation block */
      const parsedErrors = extractEmailSoapErrors(emailRes?.detail);
      for (const err of parsedErrors) {
        uxLog(
          "warning",
          this,
          c.yellow(`[EmailProvider] ${err.statusCode || "ERROR"}: ${err.message || "(no message)"}`),
        );
      }
      const adviceKeys = getEmailErrorAdviceKeys(parsedErrors);
      for (const key of adviceKeys) {
        uxLog("warning", this, c.cyan(`[EmailProvider] ${t(key)}`));
      }
      /* Always keep the raw SOAP detail at log level for diagnostics */
      uxLog("log", this, c.grey(JSON.stringify(emailRes?.detail, null, 2)));
    }
    return;
  }
}
