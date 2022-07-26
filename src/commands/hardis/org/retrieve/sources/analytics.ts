/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as path from "path";
// import * as path from "path";
import { uxLog, isCI, createTempDir, execCommand } from "../../../../../common/utils";

import { promptOrgUsernameDefault } from "../../../../../common/utils/orgUtils";
import { buildOrgManifest } from "../../../../../common/utils/deployUtils";
import { parsePackageXmlFile, writePackageXmlFile } from "../../../../../common/utils/xmlUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class Retrofit extends SfdxCommand {
  public static title = "Retrieve CRM Analytics configuration from an org";

  public static description = `Retrieve all CRM Analytics sources from an org, with workarounds for SFDX bugs`;

  public static examples = ["$ sfdx hardis:org:retrieve:sources:analytics"];

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
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected configInfo: any = {};
  protected debugMode = false;
  /* jscpd:ignore-end */

  protected analyticsMetadataTypes = ["WaveApplication", "WaveDashboard", "WaveDataflow", "WaveDataset", "WaveLens", "WaveRecipe", "WaveXmd"];

  // Retrieves locally all items corresponding to CRM Analytics configuration
  public async run(): Promise<AnyJson> {
    // Manage user selection for org if we are not in CI
    let orgUsername = this.org.getUsername();
    if (!isCI && !this.flags.targetusername) {
      orgUsername = await promptOrgUsernameDefault(this, orgUsername, { devHub: false, setDefault: false });
    }

    // List all metadatas of target org
    const tmpDir = await createTempDir();
    const packageXmlAllFile = path.join(tmpDir, "packageXmlAll.xml");
    await buildOrgManifest(orgUsername, packageXmlAllFile, this.org.getConnection());
    const parsedPackageXmlAll = await parsePackageXmlFile(packageXmlAllFile);
    uxLog(this, c.cyan(`Retrieved full package XML from org ${orgUsername}: ${packageXmlAllFile}`));

    // Filter to keep only analytics metadatas
    const packageXmlAnalyticsFile = path.join(tmpDir, "packageXmlAnalytics.xml");
    const analyticsPackageXml = {};
    for (const type of Object.keys(parsedPackageXmlAll)) {
      if (this.analyticsMetadataTypes.includes(type)) {
        analyticsPackageXml[type] = parsedPackageXmlAll[type];
      }
    }
    await writePackageXmlFile(packageXmlAnalyticsFile,analyticsPackageXml);
    uxLog(this, c.cyan(`Filtered and completed analytics metadatas in analytics package XML: ${packageXmlAnalyticsFile}`));

    // Retrieve locally Analytics sources
    const retrieveCommand = `sfdx force:source:retrieve -x "${packageXmlAnalyticsFile}" -u ${orgUsername}`;
    await execCommand(retrieveCommand, this, { fail: true, debug: this.debugMode, output: true });
    uxLog(this, c.cyan(`Retrieved all analytics source items using package XML: ${packageXmlAnalyticsFile}`));

    return { outputString: `Retrieved analytics sources from org ${orgUsername}` };
  }
}
