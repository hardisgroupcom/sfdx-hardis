/* jscpd:ignore-start */
/*
To test locally, you can call the command like that:

Gitlab: CI=true CI_SFDX_HARDIS_GITLAB_TOKEN=XXX CI_PROJECT_ID=YYY CI_JOB_TOKEN=xxx NODE_OPTIONS=--inspect-brk sf hardis:project:deploy:smart --target-org nicolas.vuillamy@cloudity.com.demointeg

Azure: CI=true SYSTEM_ACCESSTOKEN=XXX SYSTEM_COLLECTIONURI=https://dev.azure.com/MyAzureCollection/ BUILD_REPOSITORY_ID=XXX CI_JOB_TOKEN=xxx NODE_OPTIONS=--inspect-brk sf hardis:project:deploy:smart --target-org nicolas.vuillamy@cloudity.com.muuuurf

- Before, you need to make a sf alias set myBranch=myUsername
- You can find CI_PROJECT_ID with https://gitlab.com/api/v4/projects?search=YOUR-REPO-NAME

*/

import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { MetadataUtils } from '../../../../common/metadata-utils/index.js';
import {
  createTempDir,
  getCurrentGitBranch,
  getLatestGitCommit,
  isCI,
  uxLog,
} from '../../../../common/utils/index.js';
import { CONSTANTS, getConfig } from '../../../../config/index.js';
import { smartDeploy, removePackageXmlContent } from '../../../../common/utils/deployUtils.js';
import { isProductionOrg, promptOrgUsernameDefault } from '../../../../common/utils/orgUtils.js';
import { getApexTestClasses } from '../../../../common/utils/classUtils.js';
import { listMajorOrgs, restoreListViewMine } from '../../../../common/utils/orgConfigUtils.js';
import { NotifProvider, UtilsNotifs } from '../../../../common/notifProvider/index.js';
import { GitProvider } from '../../../../common/gitProvider/index.js';
import { callSfdxGitDelta, computeCommitsSummary, getGitDeltaScope } from '../../../../common/utils/gitUtils.js';
import { getBranchMarkdown, getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { MessageAttachment } from '@slack/web-api';
import { TicketProvider } from '../../../../common/ticketProvider/index.js';
import { parsePackageXmlFile } from '../../../../common/utils/xmlUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class SmartDeploy extends SfCommand<any> {
  public static title = 'Smart Deploy sfdx sources to org';

  public static aliases = [
    "hardis:project:deploy:sources:dx"
  ]

  public static description = `Smart deploy of SFDX sources to target org, with many useful options.

In case of errors, [tips to fix them](${CONSTANTS.DOC_URL_ROOT}/deployTips/) will be included within the error messages.

### Quick Deploy

In case Pull Request comments are configured on the project, Quick Deploy will try to be used (equivalent to button Quick Deploy)

If you do not want to use QuickDeploy, define variable \`SFDX_HARDIS_QUICK_DEPLOY=false\`

- [GitHub Pull Requests comments config](${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-integration-github/)
- [Gitlab Merge requests notes config](${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-integration-gitlab/)
- [Azure Pull Requests comments config](${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-integration-azure/)

### Delta deployments

To activate delta deployments, define property \`useDeltaDeployment: true\` in \`config/.sfdx-hardis.yml\`.

This will activate delta deployments only between minor and major branches (major to major remains full deployment mode)

If you want to force the delta deployment into major orgs (ex: preprod to prod), this is not recommended but you can use env variable ALWAYS_ENABLE_DELTA_DEPLOYMENT=true

### Smart Deployments Tests

Not all metadata updates can break test classes, use Smart Deployment Tests to skip running test classes if ALL the following conditions are met:

- Delta deployment is activated and applicable to the source and target branches
- Delta deployed metadatas are all matching the list of **NOT_IMPACTING_METADATA_TYPES** (see below)
- Target org is not a production org

Activate Smart Deployment tests with:

- env variable \`USE_SMART_DEPLOYMENT_TESTS=true\`
- .sfdx-hardis.yml config property \`useSmartDeploymentTests: true\`

Defaut list for **NOT_IMPACTING_METADATA_TYPES** (can be overridden with comma-separated list on env var NOT_IMPACTING_METADATA_TYPES)

- Audience
- AuraDefinitionBundle
- Bot
- BotVersion
- ContentAsset
- CustomObjectTranslation
- CustomSite
- CustomTab
- Dashboard
- ExperienceBundle
- Flexipage
- GlobalValueSetTranslation
- Layout
- LightningComponentBundle
- NavigationMenu
- ReportType
- Report
- SiteDotCom
- StandardValueSetTranslation
- StaticResource
- Translations

Note: if you want to disable Smart test classes for a PR, add **nosmart** in the text of the latest commit.

### Dynamic deployment items / Overwrite management

If necessary,you can define the following files (that supports wildcards <members>*</members>):

- \`manifest/package-no-overwrite.xml\`: Every element defined in this file will be deployed only if it is not existing yet in the target org (can be useful with ListView for example, if the client wants to update them directly in production org).
  - Can be overridden for a branch using .sfdx-hardis.yml property **packageNoOverwritePath** or environment variable PACKAGE_NO_OVERWRITE_PATH (for example, define: \`packageNoOverwritePath: manifest/package-no-overwrite-main.xml\` in config file \`config/.sfdx-hardis.main.yml\`)
- \`manifest/packageXmlOnChange.xml\`: Every element defined in this file will not be deployed if it already has a similar definition in target org (can be useful for SharingRules for example)

See [Overwrite management documentation](${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-config-overwrite/)

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
- You can automatically update this property by listing all packages installed on an org using command \`sf hardis:org:retrieve:packageconfig\`

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
    installDuringDeployments: true              // set as true to install package during a deployment using sf hardis:project:deploy:smart
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

### Deployment pre or post commands

You can define command lines to run before or after a deployment, with parameters:

- **id**: Unique Id for the command
- **label**: Human readable label for the command
- **skipIfError**: If defined to "true", the post-command won't be run if there is a deployment failure
- **context**: Defines the context where the command will be run. Can be **all** (default), **check-deployment-only** or **process-deployment-only**
- **runOnlyOnceByOrg**: If set to true, the command will be run only one time per org. A record of SfdxHardisTrace__c is stored to make that possible (it needs to be existing in target org)

If the commands are not the same depending on the target org, you can define them into **config/branches/.sfdx-hardis-BRANCHNAME.yml** instead of root **config/.sfdx-hardis.yml**

Example:

\`\`\`yaml
commandsPreDeploy:
  - id: knowledgeUnassign
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: knowledgeAssign
    label: Assign Knowledge user to the deployment user
    command: sf data update record --sobject User --where "Username='deploy.github@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json

commandsPostDeploy:
  - id: knowledgeUnassign
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: knowledgeAssign
    label: Assign Knowledge user to desired username
    command: sf data update record --sobject User --where "Username='admin-yser@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json
  - id: someActionToRunJustOneTime
    label: And to run only if deployment is success
    command: sf sfdmu:run ...
    skipIfError: true
    context: process-deployment-only
    runOnlyOnceByOrg: true
\`\`\`

### Automated fixes post deployments

#### List view with scope Mine

If you defined a property **listViewsToSetToMine** in your .sfdx-hardis.yml, related ListViews will be set to Mine ( see command <${CONSTANTS.DOC_URL_ROOT}/hardis/org/fix/listviewmine/> )

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

If you need to increase the deployment waiting time (sf project deploy start --wait arg), you can define env variable SFDX_DEPLOY_WAIT_MINUTES (default: 120)

If you need notifications to be sent using the current Pull Request and not the one just merged ([see use case](https://github.com/hardisgroupcom/sfdx-hardis/issues/637#issuecomment-2230798904)), define env variable SFDX_HARDIS_DEPLOY_BEFORE_MERGE=true
`;

  public static examples = [
    '$ sf hardis:project:deploy:smart',
    '$ sf hardis:project:deploy:smart --check',
    '$ sf hardis:project:deploy:smart --check --testlevel RunRepositoryTests',
    "$ sf hardis:project:deploy:smart --check --testlevel RunRepositoryTests --runtests '^(?!FLI|MyPrefix).*'",
    '$ sf hardis:project:deploy:smart --check --testlevel RunRepositoryTestsExceptSeeAllData',
    '$ sf hardis:project:deploy:smart',
    '$ FORCE_TARGET_BRANCH=preprod NODE_OPTIONS=--inspect-brk sf hardis:project:deploy:smart --check --websocket localhost:2702 --skipauth --target-org nicolas.vuillamy@myclient.com.preprod'
  ];


  public static flags: any = {
    check: Flags.boolean({
      char: 'c',
      default: false,
      description: messages.getMessage('checkOnly'),
    }),
    testlevel: Flags.string({
      char: 'l',
      options: [
        'NoTestRun',
        'RunSpecifiedTests',
        'RunRepositoryTests',
        'RunRepositoryTestsExceptSeeAllData',
        'RunLocalTests',
        'RunAllTestsInOrg',
      ],
      description: messages.getMessage('testLevelExtended'),
    }),
    runtests: Flags.string({
      char: 'r',
      description: `If testlevel=RunSpecifiedTests, please provide a list of classes.
If testlevel=RunRepositoryTests, can contain a regular expression to keep only class names matching it. If not set, will run all test classes found in the repo.`,
    }),
    packagexml: Flags.string({
      char: 'p',
      description: 'Path to package.xml containing what you want to deploy in target org',
    }),
    delta: Flags.boolean({
      default: false,
      description: 'Applies sfdx-git-delta to package.xml before other deployment processes',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected checkOnly = false;
  protected configInfo: any = {};
  protected testLevel;
  protected testClasses;
  protected smartDeployOptions: any;
  protected packageXmlFile: string;
  protected delta = false;
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(SmartDeploy);
    this.configInfo = await getConfig('branch');
    this.checkOnly = flags.check || false;
    const deltaFromArgs = flags.delta || false;
    const packageXml = flags.packagexml || null;
    this.debugMode = flags.debug || false;
    const currentGitBranch = await getCurrentGitBranch();
    // Get target org
    let targetUsername = flags['target-org'].getUsername();
    if (!isCI) {
      uxLog(this, c.yellow("Just to be sure, please select the org you want to use for this command :)"))
      targetUsername = await promptOrgUsernameDefault(this, targetUsername, { devHub: false, setDefault: false, scratch: false });
    }

    await this.initTestLevelAndTestClasses(flags);

    await this.handlePackages(targetUsername);

    // Compute commitsSummary and store it in globalThis.pullRequestData.commitsSummary
    if (this.checkOnly) {
      try {
        const pullRequestInfo = await GitProvider.getPullRequestInfo();
        const commitsSummary = await computeCommitsSummary(true, pullRequestInfo);
        const prDataCommitsSummary = { commitsSummary: commitsSummary.markdown };
        globalThis.pullRequestData = Object.assign(globalThis.pullRequestData || {}, prDataCommitsSummary);
      } catch (e3) {
        uxLog(this, c.yellow('Unable to compute git summary:\n' + e3));
      }
    }

    // Get package.xml & destructiveChanges.xml
    this.initPackageXmlAndDestructiveChanges(packageXml, targetUsername, flags);

    // Compute and apply delta if required
    await this.handleDeltaDeployment(deltaFromArgs, targetUsername, currentGitBranch);

    // Process deployment (or deployment check)
    const { messages, quickDeploy, deployXmlCount } = await smartDeploy(
      this.packageXmlFile,
      this.checkOnly,
      this.testLevel,
      this.debugMode,
      this,
      this.smartDeployOptions
    );

    const deployExecuted = !this.checkOnly && deployXmlCount > 0 ? true : false;

    // Set ListViews to scope Mine if defined in .sfdx-hardis.yml
    if (this.configInfo.listViewsToSetToMine && deployExecuted) {
      await restoreListViewMine(this.configInfo.listViewsToSetToMine, flags['target-org'].getConnection(), {
        debug: this.debugMode,
      });
    }

    // Send notification of deployment success
    if (deployExecuted) {
      await this.handleNotifications(flags, targetUsername, quickDeploy);
    }
    // Return result
    return { orgId: flags['target-org'].getOrgId(), outputString: messages.join('\n') };
  }

  private async handleNotifications(flags, targetUsername: any, quickDeploy: any) {
    const pullRequestInfo = await GitProvider.getPullRequestInfo();
    const attachments: MessageAttachment[] = [];
    try {
      // Build notification attachments & handle ticketing systems comments
      const commitsSummary = await this.collectNotifAttachments(attachments, pullRequestInfo);
      await TicketProvider.postDeploymentActions(
        commitsSummary.tickets,
        flags['target-org']?.getConnection()?.instanceUrl || targetUsername || '',
        pullRequestInfo
      );
    } catch (e4: any) {
      uxLog(
        this,
        c.yellow('Unable to handle commit info on TicketProvider post deployment actions:\n' + e4.message) +
        '\n' +
        c.gray(e4.stack)
      );
    }

    const orgMarkdown = await getOrgMarkdown(
      flags['target-org']?.getConnection()?.instanceUrl || targetUsername || ''
    );
    const branchMarkdown = await getBranchMarkdown();
    let notifMessage = `Deployment has been successfully processed from branch ${branchMarkdown} to org ${orgMarkdown}`;
    notifMessage += quickDeploy
      ? ' (🚀 quick deployment)'
      : this.delta
        ? ' (🌙 delta deployment)'
        : ' (🌕 full deployment)';

    const notifButtons = await getNotificationButtons();
    if (pullRequestInfo) {
      if (this.debugMode) {
        uxLog(this, c.gray('PR info:\n' + JSON.stringify(pullRequestInfo)));
      }
      const prUrl = pullRequestInfo.web_url || pullRequestInfo.html_url || pullRequestInfo.url;
      const prAuthor = pullRequestInfo?.authorName || pullRequestInfo?.author?.login || pullRequestInfo?.author?.name || null;
      notifMessage += `\nRelated: <${prUrl}|${pullRequestInfo.title}>` + (prAuthor ? ` by ${prAuthor}` : '');
      const prButtonText = 'View Pull Request';
      notifButtons.push({ text: prButtonText, url: prUrl });
    } else {
      uxLog(this, c.yellow("WARNING: Unable to get Pull Request info, notif won't have a button URL"));
    }
    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'DEPLOYMENT',
      text: notifMessage,
      buttons: notifButtons,
      severity: 'success',
      attachments: attachments,
      logElements: [],
      data: { metric: 0 }, // Todo: if delta used, count the number of items deployed
      metrics: {
        DeployedItems: 0,
      },
    });
  }

  private async handleDeltaDeployment(deltaFromArgs: any, targetUsername: string, currentGitBranch: string | null) {
    this.delta = false;
    if ((deltaFromArgs === true ||
      process.env.USE_DELTA_DEPLOYMENT === 'true' ||
      this.configInfo.useDeltaDeployment === true) &&
      (await this.isDeltaAllowed()) === true) {
      this.delta = true;
      this.smartDeployOptions.delta = true;
      // Define delta deployment depending on context
      let fromCommit = 'HEAD';
      let toCommit = 'HEAD^';
      if (this.checkOnly) {
        // In deployment check context
        const prInfo = await GitProvider.getPullRequestInfo();
        const deltaScope = await getGitDeltaScope(
          prInfo?.sourceBranch || currentGitBranch,
          prInfo?.targetBranch || process.env.FORCE_TARGET_BRANCH
        );
        fromCommit = deltaScope.fromCommit;
        toCommit = deltaScope?.toCommit?.hash || '';
      }
      // call delta
      uxLog(this, c.cyan('[DeltaDeployment] Generating git delta package.xml and destructiveChanges.xml ...'));
      const tmpDir = await createTempDir();
      await callSfdxGitDelta(fromCommit, toCommit, tmpDir, { debug: this.debugMode });

      // Update package.xml
      const packageXmlFileDeltaDeploy = path.join(tmpDir, 'package', 'packageDelta.xml');
      await fs.copy(this.packageXmlFile, packageXmlFileDeltaDeploy);
      this.packageXmlFile = packageXmlFileDeltaDeploy;
      const diffPackageXml = path.join(tmpDir, 'package', 'package.xml');
      await removePackageXmlContent(this.packageXmlFile, diffPackageXml, true, {
        debugMode: this.debugMode,
        keepEmptyTypes: false,
      });

      const deltaContent = await fs.readFile(this.packageXmlFile, 'utf8');
      uxLog(this, c.cyan('[DeltaDeployment] Final Delta package.xml to deploy:\n' + c.green(deltaContent)));

      const smartDeploymentTestsAllowed = await this.isSmartDeploymentTestsAllowed()
      if (smartDeploymentTestsAllowed) {
        uxLog(this, c.cyan("[SmartDeploymentTests] Smart Deployment tests activated: analyzing delta package content..."));
        const deltaPackageContent = await parsePackageXmlFile(this.packageXmlFile);
        const metadataTypesInDelta = Object.keys(deltaPackageContent);
        const impactingMetadataTypesInDelta: string[] = []
        for (const metadataTypeInDelta of metadataTypesInDelta) {
          if (!CONSTANTS.NOT_IMPACTING_METADATA_TYPES.includes(metadataTypeInDelta)) {
            impactingMetadataTypesInDelta.push(metadataTypeInDelta);
          }
        }
        if (impactingMetadataTypesInDelta.length === 0 && !(await isProductionOrg(targetUsername, {}))) {
          uxLog(this, c.green("[SmartDeploymentTests] No Impacting metadata in delta package.xml: Skip test classes as the deployed items seem safe :)"));
          this.testLevel = "NoTestRun";
          this.testClasses = "";
        }
        else {
          if (impactingMetadataTypesInDelta.length > 0) {
            uxLog(this, c.yellow(`[SmartDeploymentTests] Impacting metadata in delta package.xml (${impactingMetadataTypesInDelta.join(",")}): do not skip test classes.`));
          } else {
            uxLog(this, c.yellow("[SmartDeploymentTests] Production org as deployment target: do not skip test classes"));
          }
        }

      }

      // Update destructiveChanges.xml
      if (this.smartDeployOptions.postDestructiveChanges) {
        const destructiveXmlFileDeploy = path.join(tmpDir, 'destructiveChanges', 'destructiveChangesDelta.xml');
        await fs.copy(this.smartDeployOptions.postDestructiveChanges, destructiveXmlFileDeploy);
        const diffDestructiveChangesXml = path.join(tmpDir, 'destructiveChanges', 'destructiveChanges.xml');
        await removePackageXmlContent(destructiveXmlFileDeploy, diffDestructiveChangesXml, true, {
          debugMode: this.debugMode,
          keepEmptyTypes: false,
        });
        this.smartDeployOptions.postDestructiveChanges = destructiveXmlFileDeploy;
        const deltaContentDelete = await fs.readFile(destructiveXmlFileDeploy, 'utf8');
        uxLog(this, c.cyan('[DeltaDeployment] Final Delta destructiveChanges.xml to delete:\n' + c.yellow(deltaContentDelete)));
      }
    }
  }

  private initPackageXmlAndDestructiveChanges(packageXml: any, targetUsername: any, flags) {
    this.packageXmlFile =
      packageXml ||
        process.env.PACKAGE_XML_TO_DEPLOY ||
        this.configInfo.packageXmlToDeploy ||
        fs.existsSync('./manifest/package.xml')
        ? './manifest/package.xml'
        : './config/package.xml';
    this.smartDeployOptions = {
      targetUsername: targetUsername,
      conn: flags['target-org']?.getConnection(),
      testClasses: this.testClasses,
    };
    // Get destructiveChanges.xml and add it in options if existing
    const postDestructiveChanges = process.env.PACKAGE_XML_TO_DELETE ||
      this.configInfo.packageXmlToDelete ||
      fs.existsSync('./manifest/destructiveChanges.xml')
      ? './manifest/destructiveChanges.xml'
      : './config/destructiveChanges.xml';
    if (fs.existsSync(postDestructiveChanges)) {
      this.smartDeployOptions.postDestructiveChanges = postDestructiveChanges;
    }

    // Get preDestructiveChanges.xml and add it in options if existing
    const preDestructiveChanges = process.env.PACKAGE_XML_TO_DELETE_PRE_DEPLOY ||
      this.configInfo.packageXmlToDeletePreDeploy ||
      fs.existsSync('./manifest/preDestructiveChanges.xml')
      ? './manifest/preDestructiveChanges.xml'
      : './config/preDestructiveChanges.xml';
    if (fs.existsSync(preDestructiveChanges)) {
      this.smartDeployOptions.preDestructiveChanges = preDestructiveChanges;
    }
  }

  private async handlePackages(targetUsername: any) {
    const packages = this.configInfo.installedPackages || [];
    const missingPackages: any[] = [];
    const installPackages = this.checkOnly === false ||
      process.env.INSTALL_PACKAGES_DURING_CHECK_DEPLOY === 'true' ||
      this.configInfo.installPackagesDuringCheckDeploy === true;
    if (packages.length > 0 && installPackages) {
      // Install packages only if we are in real deployment mode
      await MetadataUtils.installPackagesOnOrg(packages, targetUsername, this, 'deploy');
    } else if (packages.length > 0 && this.checkOnly === true) {
      // If check mode, warn if there are missing packages
      const alreadyInstalled = await MetadataUtils.listInstalledPackages(targetUsername, this);
      for (const package1 of packages) {
        if (alreadyInstalled.filter(
          (installedPackage: any) => package1.SubscriberPackageVersionId === installedPackage.SubscriberPackageVersionId
        ).length === 0 &&
          package1.installDuringDeployments === true) {
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
              package1.SubscriberPackageVersionId
            )} in target org to validate the deployment check`
          )
        );
      }
      uxLog(this, '');
      uxLog(
        this,
        c.yellow(
          c.italic(
            `If you want deployment checks to automatically install packages, please define ${c.bold(
              'INSTALL_PACKAGES_DURING_CHECK_DEPLOY=true'
            )} in ENV vars, or property ${c.bold('installPackagesDuringCheckDeploy: true')} in .sfdx-hardis.yml`
          )
        )
      );
    }
  }

  private async initTestLevelAndTestClasses(flags) {
    const givenTestlevel = flags.testlevel || this.configInfo.testLevel || 'RunLocalTests';
    this.testClasses = flags.runtests || this.configInfo.runtests || '';

    // Auto-detect all APEX test classes within project in order to run "dynamic" RunSpecifiedTests deployment
    if (['RunRepositoryTests', 'RunRepositoryTestsExceptSeeAllData'].includes(givenTestlevel)) {
      const testClassList = await getApexTestClasses(
        this.testClasses,
        givenTestlevel === 'RunRepositoryTestsExceptSeeAllData'
      );
      if (Array.isArray(testClassList) && testClassList.length) {
        flags.testlevel = 'RunSpecifiedTests';
        this.testClasses = testClassList.join(" ");
      } else {
        // Default back to RunLocalTests in case if repository has zero tests
        flags.testlevel = 'RunLocalTests';
        this.testClasses = '';
      }
    }

    this.testLevel = flags.testlevel || this.configInfo.testLevel || 'RunLocalTests';

    // Test classes are only valid for RunSpecifiedTests
    if (this.testLevel != 'RunSpecifiedTests') {
      this.testClasses = '';
    }
  }

  private async collectNotifAttachments(attachments: MessageAttachment[], pullRequestInfo: any) {
    const commitsSummary = await computeCommitsSummary(false, pullRequestInfo);
    // Tickets attachment
    if (commitsSummary.tickets.length > 0) {
      attachments.push({
        text: `*Tickets*\n${commitsSummary.tickets
          .map((ticket) => {
            if (ticket.foundOnServer) {
              return '• ' + UtilsNotifs.markdownLink(ticket.url, ticket.id) + ' ' + ticket.subject;
            } else {
              return '• ' + UtilsNotifs.markdownLink(ticket.url, ticket.id);
            }
          })
          .join('\n')}`,
      });
    }
    // Manual actions attachment
    if (commitsSummary.manualActions.length > 0) {
      attachments.push({
        text: `*Manual actions*\n${commitsSummary.manualActions
          .map((manualAction) => {
            return '• ' + manualAction;
          })
          .join('\n')}`,
      });
    }
    // Commits attachment
    if (commitsSummary.logResults.length > 0) {
      attachments.push({
        text: `*Commits*\n${commitsSummary.logResults
          .map((logResult) => {
            return '• ' + logResult.message + ', by ' + logResult.author_name;
          })
          .join('\n')}`,
      });
    }
    return commitsSummary;
  }

  async isDeltaAllowed() {
    if (process.env?.DISABLE_DELTA_DEPLOYMENT === 'true') {
      uxLog(
        this,
        c.yellow(`[DeltaDeployment] Delta deployment has been explicitly disabled with variable DISABLE_DELTA_DEPLOYMENT=true`)
      );
      return false;
    }
    const latestCommit = await getLatestGitCommit();
    if (latestCommit && this.isNoDelta(latestCommit)) {
      uxLog(this, c.yellow(c.bold((`[DeltaDeployment] Latest commit contains string "nodelta" so disable delta for this time :)`))));
      return false;
    }
    if (this.checkOnly === false && !(process.env?.USE_DELTA_DEPLOYMENT_AFTER_MERGE === 'true')) {
      uxLog(
        this,
        c.yellow(
          "[DeltaDeployment] We'll try to deploy using Quick Deployment feature. If not available, it's safer to use full deployment for a merge job."
        )
      );
      uxLog(
        this,
        c.yellow(
          '[DeltaDeployment] If you want to use delta deployment anyway, define env variable USE_DELTA_DEPLOYMENT_AFTER_MERGE=true'
        )
      );
      return false;
    }
    if (process.env?.ALWAYS_ENABLE_DELTA_DEPLOYMENT === 'true') {
      uxLog(
        this,
        c.yellow(`[DeltaDeployment] Delta deployment has been explicitly enabled with variable ALWAYS_ENABLE_DELTA_DEPLOYMENT=true`)
      );
      uxLog(
        this,
        c.yellow(
          `[DeltaDeployment] It is recommended to use delta deployments for merges between major branches, use this config at your own responsibility`
        )
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
    uxLog(this, c.grey('Major orgs with auth configured:\n' + JSON.stringify(majorOrgs, null, 2)));
    const currentBranchIsMajor = majorOrgs.some((majorOrg) => majorOrg.branchName === currentBranch);
    const parentBranchIsMajor = majorOrgs.some((majorOrg) => majorOrg.branchName === parentBranch);
    if (currentBranchIsMajor && (parentBranchIsMajor === true || parentBranch == null)) {
      uxLog(
        this,
        c.yellow(
          `This is not safe to use delta between major branches (${c.bold(currentBranch)} to ${c.bold(
            parentBranch
          )}): using full deployment mode`
        )
      );
      return false;
    }
    uxLog(
      this,
      c.cyan(
        `[DeltaDeployment] Delta allowed between minor branch (${currentBranch}) and major branch (${parentBranch}): using delta deployment mode`
      )
    );
    return true;
  }

  isNoDelta(latestCommit) {
    return latestCommit?.body?.trim().includes('nodelta') || latestCommit?.message?.trim().includes('nodelta') ||
      latestCommit?.body?.trim().includes('no delta') || latestCommit?.message?.trim().includes('no delta')
  }

  async isSmartDeploymentTestsAllowed() {
    if (process.env?.USE_SMART_DEPLOYMENT_TESTS === 'true' || this.configInfo?.useSmartDeploymentTests === true) {
      const latestCommit = await getLatestGitCommit();
      if (latestCommit && this.isNoSmartDeploymentTests(latestCommit)) {
        uxLog(this, c.yellow(c.bold((`[SmartDeploymentTests] Latest commit contains string "nosmart" so disable smartDeploymentTests for this time :)`))));
        return false;
      }
      return true;
    }
    return false;
  }

  isNoSmartDeploymentTests(latestCommit) {
    return latestCommit?.body?.trim().includes('nosmart') || latestCommit?.message?.trim().includes('nosmart') ||
      latestCommit?.body?.trim().includes('no smart') || latestCommit?.message?.trim().includes('no smart')
  }
}
