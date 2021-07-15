/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";

import { execCommand, uxLog } from "../../../../../common/utils";
import { promptOrg } from "../../../../../common/utils/orgUtils";
import { prompts } from "../../../../../common/utils/prompts";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DxSources2 extends SfdxCommand {
  public static title = "Retrieve sfdx sources from org (2)";

  public static description = messages.getMessage("retrieveDx");

  public static examples = ["$ sfdx hardis:org:retrieve:sources:dx2"];

  protected static flagsConfig = {
    packagexml: flags.string({
      char: "x",
      description: "Path to package.xml file",
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
  protected static supportsUsername = true;
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    let packageXml = this.flags.packagexml || null;
    let targetUsername = this.flags.targetusername || null;
    this.debugMode = this.flags.debug || false;

    // Prompt for organization if not sent
    if (targetUsername == null) {
      const org = await promptOrg(this, { setDefault: false });
      targetUsername = org.username;
    }

    // Prompt for package.xml if not sent
    if (packageXml === null) {
      const packageXmlRes = await prompts({
        message: c.cyanBright("Please input the path to the package.xml file to use force sfdx force:source:retrieve"),
        type: "text",
        name: "value",
      });
      packageXml = packageXmlRes.value;
    }

    // Check package.xml file exists
    if (!fs.existsSync(packageXml)) {
      throw new SfdxError(c.red("Package.xml file not found at " + packageXml));
    }
    // Copy package.xml in /tmp if provided value is not within project
    if (!path.resolve(packageXml).includes(path.resolve(process.cwd()))) {
      const packageXmlTmp = path.join(process.cwd(), "tmp", "retrievePackage.xml");
      await fs.ensureDir(path.dirname(packageXmlTmp));
      await fs.copy(packageXml, packageXmlTmp);
      uxLog(this, c.grey(`Copied ${packageXml} to ${packageXmlTmp}`));
      packageXml = path.relative(process.cwd(), packageXmlTmp);
    }

    // Retrieve sources
    const retrieveCommand = "sfdx force:source:retrieve" + ` -x "${packageXml}"` + ` --targetusername ${targetUsername}`;
    await execCommand(retrieveCommand, this, { fail: false, debug: this.debugMode, output: true });

    // Set bac initial cwd
    const message = `[sfdx-hardis] Successfully retrieved sfdx sources from ${c.bold(targetUsername)} using ${c.bold(packageXml)}`;
    uxLog(this, c.green(message));
    return { outputString: message };
  }
}
