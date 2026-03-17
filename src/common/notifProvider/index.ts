import { isCI, uxLog } from "../utils/index.js";
import c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot.js";
import { SlackProvider } from "./slackProvider.js";
import { UtilsNotifs as utilsNotifs } from "./utils.js";
import { TeamsProvider } from "./teamsProvider.js";
import { CONSTANTS, getConfig } from "../../config/index.js";
import { EmailProvider } from "./emailProvider.js";
import { ApiProvider } from "./apiProvider.js";
import type { NotifMessage } from "./types.js";
import { t } from '../utils/i18n.js';

export abstract class NotifProvider {
  static getInstances(): NotifProviderRoot[] {
    const notifProviders: NotifProviderRoot[] = [];
    // Slack
    if (UtilsNotifs.isSlackAvailable()) {
      notifProviders.push(new SlackProvider());
    }
    // Ms Teams
    if (UtilsNotifs.isMsTeamsAvailable()) {
      notifProviders.push(new TeamsProvider());
    }
    // Email
    if (UtilsNotifs.isEmailAvailable()) {
      notifProviders.push(new EmailProvider());
    }
    // Api
    if (UtilsNotifs.isApiAvailable()) {
      notifProviders.push(new ApiProvider());
    }
    return notifProviders;
  }

  // Post notifications to all configured channels
  // This method is sync to allow the command to continue and not negatively impact performances
  static async postNotifications(notifMessage: NotifMessage) {
    const config = await getConfig("user");
    const notificationsDisable =
      config.notificationsDisable ?? (process.env?.NOTIFICATIONS_DISABLE ? process.env.NOTIFICATIONS_DISABLE.split(",") : []);
    uxLog("log", this, c.grey(`[NotifProvider] Handling notification of type ${notifMessage.type}...`));
    const notifProviders = this.getInstances();
    if (notifProviders.length === 0 && isCI) {
      uxLog(
        "log",
        this,
        c.grey(
          `[NotifProvider] No notif has been configured: ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-integrations-home/#message-notifications`,
        ),
      );
    }
    for (const notifProvider of notifProviders) {
      uxLog("log", this, c.grey(`[NotifProvider] - Notif target found: ${notifProvider.getLabel()}`));
      // Skip if matching NOTIFICATIONS_DISABLE except for Api
      if (notificationsDisable.includes(notifMessage.type) && notifProvider.isUserNotifProvider()) {
        uxLog(
          "warning",
          this,
          c.yellow(
            `[NotifProvider] Skip notification of type ${notifMessage.type} according to configuration (NOTIFICATIONS_DISABLE env var or notificationsDisable .sfdx-hardis.yml property)`,
          ),
        );
      }
      // Do not send notifs for level "log" to Users, but just to logs/metrics API
      else if (notifProvider.isApplicableForNotif(notifMessage)) {
        await notifProvider.postNotification(notifMessage);
      } else {
        uxLog("error", this, c.grey(`[NotifProvider] - Skipped: ${notifProvider.getLabel()} as not applicable for notification severity`));
      }
    }
  }

  public getLabel(): string {
    return "get label should be implemented !";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(notifMessage: string, buttons: any[] = [], attachments: any[] = []): Promise<void> {
    uxLog("log", this, c.grey(t('methodPostnotificationIsNotImplementedOn') + this.getLabel()));
  }
}

export const UtilsNotifs = utilsNotifs;
export type { NotifMessage, NotifButton, NotifSeverity } from "./types.js";
