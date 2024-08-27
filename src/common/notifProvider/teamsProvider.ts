import c from "chalk";
import { NotifProviderRoot } from "./notifProviderRoot";
import { uxLog } from "../utils";
import { NotifMessage } from "./index.js";

export class TeamsProvider extends NotifProviderRoot {
  public getLabel(): string {
    return "sfdx-hardis MsTeams connector (DEPRECATED)";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postNotification(notifMessage: NotifMessage): Promise<void> {
    uxLog(
      this,
      c.bold(c.yellow(`[TeamsProvider] MsTeams Web Hooks will be soon deprecated. Instead, please use EmailProvider with Ms Teams Channel e-mail`)),
    );
    uxLog(this, c.bold(c.yellow(`[TeamsProvider] User Guide: https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-email/`)));
  }
}
