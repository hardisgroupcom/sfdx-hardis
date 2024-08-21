/* jscpd:ignore-start */
import * as c from "chalk";
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { getPoolStorage, setPoolStorage } from "../../../../common/utils/poolUtils";
import { getConfig } from "../../../../config";
import { execCommand, uxLog } from "../../../../common/utils";
import { authenticateWithSfdxUrlStore } from "../../../../common/utils/orgUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ScratchPoolReset extends SfdxCommand {
  public static title = "Reset scratch org pool";

  public static description = "Reset scratch org pool (delete all scratches in the pool)";

  public static examples = ["$ sf hardis:scratch:pool:refresh"];

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
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  /* jscpd:ignore-end */
  private debugMode = false;

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;

    // Check pool configuration is defined on project
    const config = await getConfig("project");
    if (config.poolConfig == null) {
      uxLog(this, c.yellow("Configuration file must contain a poolConfig property") + "\n" + c.grey(JSON.stringify(config, null, 2)));
      return { outputString: "Configuration file must contain a poolConfig property" };
    }
    uxLog(this, c.cyan(`Reseting scratch org pool on org ${c.green(this.hubOrg.getUsername())}...`));
    uxLog(this, c.grey("Pool config: " + JSON.stringify(config.poolConfig)));

    // Get pool storage
    const poolStorage = await getPoolStorage({ devHubConn: this.hubOrg.getConnection(), devHubUsername: this.hubOrg.getUsername() });
    let scratchOrgs = poolStorage.scratchOrgs || [];

    // Delete existing scratch orgs
    /* jscpd:ignore-start */
    const scratchOrgsToDelete = [...scratchOrgs];
    scratchOrgs = [];
    poolStorage.scratchOrgs = scratchOrgs;
    await setPoolStorage(poolStorage, { devHubConn: this.hubOrg.getConnection(), devHubUsername: this.hubOrg.getUsername() });
    for (const scratchOrgToDelete of scratchOrgsToDelete) {
      // Authenticate to scratch org to delete
      await authenticateWithSfdxUrlStore(scratchOrgToDelete);
      // Delete scratch org
      const deleteCommand = `sf org delete scratch --no-prompt --target-org ${scratchOrgToDelete.scratchOrgUsername}`;
      await execCommand(deleteCommand, this, { fail: false, debug: this.debugMode, output: true });
      uxLog(
        this,
        c.cyan(
          `Scratch org ${c.green(scratchOrgToDelete.scratchOrgUsername)} at ${
            scratchOrgToDelete?.authFileJson?.result?.instanceUrl
          } has been deleted`,
        ),
      );
    }
    /* jscpd:ignore-end */

    return { outputString: "Reset scratch orgs pool" };
  }
}
