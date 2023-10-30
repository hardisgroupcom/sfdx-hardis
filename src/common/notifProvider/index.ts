import { uxLog } from "../utils";
import * as c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot";
import { SlackProvider } from "./slackProvider";
import { UtilsNotifs as utilsNotifs } from "./utils";

export abstract class NotifProvider {
  static getInstances(): NotifProviderRoot[] {
    const notifProviders: NotifProviderRoot[] = [];
    // Slack
    if (UtilsNotifs.isSlackAvailable()) {
      notifProviders.push(new SlackProvider());
    }
    return notifProviders;
  }

  static postNotifications(notifMessage: string, buttons: any[] = [], attachments: any[] = []) {
    const notifProviders = this.getInstances();
    for (const notifProvider of notifProviders) {
      notifProvider.postNotification(notifMessage, buttons, attachments);
    }
  }

  public getLabel(): string {
    return "get label should be implemented !";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(notifMessage: string, buttons: any[] = [], attachments: any[] = []): Promise<void> {
    uxLog(this, c.grey("method postNotification is not implemented on " + this.getLabel()));
  }
}

export const UtilsNotifs = utilsNotifs;
