import { SfdxError } from "@salesforce/core";
import { uxLog } from "../utils";
import { NotifMessage } from ".";

export abstract class NotifProviderRoot {
  protected token: string;

  public getLabel(): string {
    throw new SfdxError("getLabel should be implemented on this call");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(notifMessage: NotifMessage): Promise<void> {
    uxLog(this, `Method postNotification is not implemented yet on ${this.getLabel()}`);
    return;
  }
}
