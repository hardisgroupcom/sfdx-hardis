/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { exportData, selectDataWorkspace } from "../../../../common/utils/dataUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DataExport extends SfdxCommand {
  public static title = "Export data";

  public static description = messages.getMessage("orgDataExport");

  public static examples = ["$ sfdx hardis:org:data:export"];

  protected static flagsConfig = {
    path: flags.string({
      char: "p",
      description: "Path to the sfdmu workspace folder",
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdmu"];

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    let sfdmuPath = this.flags.path || null;
    //const debugMode = this.flags.debug || false;

    // Identify sfdmu workspace if not defined
    if (sfdmuPath == null) {
      sfdmuPath = await selectDataWorkspace();
    }

    // Export data from org
    await exportData(sfdmuPath, this, {
      sourceUsername: this.org.getUsername(),
    });

    // Set bac initial cwd
    const message = `[sfdx-hardis] Successfully exported data from sfdmu workspace ${sfdmuPath}`;
    this.ux.log(c.green(message));
    return { orgId: this.org.getOrgId(), outputString: message };
  }
}
