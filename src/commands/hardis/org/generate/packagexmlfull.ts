/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as path from "path";
import { isCI, uxLog } from "../../../../common/utils";
import { getReportDirectory } from "../../../../config";
import { buildOrgManifest } from "../../../../common/utils/deployUtils";
import { promptOrgUsernameDefault } from "../../../../common/utils/orgUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class GeneratePackageXmlFull extends SfdxCommand {
  public static title = "Generate Full Org package.xml";

  public static description = "Generates full org package.xml, including managed items";

  public static examples = [
    "$ sfdx hardis:org:generate:packagexmlfull",
    "$ sfdx hardis:org:generate:packagexmlfull --outputfile /tmp/packagexmlfull.xml",
    "$ sfdx hardis:org:generate:packagexmlfull --targetusername nico@example.com",
  ];

  protected static flagsConfig = {
    outputfile: flags.string({
      description: "Output package.xml file",
    }),
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
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected debugMode = false;
  protected outputFile;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.outputFile = this.flags.outputfile || null;
    this.debugMode = this.flags.debugMode || false;

    // Select org that will be used to export records
    let conn = null;
    let orgUsername = this.org.getUsername();
    if (!isCI) {
      const prevOrgUsername = orgUsername;
      orgUsername = await promptOrgUsernameDefault(this, orgUsername, { devHub: false, setDefault: false });
      if (prevOrgUsername === orgUsername) {
        conn = this.org.getConnection();
      }
    }
    uxLog(this, c.cyan(`Generating full package xml for ${orgUsername}`));

    // Calculate default output file if not provided as input
    if (this.outputFile == null) {
      const reportDir = await getReportDirectory();
      this.outputFile = path.join(reportDir, "org-package-xml-full.xml");
    }

    await buildOrgManifest(orgUsername, this.outputFile, conn);

    uxLog(this, c.cyan(`Generated full package.xml for ${orgUsername} at location ${c.green(this.outputFile)}`));

    // Return an object to be displayed with --json
    return { outputString: `Generated full package.xml for ${orgUsername}`, outputFile: this.outputFile };
  }
}
