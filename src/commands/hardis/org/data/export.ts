/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import { isCI, uxLog } from "../../../../common/utils/index.js";
import { exportData, selectDataWorkspace } from "../../../../common/utils/dataUtils";
import { promptOrgUsernameDefault } from "../../../../common/utils/orgUtils.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DataExport extends SfCommand<any> {
  public static title = "Export data";

  public static description = `Export data from an org using a [SFDX Data Loader](https://help.sfdmu.com/) Project

See article:

[![How to detect bad words in Salesforce records using SFDX Data Loader and sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-badwords.jpg)](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)
`;

  public static examples = ["$ sf hardis:org:data:export"];

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
    const { flags } = await this.parse(DataExport);
    let sfdmuPath = flags.path || null;
    //const debugMode = flags.debug || false;

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
