/* jscpd:ignore-start */
import c from "chalk";
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { getConfig } from "../../../../config/index.js";
import { uxLog } from "../../../../common/utils/index.js";
import { getPoolStorage } from "../../../../common/utils/poolUtils.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ScratchPoolView extends SfCommand<any> {
  public static title = "View scratch org pool info";

  public static description = "Displays all stored content of project scratch org pool if defined";

  public static examples = ["$ sf hardis:scratch:pool:view"];

  // public static args = [{name: 'file'}];

  public static flags = {
    debug: Flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
    'target-dev-hub': requiredHubFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ScratchPoolView);
    // Get pool configuration
    const config = await getConfig("project");
    const poolConfig = config.poolConfig || {};
    uxLog(this, "Pool config: " + c.grey(JSON.stringify(poolConfig, null, 2)));

    // Missing scratch orgs pool configuration
    if (!poolConfig.storageService) {
      uxLog(
        this,
        c.yellow(
          `There is not scratch orgs pool configured on this project. Please see with your tech lead about using command hardis:scratch:pool:configure`,
        ),
      );
      return { status: 1, outputString: "Scratch org pool configuration to create" };
    }

    // Query pool storage
    const poolStorage = await getPoolStorage({ devHubConn: flags["target-dev-hub"]?.getConnection(), devHubUsername: flags["target-dev-hub"]?.getUsername() });
    uxLog(this, "Pool storage: " + c.grey(JSON.stringify(poolStorage, null, 2)));

    const scratchOrgs = poolStorage.scratchOrgs || [];
    const availableNumber = scratchOrgs.length;

    // Display logs
    uxLog(this, c.cyan(`There are ${c.bold(availableNumber)} available scratch orgs`));

    // Return an object to be displayed with --json
    return {
      status: 0,
      outputString: "Viewed scratch org pool",
      poolStorage: poolStorage,
      availableScratchOrgs: availableNumber,
      maxScratchOrgs: poolConfig.maxScratchOrgsNumber,
    };
  }
}
