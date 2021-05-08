/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { importData, selectDataWorkspace } from "../../../../common/utils/dataUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DataExport extends SfdxCommand {
  public static title = "Import data";

  public static description = messages.getMessage("orgDataImport");

  public static examples = ["$ sfdx hardis:org:data:import"];

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
    websocket: flags.string({
      description: messages.getMessage("websocket"),
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
    await importData(sfdmuPath, this, {
      targetUsername: this.org.getUsername(),
    });

    // Set bac initial cwd
    const message = `[sfdx-hardis] Successfully imported data from sfdmu workspace ${sfdmuPath}`;
    this.ux.log(c.green(message));
    return { orgId: this.org.getOrgId(), outputString: message };
  }
}
