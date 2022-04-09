/* jscpd:ignore-start */

import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import { MetadataUtils } from "../../../../../common/metadata-utils";
import { isCI, uxLog } from "../../../../../common/utils";
import { getConfig } from "../../../../../config";
import { forceSourceDeploy } from "../../../../../common/utils/deployUtils";
import { promptOrg } from "../../../../../common/utils/orgUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DxSources extends SfdxCommand {
  public static title = "Deploy sfdx sources to org";

  public static description = `Deploy SFDX source to org, following deploymentPlan in .sfdx-hardis.yml

In case of errors, [tips to fix them](https://hardisgroupcom.github.io/sfdx-hardis/deployTips/) will be included within the error messages.

### Dynamic deployment items

If necessary,you can define the following files (that supports wildcards <members>*</members>):

- \`manifest/packageDeployOnce.xml\`: Every element defined in this file will be deployed only if it is not existing yet in the target org (can be useful with ListView for example, if the client wants to update them directly in production org)
- \`manifest/packageXmlOnChange.xml\`: Every element defined in this file will not be deployed if it already has a similar definition in target org (can be useful for SharingRules for example)

### Deployment plan

If you need to deploy in multiple steps, you can define a property \`deploymentPlan\` in \`.sfdx-hardis.yml\`.

- If a file \`manifest/package.xml\` is found, it will be placed with order 0 in the deployment plan

- If a file \`manifest/destructiveChanges.xml\` is found, it will be executed as --postdestructivechanges

- If env var \`SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES\` is defined as \`true\` , split of package.xml will be ignored

Example:

\`\`\`yaml
deploymentPlan:
  packages:
    - label: Deploy Flow-Workflow
      packageXmlFile: manifest/splits/packageXmlFlowWorkflow.xml
      order: 6
    - label: Deploy SharingRules - Case
      packageXmlFile: manifest/splits/packageXmlSharingRulesCase.xml
      order: 30
      waitAfter: 30
\`\`\`

### Packages installation

You can define a list of package to install during deployments using property \`installedPackages\`

- If \`INSTALL_PACKAGES_DURING_CHECK_DEPLOY\` is defined as \`true\` (or \`installPackagesDuringCheckDeploy: true\` in \`.sfdx-hardis.yml\`), packages will be installed even if the command is called with \`--check\` mode
- You can automatically update this property by listing all packages installed on an org using command \`sfdx hardis:org:retrieve:packageconfig\`

Example:

\`\`\`yaml
installedPackages:
  - Id: 0A35r0000009EtECAU
    SubscriberPackageId: 033i0000000LVMYAA4
    SubscriberPackageName: Marketing Cloud
    SubscriberPackageNamespace: et4ae5
    SubscriberPackageVersionId: 04t6S000000l11iQAA
    SubscriberPackageVersionName: Marketing Cloud
    SubscriberPackageVersionNumber: 236.0.0.2
    installOnScratchOrgs: true                  // true or false depending you want to install this package when creating a new scratch org
    installDuringDeployments: true              // set as true to install package during a deployment using sfdx hardis:project:deploy:sources:dx
    installationkey: xxxxxxxxxxxxxxxxxxxx       // if the package has a password, write it in this property
    - Id: 0A35r0000009F9CCAU
    SubscriberPackageId: 033b0000000Pf2AAAS
    SubscriberPackageName: Declarative Lookup Rollup Summaries Tool
    SubscriberPackageNamespace: dlrs
    SubscriberPackageVersionId: 04t5p000001BmLvAAK
    SubscriberPackageVersionName: Release
    SubscriberPackageVersionNumber: 2.15.0.9
    installOnScratchOrgs: true
    installDuringDeployments: true
\`\`\`
  `;

  public static examples = ["$ sfdx hardis:project:deploy:sources:dx"];

  protected static flagsConfig = {
    check: flags.boolean({
      char: "c",
      default: false,
      description: messages.getMessage("checkOnly"),
    }),
    testlevel: flags.enum({
      char: "l",
      default: "RunLocalTests",
      options: ["NoTestRun", "RunSpecifiedTests", "RunLocalTests", "RunAllTestsInOrg"],
      description: messages.getMessage("testLevel"),
    }),
    packagexml: flags.string({
      char: "p",
      description: "Path to package.xml containing what you want to deploy in target org",
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

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected configInfo: any = {};
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.configInfo = await getConfig("branch");
    const check = this.flags.check || false;
    const testlevel = this.flags.testlevel || this.configInfo.testLevel || "RunLocalTests";
    const packageXml = this.flags.packagexml || null;
    this.debugMode = this.flags.debug || false;

    // Get target org
    let targetUsername = this.org.getUsername();
    if (!isCI) {
      const targetOrg = await promptOrg(this, { devHub: false, setDefault: false, scratch: false });
      targetUsername = targetOrg.username;
    }

    // Install packages
    const packages = this.configInfo.installedPackages || [];
    const missingPackages = [];
    const installPackages =
      check === false || process.env.INSTALL_PACKAGES_DURING_CHECK_DEPLOY === "true" || this.configInfo.installPackagesDuringCheckDeploy === true;
    if (packages.length > 0 && installPackages) {
      // Install packages only if we are in real deployment mode
      await MetadataUtils.installPackagesOnOrg(packages, targetUsername, this, "deploy");
    } else if (packages.length > 0 && check === true) {
      // If check mode, warn if there are missing packages
      const alreadyInstalled = await MetadataUtils.listInstalledPackages(targetUsername, this);
      for (const package1 of packages) {
        if (
          alreadyInstalled.filter((installedPackage: any) => package1.SubscriberPackageVersionId === installedPackage.SubscriberPackageVersionId)
            .length === 0 &&
          package1.installDuringDeployments === true
        ) {
          missingPackages.push(package1);
        }
      }
    }

    // Get package.xml
    const packageXmlFile =
      packageXml || process.env.PACKAGE_XML_TO_DEPLOY || this.configInfo.packageXmlToDeploy || fs.existsSync("./manifest/package.xml")
        ? "./manifest/package.xml"
        : "./config/package.xml";
    const forceSourceDeployOptions: any = {
      targetUsername: targetUsername,
      conn: this.org?.getConnection(),
    };
    // Get destructiveChanges.xml and add it in options if existing
    const packageDeletedXmlFile =
      process.env.PACKAGE_XML_TO_DELETE || this.configInfo.packageXmlToDelete || fs.existsSync("./manifest/destructiveChanges.xml")
        ? "./manifest/destructiveChanges.xml"
        : "./config/destructiveChanges.xml";
    if (fs.existsSync(packageDeletedXmlFile)) {
      forceSourceDeployOptions.postDestructiveChanges = packageDeletedXmlFile;
    }

    // Display missing packages message
    if (missingPackages.length > 0) {
      for (const package1 of missingPackages) {
        uxLog(
          this,
          c.yellow(
            `You may need to install package ${c.bold(package1.SubscriberPackageName)} ${c.bold(
              package1.SubscriberPackageVersionId
            )} in target org to validate the deployment check`
          )
        );
      }
      uxLog(this, "");
      uxLog(
        this,
        c.yellow(
          c.italic(
            `If you want deployment checks to automatically install packages, please define ${c.bold(
              "INSTALL_PACKAGES_DURING_CHECK_DEPLOY=true"
            )} in ENV vars, or property ${c.bold("installPackagesDuringCheckDeploy: true")} in .sfdx-hardis.yml`
          )
        )
      );
    }

    // Process deployment (or deployment check)
    const { messages } = await forceSourceDeploy(packageXmlFile, check, testlevel, this.debugMode, this, forceSourceDeployOptions);

    return { orgId: this.org.getOrgId(), outputString: messages.join("\n") };
  }
}
