import { uxLog } from "../utils";
import * as c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot";
import { SlackProvider } from "./slackProvider";
import { UtilsNotifs as utilsNotifs } from "./utils";
import { TeamsProvider } from "./teamsProvider";
import { getConfig } from "../../config";

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
    return notifProviders;
  }

  // Post notifications to all configured channels
  // This method is sync to allow the command to continue and not negatively impact performances
  static postNotifications(notifMessage: NotifMessage) {
    getConfig("user").then((config) => {
      const notificationsDisable =
        config.notificationsDisable ?? (process.env?.NOTIFICATIONS_DISABLE ? process.env.NOTIFICATIONS_DISABLE.split(",") : []);
      if (notificationsDisable.includes(notifMessage.type)) {
        uxLog(
          this,
          c.yellow(
            `Skip notification of type ${notifMessage.type} according to configuration (NOTIFICATIONS_DISABLE env var or notificationsDisable .sfdx-hardis.yml property)`,
          ),
        );
      } else {
        uxLog(this, c.gray(`Handling notification of type ${notifMessage.type}...`));
        const notifProviders = this.getInstances();
        for (const notifProvider of notifProviders) {
          notifProvider.postNotification(notifMessage);
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

export interface NotifMessage {
  text: string;
  type:
    | "AUDIT_TRAIL"
    | "APEX_TESTS"
    | "BACKUP"
    | "DEPLOYMENT"
    | "LEGACY_API"
    | "LINT_ACCESS"
    | "UNUSED_METADATAS"
    | "METADATA_STATUS"
    | "MISSING_ATTRIBUTES";
  buttons?: NotifButton[];
  attachments?: any[];
  severity?: "critical" | "error" | "warning" | "info" | "success";
  sideImage?: string;
}

export interface NotifButton {
  text: string;
  url?: string;
  style?: "primary" | "danger";
}

export const UtilsNotifs = utilsNotifs;
