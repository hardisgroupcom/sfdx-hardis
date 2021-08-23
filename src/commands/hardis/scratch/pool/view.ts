/* jscpd:ignore-start */
import * as c from "chalk";
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { getConfig } from "../../../../config";
import { uxLog } from "../../../../common/utils";
import { getPoolStorage } from "../../../../common/utils/poolUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ScratchPoolView extends SfdxCommand {
  public static title = "View scratch org pool info";

  public static description = "Displays all stored content of project scratch org pool if defined";

  public static examples = ["$ sfdx hardis:scratch:pool:view"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    // Get pool configuration
    const config = await getConfig("project");
    const poolConfig = config.poolConfig || {};
    uxLog(this,"Pool config: "+c.grey(JSON.stringify(poolConfig,null,2)));

    // Missing scratch orgs pool configuration
    if (!poolConfig.storageService) {
      uxLog(
        this,
        c.yellow(
          `There is not scratch orgs pool configured on this project. Please see with your tech lead about using command hardis:scratch:pool:configure`
        )
      );
      return { outputString: "Scratch org pool configuration to create" };
    }

    // Query pool storage
    const poolStorage = await getPoolStorage();
    uxLog(this, "Pool storage: " + c.grey(JSON.stringify(poolStorage, null, 2)));
    // Display logs

    // Return an object to be displayed with --json
    return { outputString: "Viewed scratch org pool", poolStorage: poolStorage };
  }
}
