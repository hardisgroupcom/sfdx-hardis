import { uxLog } from "../utils";
import * as c from 'chalk';
import { NotifProviderRoot } from "./notifProviderRoot";
import { SlackProvider } from "./slackProvider";

export abstract class NotifProvider {
    static getInstances(): NotifProviderRoot[] {
        const notifProviders: NotifProviderRoot[] = [];
        // Slack
        if (process.env.SLACK_TOKEN) {
            notifProviders.push(new SlackProvider());
        }
        return notifProviders;
    }

    static postNotifications(notifMessage: string, buttons: any[] = []) {
        const notifProfiders = this.getInstances();
        for (const notifProfider of notifProfiders) {
            notifProfider.postNotification(notifMessage, buttons);
        }
    }

    public getLabel(): string {
        return "get label should be implemented !";
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public async postNotification(notifMessage: string, buttons: any[] = []): Promise<void> {
        uxLog(this, c.grey('method postNotification is not implemented on ' + this.getLabel()));
    }
}