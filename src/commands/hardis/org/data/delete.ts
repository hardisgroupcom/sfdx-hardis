/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import { isCI, uxLog } from "../../../../common/utils/index.js";
import { deleteData, selectDataWorkspace } from "../../../../common/utils/dataUtils";
import { promptOrgUsernameDefault } from "../../../../common/utils/orgUtils.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DataExport extends SfCommand<any> {
  public static title = "Delete data";

  public static description = messages.getMessage("orgDataDelete");

  public static examples = ["$ sf hardis:org:data:delete"];

  public static flags = {
    path: Flags.string({
      char: "p",
      description: "Path to the sfdmu workspace folder",
    }),
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
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdmu"];

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    let sfdmuPath = flags.path || null;

    // Identify sfdmu workspace if not defined
    if (sfdmuPath == null) {
      sfdmuPath = await selectDataWorkspace({ selectDataLabel: "Please select a data workspace to use for DELETION" });
    }

    // Select org that where records will be imported
    let orgUsername = this.org.getUsername();
    if (!isCI) {
      orgUsername = await promptOrgUsernameDefault(this, orgUsername, { devHub: false, setDefault: false });
    }

    // Export data from org
    await deleteData(sfdmuPath, this, {
      targetUsername: orgUsername,
    });

    // Output message
    const message = `Successfully deleted data from org ${c.green(orgUsername)} using SFDMU project ${c.green(sfdmuPath)}`;
    uxLog(this, c.cyan(message));
    return { outputString: message };
  }
}
