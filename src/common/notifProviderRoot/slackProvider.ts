import { SfdxError } from "@salesforce/core";
import * as c from 'chalk';
import { NotifProviderRoot } from "./notifProviderRoot";
import { WebClient } from "@slack/web-api";
import { getCurrentGitBranch, uxLog } from "../utils";

export class SlackProvider extends NotifProviderRoot {
    private slackClient: InstanceType<typeof WebClient>;

    constructor() {
        super();
        this.token = process.env.SLACK_TOKEN;
        this.slackClient = new WebClient(this.token);
    }

    public getLabel(): string {
        return "sfdx-hardis Slack connector";
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public async postNotification(notifMessage: string, buttons: any[] = []): Promise<void> {
        const mainNotifsChannelId = process.env.SLACK_CHANNEL_ID || null;
        if (mainNotifsChannelId == null) {
            throw new SfdxError("You need to define a variable SLACK_CHANNEL_ID to use sfdx-hardis Slack Integration. Otherwise, remove variable SLACK_TOKEN");
        }
        const slackChannelsIds = [mainNotifsChannelId];
        // Add branch custom slack channel if defined
        const customSlackChannelVariable = `SLACK_CHANNEL_ID_${(await getCurrentGitBranch())}`;
        if (process.env[customSlackChannelVariable]) {
            slackChannelsIds.push(process.env[customSlackChannelVariable])
        }
        // Main block
        const blocks: any = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": notifMessage
                }
            }
        ];
        // Add buttons if sent
        if (buttons.length > 0) {
            for (const button of buttons) {
                // Url button
                if (button.url) {
                    blocks.push({
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": button.text
                        },
                        "style": button.style || "primary",
                        "url": button.url
                    })
                }
            }
        }
        for (const slackChannelId of slackChannelsIds) {
            try {
                const resp = await this.slackClient.chat.postMessage({
                    blocks: blocks,
                    channel: slackChannelId,
                });
                uxLog(this, c.gray(`Sent slack notification to channel ${mainNotifsChannelId}: ${resp.ok}`));
            } catch (error) {
                uxLog(this, c.red(`Error while sending message to channel ${mainNotifsChannelId}\n${error.message}`));
            }
        }
        return;
    }

}
