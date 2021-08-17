/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { isCI, uxLog } from "../../../../common/utils";
import { exportData, selectDataWorkspace } from "../../../../common/utils/dataUtils";
import { promptOrgUsernameDefault } from "../../../../common/utils/orgUtils";

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
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdmu"];

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    let sfdmuPath = this.flags.path || null;
    //const debugMode = this.flags.debug || false;

    // Identify sfdmu workspace if not defined
    if (sfdmuPath == null) {
      sfdmuPath = await selectDataWorkspace({ selectDataLabel: "Please select a data workspace to EXPORT" });
    }

    // Select org that will be used to export records
    let orgUsername = this.org.getUsername();
    if (!isCI) {
      orgUsername = await promptOrgUsernameDefault(this, orgUsername, { devHub: false, setDefault: false });
    }

    // Export data from org
    await exportData(sfdmuPath, this, {
      sourceUsername: orgUsername,
    });

    // Output message
    const message = `Successfully exported data from sfdmu project ${c.green(sfdmuPath)} from org ${c.green(orgUsername)}`;
    uxLog(this, c.cyan(message));
    return { outputString: message };
  }
}
