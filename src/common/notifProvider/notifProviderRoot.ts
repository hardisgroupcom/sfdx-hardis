import { SfdxError } from "@salesforce/core";
import { uxLog } from "../utils";
import { MessageAttachment } from "@slack/web-api";

export abstract class NotifProviderRoot {
  protected token: string;

  public getLabel(): string {
    throw new SfdxError("getLabel should be implemented on this call");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(_notifMessage: string, buttons: any[] = [], attachments: MessageAttachment[] = []): Promise<void> {
    uxLog(this, `Method postNotification is not implemented yet on ${this.getLabel()}`);
    return;
  }
}
