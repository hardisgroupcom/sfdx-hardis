/* jscpd:ignore-start */
/*
To test locally, you can call the command like that:

Gitlab: CI=true CI_SFDX_HARDIS_GITLAB_TOKEN=XXX CI_PROJECT_ID=YYY CI_JOB_TOKEN=xxx NODE_OPTIONS=--inspect-brk sfdx hardis:project:deploy:sources:dx --targetusername nicolas.vuillamy@cloudity.com.demointeg

Azure: CI=true SYSTEM_ACCESSTOKEN=XXX SYSTEM_COLLECTIONURI=https://dev.azure.com/MyAzureCollection/ BUILD_REPOSITORY_ID=XXX CI_JOB_TOKEN=xxx NODE_OPTIONS=--inspect-brk sfdx hardis:project:deploy:sources:dx --targetusername nicolas.vuillamy@cloudity.com.muuuurf

- Before, you need to make a sfdx alias:set myBranch=myUsername
- You can find CI_PROJECT_ID with https://gitlab.com/api/v4/projects?search=YOUR-REPO-NAME

*/

import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { MetadataUtils } from "../../../../../common/metadata-utils";
import { createTempDir, getCurrentGitBranch, isCI, uxLog } from "../../../../../common/utils";
import { getConfig } from "../../../../../config";
import { forceSourceDeploy, removePackageXmlContent } from "../../../../../common/utils/deployUtils";
import { promptOrg } from "../../../../../common/utils/orgUtils";
import { getApexTestClasses } from "../../../../../common/utils/classUtils";
import { listMajorOrgs, restoreListViewMine } from "../../../../../common/utils/orgConfigUtils";
import { NotifProvider, UtilsNotifs } from "../../../../../common/notifProvider";
import { GitProvider } from "../../../../../common/gitProvider";
import { callSfdxGitDelta, getGitDeltaScope } from "../../../../../common/utils/gitUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DxSources extends SfdxCommand {
  public static title = "Deploy sfdx sources to org";

  public static description = `Deploy SFDX source to org, following deploymentPlan in .sfdx-hardis.yml

In case of errors, [tips to fix them](https://sfdx-hardis.cloudity.com/deployTips/) will be included within the error messages.

### Quick Deploy

In case Pull Request comments are configured on the project, Quick Deploy will try to be used (equivalent to button Quick Deploy)

If you do not want to use QuickDeploy, define variable \`SFDX_HARDIS_QUICK_DEPLOY=false\`

- [GitHub Pull Requests comments config](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-github/)
- [Gitlab Merge requests notes config](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-gitlab/)
- [Azure Pull Requests comments config](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-azure/)

### Delta deployments

To activate delta deployments, define property \`useDeltaDeployment: true\` in \`config/.sfdx-hardis.yml\`.

This will activate delta deployments only between minor and major branches (major to major remains full deployment mode)

If you want to force the delta deployment into major orgs (ex: preprod to prod), this is not recommended but you can use env variable ALWAYS_ENABLE_DELTA_DEPLOYMENT=true

### Dynamic deployment items / Overwrite management

If necessary,you can define the following files (that supports wildcards <members>*</members>):

- \`manifest/package-no-overwrite.xml\`: Every element defined in this file will be deployed only if it is not existing yet in the target org (can be useful with ListView for example, if the client wants to update them directly in production org)
- \`manifest/packageXmlOnChange.xml\`: Every element defined in this file will not be deployed if it already has a similar definition in target org (can be useful for SharingRules for example)

See [Overwrite management documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-config-overwrite/)

### Deployment plan

If you need to deploy in multiple steps, you can define a property \`deploymentPlan\` in \`.sfdx-hardis.yml\`.

- If a file \`manifest/package.xml\` is found, it will be placed with order 0 in the deployment plan

- If a file \`manifest/destructiveChanges.xml\` is found, it will be executed as --postdestructivechanges

- If env var \`SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES\` is defined as \`false\` , split of package.xml will be applied

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

### Automated fixes post deployments

#### List view with scope Mine

If you defined a property **listViewsToSetToMine** in your .sfdx-hardis.yml, related ListViews will be set to Mine ( see command <https://sfdx-hardis.cloudity.com/hardis/org/fix/listviewmine/> )

Example:

\`\`\`yaml
listViewsToSetToMine:
  - "Operation__c:MyCurrentOperations"
  - "Operation__c:MyFinalizedOperations"
  - "Opportunity:Default_Opportunity_Pipeline"
  - "Opportunity:MyCurrentSubscriptions"
  - "Opportunity:MySubscriptions"
  - "Account:MyActivePartners"
\`\`\`

Troubleshooting: if you need to fix ListViews with mine from an alpine-linux based docker image, use this workaround in your dockerfile:

\`\`\`dockerfile
# Do not use puppeteer embedded chromium
RUN apk add --update --no-cache chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"
ENV CHROMIUM_PATH="/usr/bin/chromium-browser"
ENV PUPPETEER_EXECUTABLE_PATH="$\\{CHROMIUM_PATH}" // remove \\ before {
\`\`\`

If you need to increase the deployment waiting time (force:source:deploy --wait arg), you can define env var SFDX_DEPLOY_WAIT_MINUTES
  `;

  public static examples = ["$ sfdx hardis:project:deploy:sources:dx", "$ sfdx hardis:project:deploy:sources:dx --check"];

  protected static flagsConfig = {
    check: flags.boolean({
      char: "c",
      default: false,
      description: messages.getMessage("checkOnly"),
    }),
    testlevel: flags.enum({
      char: "l",
      default: "RunLocalTests",
      options: ["NoTestRun", "RunSpecifiedTests", "RunRepositoryTests", "RunLocalTests", "RunAllTestsInOrg"],
      description: messages.getMessage("testLevelExtended"),
    }),
    runtests: flags.string({
      char: "r",
      description: messages.getMessage("runtests"),
    }),
    packagexml: flags.string({
      char: "p",
      description: "Path to package.xml containing what you want to deploy in target org",
    }),
    delta: flags.boolean({
      default: false,
      description: "Applies sfdx-git-delta to package.xml before other deployment processes",
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

  protected checkOnly = false;
  protected configInfo: any = {};
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.configInfo = await getConfig("branch");
    this.checkOnly = this.flags.check || false;
    const deltaFromArgs = this.flags.delta || false;

    const givenTestlevel = this.flags.testlevel || this.configInfo.testLevel || "";
    let testClasses = this.flags.runtests || this.configInfo.runtests || "";

    // Auto-detect all APEX test classes within project in order to run "dynamic" RunSpecifiedTests deployment
    if (givenTestlevel === "RunRepositoryTests") {
      const testClassList = await getApexTestClasses();
      if (Array.isArray(testClassList) && testClassList.length) {
        this.flags.testlevel = "RunSpecifiedTests";
        testClasses = testClassList.join();
      } else {
        // Default back to RunLocalTests in case if repository has zero tests
        this.flags.testlevel = "RunLocalTests";
        testClasses = "";
      }
    }

    const testlevel = this.flags.testlevel || this.configInfo.testLevel || "RunLocalTests";

    // Test classes are only valid for RunSpecifiedTests
    if (testlevel != "RunSpecifiedTests") {
      testClasses = "";
    }

    const packageXml = this.flags.packagexml || null;
    this.debugMode = this.flags.debug || false;
    const currentGitBranch = await getCurrentGitBranch();

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
      this.checkOnly === false ||
      process.env.INSTALL_PACKAGES_DURING_CHECK_DEPLOY === "true" ||
      this.configInfo.installPackagesDuringCheckDeploy === true;
    if (packages.length > 0 && installPackages) {
      // Install packages only if we are in real deployment mode
      await MetadataUtils.installPackagesOnOrg(packages, targetUsername, this, "deploy");
    } else if (packages.length > 0 && this.checkOnly === true) {
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

    // Display missing packages message
    if (missingPackages.length > 0) {
      for (const package1 of missingPackages) {
        uxLog(
          this,
          c.yellow(
            `You may need to install package ${c.bold(package1.SubscriberPackageName)} ${c.bold(
              package1.SubscriberPackageVersionId,
            )} in target org to validate the deployment check`,
          ),
        );
      }
      uxLog(this, "");
      uxLog(
        this,
        c.yellow(
          c.italic(
            `If you want deployment checks to automatically install packages, please define ${c.bold(
              "INSTALL_PACKAGES_DURING_CHECK_DEPLOY=true",
            )} in ENV vars, or property ${c.bold("installPackagesDuringCheckDeploy: true")} in .sfdx-hardis.yml`,
          ),
        ),
      );
    }

    // Get package.xml
    let packageXmlFile =
      packageXml || process.env.PACKAGE_XML_TO_DEPLOY || this.configInfo.packageXmlToDeploy || fs.existsSync("./manifest/package.xml")
        ? "./manifest/package.xml"
        : "./config/package.xml";
    const forceSourceDeployOptions: any = {
      targetUsername: targetUsername,
      conn: this.org?.getConnection(),
      testClasses: testClasses,
    };
    // Get destructiveChanges.xml and add it in options if existing
    const packageDeletedXmlFile =
      process.env.PACKAGE_XML_TO_DELETE || this.configInfo.packageXmlToDelete || fs.existsSync("./manifest/destructiveChanges.xml")
        ? "./manifest/destructiveChanges.xml"
        : "./config/destructiveChanges.xml";
    if (fs.existsSync(packageDeletedXmlFile)) {
      forceSourceDeployOptions.postDestructiveChanges = packageDeletedXmlFile;
    }

    // Compute and apply delta if required
    let delta = false;
    if (
      (deltaFromArgs === true || process.env.USE_DELTA_DEPLOYMENT === "true" || this.configInfo.useDeltaDeployment === true) &&
      (await this.isDeltaAllowed()) === true
    ) {
      delta = true;
      // Define delta deployment depending on context
      let fromCommit = "HEAD";
      let toCommit = "HEAD^";
      if (this.checkOnly) {
        // In deployment check context
        const prInfo = await GitProvider.getPullRequestInfo();
        const deltaScope = await getGitDeltaScope(prInfo?.sourceBranch || currentGitBranch, prInfo?.targetBranch || process.env.FORCE_TARGET_BRANCH);
        fromCommit = deltaScope.fromCommit;
        toCommit = deltaScope.toCommit.hash;
      }
      // call delta
      uxLog(this, c.cyan("Generating git delta package.xml and destructiveChanges.xml ..."));
      const tmpDir = await createTempDir();
      await callSfdxGitDelta(fromCommit, toCommit, tmpDir, { debug: this.debugMode });

      // Update package.xml
      const packageXmlFileDeltaDeploy = path.join(tmpDir, "package", "packageDelta.xml");
      await fs.copy(packageXmlFile, packageXmlFileDeltaDeploy);
      packageXmlFile = packageXmlFileDeltaDeploy;
      const diffPackageXml = path.join(tmpDir, "package", "package.xml");
      await removePackageXmlContent(packageXmlFile, diffPackageXml, true, { debugMode: this.debugMode, keepEmptyTypes: false });

      const deltaContent = await fs.readFile(packageXmlFile, "utf8");
      uxLog(this, c.cyan("Final Delta package.xml to deploy:\n" + c.green(deltaContent)));

      // Update destructiveChanges.xml
      if (forceSourceDeployOptions.postDestructiveChanges) {
        const destructiveXmlFileDeploy = path.join(tmpDir, "destructiveChanges", "destructiveChangesDelta.xml");
        await fs.copy(forceSourceDeployOptions.postDestructiveChanges, destructiveXmlFileDeploy);
        const diffDestructiveChangesXml = path.join(tmpDir, "destructiveChanges", "destructiveChanges.xml");
        await removePackageXmlContent(destructiveXmlFileDeploy, diffDestructiveChangesXml, true, {
          debugMode: this.debugMode,
          keepEmptyTypes: false,
        });
        forceSourceDeployOptions.postDestructiveChanges = destructiveXmlFileDeploy;
        const deltaContentDelete = await fs.readFile(destructiveXmlFileDeploy, "utf8");
        uxLog(this, c.cyan("Final Delta destructiveChanges.xml to delete:\n" + c.yellow(deltaContentDelete)));
      }
    }

    // Process deployment (or deployment check)
    const { messages } = await forceSourceDeploy(packageXmlFile, this.checkOnly, testlevel, this.debugMode, this, forceSourceDeployOptions);

    // Set ListViews to scope Mine if defined in .sfdx-hardis.yml
    if (this.configInfo.listViewsToSetToMine && this.checkOnly === false) {
      await restoreListViewMine(this.configInfo.listViewsToSetToMine, this.org.getConnection(), { debug: this.debugMode });
    }

    // Send notification of deployment success
    if (!this.checkOnly) {
      const targetLabel = this.org?.getConnection()?.getUsername() === targetUsername ? this.org?.getConnection()?.instanceUrl : targetUsername;
      const linkMarkdown = UtilsNotifs.markdownLink(targetLabel, targetLabel.replace("https://", "").replace(".my.salesforce.com", ""));
      let branchMd = `*${currentGitBranch}*`;
      const branchUrl = await GitProvider.getCurrentBranchUrl();
      if (branchUrl) {
        branchMd = UtilsNotifs.markdownLink(branchUrl, currentGitBranch);
      }
      let notifMessage = `Deployment has been successfully processed from branch ${branchMd} to org ${linkMarkdown}`;
      notifMessage += delta ? " (🌙 delta deployment)" : " (🌕 full deployment)";
      const notifButtons = [];
      const jobUrl = await GitProvider.getJobUrl();
      if (jobUrl) {
        notifButtons.push({ text: "View Deployment Job", url: jobUrl });
      }
      const pullRequestInfo = await GitProvider.getPullRequestInfo();
      if (pullRequestInfo) {
        const prUrl = pullRequestInfo.web_url || pullRequestInfo.html_url || pullRequestInfo.url;
        const prAuthor = pullRequestInfo?.author?.login || pullRequestInfo?.author?.name || null;
        notifMessage += `\nRelated: <${prUrl}|${pullRequestInfo.title}>` + (prAuthor ? ` by ${prAuthor}` : "");
        const prButtonText = "View Pull Request";
        notifButtons.push({ text: prButtonText, url: prUrl });
      }
      NotifProvider.postNotifications({ text: notifMessage, buttons: notifButtons, severity: "success" });
    }
    return { orgId: this.org.getOrgId(), outputString: messages.join("\n") };
  }

  async isDeltaAllowed() {
    if (process.env?.DISABLE_DELTA_DEPLOYMENT === "true") {
      uxLog(this, c.yellow(`Delta deployment has been explicitly disabled with variable DISABLE_DELTA_DEPLOYMENT=true`));
      return false;
    }
    if (process.env?.ALWAYS_ENABLE_DELTA_DEPLOYMENT === "true") {
      uxLog(this, c.yellow(`Delta deployment has been explicitly enabled with variable ALWAYS_ENABLE_DELTA_DEPLOYMENT=true`));
      uxLog(
        this,
        c.yellow(`It is recommended to use delta deployments for merges between major branches, use this config at your own responsibility`),
      );
      return true;
    }
    let currentBranch = await getCurrentGitBranch();
    let parentBranch = process.env.FORCE_TARGET_BRANCH || null;
    const prInfo = await GitProvider.getPullRequestInfo();
    if (prInfo) {
      currentBranch = prInfo.sourceBranch;
      parentBranch = prInfo.targetBranch;
    }
    const majorOrgs = await listMajorOrgs();
    uxLog(this, c.grey("Major orgs with auth configured:\n" + JSON.stringify(majorOrgs, null, 2)));
    const currentBranchIsMajor = majorOrgs.some((majorOrg) => majorOrg.branchName === currentBranch);
    const parentBranchIsMajor = majorOrgs.some((majorOrg) => majorOrg.branchName === parentBranch);
    if (currentBranchIsMajor && (parentBranchIsMajor === true || parentBranch == null)) {
      uxLog(
        this,
        c.yellow(
          `This is not safe to use delta between major branches (${c.bold(currentBranch)} to ${c.bold(parentBranch)}): using full deployment mode`,
        ),
      );
      return false;
    }
    uxLog(this, c.cyan(`Delta allowed between minor branch (${currentBranch}) and major branch (${parentBranch}): using delta deployment mode`));
    return true;
  }
}
