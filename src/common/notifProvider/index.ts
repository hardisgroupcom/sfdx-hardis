import { uxLog } from "../utils";
import * as c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot";
import { SlackProvider } from "./slackProvider";
import { UtilsNotifs as utilsNotifs } from "./utils/index.js";
import { TeamsProvider } from "./teamsProvider";
import { getConfig } from "../../config/index.js";
import { EmailProvider } from "./emailProvider";
import { ApiProvider } from "./apiProvider";

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
  static postNotifications(notifMessage: NotifMessage) {
    getConfig("user").then((config) => {
      const notificationsDisable =
        config.notificationsDisable ?? (process.env?.NOTIFICATIONS_DISABLE ? process.env.NOTIFICATIONS_DISABLE.split(",") : []);
      uxLog(this, c.gray(`[NotifProvider] Handling notification of type ${notifMessage.type}...`));
      const notifProviders = this.getInstances();
      if (notifProviders.length === 0) {
        uxLog(
          this,
          c.gray(
            `[NotifProvider] No notif has been configured: https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integrations-home/#message-notifications`,
          ),
        );
      }
      for (const notifProvider of notifProviders) {
        uxLog(this, c.gray(`[NotifProvider] - Notif target found: ${notifProvider.getLabel()}`));
        // Skip if matching NOTIFICATIONS_DISABLE except for Api
        if (notificationsDisable.includes(notifMessage.type) && notifProvider.isUserNotifProvider()) {
          uxLog(
            this,
            c.yellow(
              `[NotifProvider] Skip notification of type ${notifMessage.type} according to configuration (NOTIFICATIONS_DISABLE env var or notificationsDisable .sfdx-hardis.yml property)`,
            ),
          );
        }
        // Do not send notifs for level "log" to Users, but just to logs/metrics API
        else if (notifProvider.isApplicableForNotif(notifMessage)) {
          notifProvider.postNotification(notifMessage);
        } else {
          uxLog(this, c.gray(`[NotifProvider] - Skipped: ${notifProvider.getLabel()} as not applicable for notification severity`));
        }
      }
    });
  }

  public getLabel(): string {
    return "get label should be implemented !";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(notifMessage: string, buttons: any[] = [], attachments: any[] = []): Promise<void> {
    uxLog(this, c.grey("method postNotification is not implemented on " + this.getLabel()));
  }
}

export type NotifSeverity = "critical" | "error" | "warning" | "info" | "success" | "log";

export interface NotifMessage {
  text: string;
  type:
  | "ACTIVE_USERS"
  | "AUDIT_TRAIL"
  | "APEX_TESTS"
  | "BACKUP"
  | "DEPLOYMENT"
  | "LEGACY_API"
  | "LICENSES"
  | "LINT_ACCESS"
  | "UNUSED_METADATAS"
  | "METADATA_STATUS"
  | "MISSING_ATTRIBUTES"
  | "UNUSED_LICENSES"
  | "UNUSED_USERS"
  | "ORG_INFO"
  | "ORG_LIMITS";
  buttons?: NotifButton[];
  attachments?: any[];
  severity: NotifSeverity;
  sideImage?: string;
  attachedFiles?: string[];
  logElements: any[];
  metrics: any;
  data: any;
}

export interface NotifButton {
  text: string;
  url?: string;
  style?: "primary" | "danger";
}

export const UtilsNotifs = utilsNotifs;
