/* jscpd:ignore-start */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { MetadataUtils } from "../../../../../common/metadata-utils/index.js";
import { createTempDir, execCommand, uxLog } from "../../../../../common/utils/index.js";
import { deployDestructiveChanges, deployMetadatas } from "../../../../../common/utils/deployUtils.js";
import { getConfig } from "../../../../../config/index.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DxSources extends SfCommand<any> {
  public static title = "Deploy metadata sources to org";

  public static description = messages.getMessage("deployMetadatas");

  public static examples = ["$ sf hardis:project:deploy:sources:metadata"];

  public static flags = {
    check: Flags.boolean({
      char: "c",
      default: false,
      description: messages.getMessage("checkOnly"),
    }),
    deploydir: Flags.string({
      char: "x",
      default: ".",
      description: "Deploy directory",
    }),
    packagexml: Flags.string({
      char: "p",
      description: "Path to package.xml file to deploy",
    }),
    filter: Flags.boolean({
      char: "f",
      default: false,
      description: "Filter metadatas before deploying",
    }),
    destructivepackagexml: Flags.string({
      char: "k",
      description: "Path to destructiveChanges.xml file to deploy",
    }),
    testlevel: Flags.enum({
      char: "l",
      default: "RunLocalTests",
      options: ["NoTestRun", "RunSpecifiedTests", "RunLocalTests", "RunAllTestsInOrg"],
      description: messages.getMessage("testLevel"),
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
  protected static requiresSfdxPlugins = ["sfdx-essentials"];

  protected configInfo: any = {};
  protected deployDir: any = ".";

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    uxLog(this, c.red("This command is deprecated and will be removed in January 2025"));
    uxLog(this, c.red("Nobody used Metadata format anymore :)"));
    uxLog(this, c.red("If you think it should be kept and maintained, please post an issue on sfdx-hardis GitHub repository"));

    const check = flags.check || false;
    const packageXml = flags.packagexml || null;
    const filter = flags.filter || false;
    const destructivePackageXml = flags.destructivepackagexml || null;
    const testlevel = flags.testlevel || "RunLocalTests";
    const debugMode = flags.debug || false;
    this.deployDir = flags.deploydir || ".";
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
          : fs.existsSync(path.join(this.deployDir, "package.xml"))
            ? path.join(this.deployDir, "package.xml")
            : "./config/package.xml";
    if (fs.existsSync(packageXmlFile)) {
      // Filter if necessary
      if (filter) {
        const tmpDir = await createTempDir();
        // sfdx-essentials still here but deprecated and will be removed
        const filterCommand = "sfdx essentials:metadata:filter-from-packagexml" + ` -i ${this.deployDir}` + ` -p ${packageXmlFile}` + ` -o ${tmpDir}`;
        this.deployDir = tmpDir;
        await execCommand(filterCommand, this, {
          output: true,
          debugMode,
          fail: true,
        });
      }
      // Perform deployment
      const deployRes = await deployMetadatas({
        deployDir: this.deployDir,
        testlevel,
        check,
        soap: true,
        debug: debugMode,
        tryOnce: true,
      });
      let message = "";
      if (deployRes.status === 0) {
        deployProcessed = true;
        message = "[sfdx-hardis] Successfully deployed sfdx project sources to Salesforce org";
        uxLog(this, c.green(message));
      } else {
        message = "[sfdx-hardis] Unable to deploy sfdx project sources to Salesforce org";
        uxLog(this, c.red(deployRes.errorMessage));
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
          : fs.existsSync(path.join(this.deployDir, "destructiveChanges.xml"))
            ? path.join(this.deployDir, "destructiveChanges.xml")
            : "./config/destructiveChanges.xml";
    if (fs.existsSync(packageDeletedXmlFile)) {
      await deployDestructiveChanges(packageDeletedXmlFile, { debug: debugMode, check }, this);
    } else {
      uxLog(this, "No destructivePackage.Xml found so no destructive deployment has been performed");
    }

    return {
      orgId: flags['target-org'].getOrgId(),
      deployProcessed,
      destructiveProcessed,
      outputString: "",
    };
  }
}
