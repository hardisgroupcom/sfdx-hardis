/* jscpd:ignore-start */

import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import { MetadataUtils } from "../../../../../common/metadata-utils";
import { createTempDir, execCommand, uxLog } from "../../../../../common/utils";
import { deployDestructiveChanges, deployMetadatas } from "../../../../../common/utils/deployUtils";
import { getConfig } from "../../../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DxSources extends SfdxCommand {
  public static title = "Deploy metadata sources to org";

  public static description = messages.getMessage("deployMetadatas");

  public static examples = ["$ sfdx hardis:project:deploy:sources:metadata"];

  protected static flagsConfig = {
    check: flags.boolean({
      char: "c",
      default: false,
      description: messages.getMessage("checkOnly"),
    }),
    packagexml: flags.string({
      char: "p",
      description: "Path to package.xml file to deploy",
    }),
    filter: flags.boolean({
      char: "f",
      default: false,
      description: "Filter metadatas before deploying",
    }),
    destructivepackagexml: flags.string({
      char: "k",
      description: "Path to destructiveChanges.xml file to deploy",
    }),
    testlevel: flags.enum({
      char: "l",
      default: "RunLocalTests",
      options: ["NoTestRun", "RunSpecifiedTests", "RunLocalTests", "RunAllTestsInOrg"],
      description: messages.getMessage("testLevel"),
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

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdx-essentials"];

  protected configInfo: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const check = this.flags.check || false;
    const packageXml = this.flags.packagexml || null;
    const filter = this.flags.filter || false;
    const destructivePackageXml = this.flags.destructivepackagexml || null;
    const testlevel = this.flags.testlevel || "RunLocalTests";
    const debugMode = this.flags.debug || false;
    this.configInfo = await getConfig("branch");

    // Install packages
    const packages = this.configInfo.installedPackages || [];
    if (packages.length > 0 && !check) {
      await MetadataUtils.installPackagesOnOrg(packages, null, this, "deploy");
    }

    const destructiveProcessed = false;
    let deployProcessed = false;

    // Deploy sources
    const packageXmlFile =
      packageXml || process.env.PACKAGE_XML_TO_DEPLOY || this.configInfo.packageXmlToDeploy || fs.existsSync("./manifest/package.xml")
        ? "./manifest/package.xml"
        : fs.existsSync("./package.xml")
        ? "./package.xml"
        : "./config/package.xml";
    if (fs.existsSync(packageXmlFile)) {
      let deployDir = ".";
      // Filter if necessary
      if (filter) {
        const tmpDir = await createTempDir();
        const filterCommand = "sfdx essentials:metadata:filter-from-packagexml" + ` -i ${deployDir}` + ` -p ${packageXmlFile}` + ` -o ${tmpDir}`;
        deployDir = tmpDir;
        await execCommand(filterCommand, this, {
          output: true,
          debugMode,
          fail: true,
        });
      }
      // Perform deployment
      const deployRes = await deployMetadatas({
        deployDir,
        testlevel,
        check,
        soap: true,
        debug: debugMode,
      });
      let message = "";
      if (deployRes.status === 0) {
        deployProcessed = true;
        message = "[sfdx-hardis] Successfully deployed sfdx project sources to Salesforce org";
        this.ux.log(c.green(message));
      } else {
        message = "[sfdx-hardis] Unable to deploy sfdx project sources to Salesforce org";
        this.ux.log(c.red(deployRes.errorMessage));
      }
    } else {
      uxLog(this, "No package.xml found so no deployment has been performed");
    }

    // Deploy destructive changes
    const packageDeletedXmlFile =
      destructivePackageXml ||
      process.env.PACKAGE_XML_TO_DELETE ||
      this.configInfo.packageXmlToDelete ||
      fs.existsSync("./manifest/destructiveChanges.xml")
        ? "./manifest/destructiveChanges.xml"
        : fs.existsSync("./destructiveChanges.xml")
        ? "./destructiveChanges.xml"
        : "./config/destructiveChanges.xml";
    if (fs.existsSync(packageDeletedXmlFile)) {
      await deployDestructiveChanges(packageDeletedXmlFile, { debug: debugMode, check }, this);
    } else {
      uxLog(this, "No destructivePackage.Xml found so no destructive deployment has been performed");
    }

    return {
      orgId: this.org.getOrgId(),
      deployProcessed,
      destructiveProcessed,
      outputString: "",
    };
  }
}
