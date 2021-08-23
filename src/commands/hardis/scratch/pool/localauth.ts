/* jscpd:ignore-start */
import * as c from "chalk";
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { getConfig } from "../../../../config";
import { uxLog } from "../../../../common/utils";
import { instanciateProvider } from "../../../../common/utils/poolUtils";
import { KeyValueProviderInterface } from "../../../../common/utils/keyValueUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ScratchPoolLocalAuth extends SfdxCommand {
  public static title = "Authenticate locally to scratch org pool";

  public static description =
    "Calls the related storage service to request api keys and secrets that allows a local user to fetch a scratch org from scratch org pool";

  public static examples = ["$ sfdx hardis:scratch:pool:localauth"];

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

    // Tell user if he/she's about to overwrite existing configuration
    if (!poolConfig.storageService) {
      uxLog(
        this,
        c.yellow(
          `There is not scratch orgs pool configured on this project. Please see with your tech lead about using command hardis:scratch:pool:configure`
        )
      );
      return { outputString: "Scratch org pool configuration to create" };
    }

    // Request additional setup to the user
    const provider: KeyValueProviderInterface = await instanciateProvider(poolConfig.storageService);
    await provider.userAuthenticate();

    // Return an object to be displayed with --json
    return { outputString: "Locally authenticated with scratch org pool" };
  }
}
