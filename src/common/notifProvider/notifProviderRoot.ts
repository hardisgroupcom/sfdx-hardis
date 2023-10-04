import { SfdxError } from "@salesforce/core";
import { uxLog } from "../utils";

export abstract class NotifProviderRoot {
  protected token: string;

  public getLabel(): string {
    throw new SfdxError("getLabel should be implemented on this call");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(_notifMessage: string, buttons: any[] = []): Promise<void> {
    uxLog(this, `Method postNotification is not implemented yet on ${this.getLabel()}`);
    return;
  }
}
