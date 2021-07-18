/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { isCI, uxLog } from "../../../../common/utils";
import { importData, selectDataWorkspace } from "../../../../common/utils/dataUtils";
import { promptOrgUsernameDefault } from "../../../../common/utils/orgUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DataImport extends SfdxCommand {
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
  protected static requiresProject = false;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdmu"];

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    let sfdmuPath = this.flags.path || null;

    // Identify sfdmu workspace if not defined
    if (sfdmuPath == null) {
      sfdmuPath = await selectDataWorkspace();
    }

    // Select org that where records will be imported
    let orgUsername = this.org.getUsername();
    if (!isCI) {
      orgUsername = await promptOrgUsernameDefault(this, orgUsername, { devHub: false, setDefault: false });
    }

    // Export data from org
    await importData(sfdmuPath, this, {
      targetUsername: orgUsername,
    });

    // Output message
    const message = `Successfully import data from sfdmu project ${c.green(sfdmuPath)} into org ${c.green(orgUsername)}`;
    uxLog(this, c.cyan(message));
    return { outputString: message };
  }
}
