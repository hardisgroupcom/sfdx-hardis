import { flags, FlagsConfig, SfdxCommand } from "@salesforce/command";
import { Duration } from "@salesforce/kit";
import { AnyJson } from "@salesforce/ts-types";
import { GitProvider } from "../../../common/gitProvider";
import { checkDeploymentOrgCoverage, executePrePostCommands, extractOrgCoverageFromLog } from "../../../common/utils/deployUtils";
import { wrapSfdxCoreCommand } from "../../../common/utils/wrapUtils";

// Wrapper for sfdx force:source:deploy
export class Deploy extends SfdxCommand {
  public static readonly description = `sfdx-hardis wrapper for sfdx force:source:deploy that displays tips to solve deployment errors.

Additional to the base command wrapper: If using **--checkonly**, add options **--checkcoverage** and **--coverageformatters json-summary** to check that org coverage is > 75% (or value defined in .sfdx-hardis.yml property **apexTestsMinCoverageOrgWide**)

### Deployment results

You can also have deployment results as pull request comments, on:

- GitHub (see [GitHub Pull Requests comments config](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-github/))
- Gitlab (see [Gitlab integration configuration](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-gitlab/))
- Azure DevOps (see [Azure integration configuration](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-azure/))


[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

### Deployment pre or post commands

You can define command lines to run before or after a deployment

If the commands are not the same depending on the target org, you can define them into **config/branches/.sfdx-hardis-BRANCHNAME.yml** instead of root **config/.sfdx-hardis.yml**

Example:

\`\`\`yaml
commandsPreDeploy:
  - id: knowledgeUnassign
    label: Remove KnownledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: knowledgeAssign
    label: Assign Knowledge user to the deployment user
    command: sf data update record --sobject User --where "Username='deploy.github@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json
commandsPostDeploy:
  - id: knowledgeUnassign
    label: Remove KnownledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: knowledgeAssign
    label: Assign Knowledge user to desired username
    command: sf data update record --sobject User --where "Username='admin-yser@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json
\`\`\`yaml

Notes:

- You can disable coloring of errors in red by defining env variable SFDX_HARDIS_DEPLOY_ERR_COLORS=false

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_deploy)
`;
  public static readonly examples = [
    "$ sfdx hardis:source:deploy -x manifest/package.xml --wait 60 --ignorewarnings --testlevel RunLocalTests --postdestructivechanges ./manifest/destructiveChanges.xml --targetusername nicolas.vuillamy@cloudity.com.sfdxhardis --checkonly --checkcoverage --verbose --coverageformatters json-summary",
  ];
  public static readonly requiresProject = true;
  public static readonly requiresUsername = true;
  public static readonly flagsConfig: FlagsConfig = {
    checkonly: flags.boolean({
      char: "c",
      description: "checkonly",
    }),
    soapdeploy: flags.boolean({
      default: false,
      description: "soapDeploy",
    }),
    wait: flags.minutes({
      char: "w",
      default: Duration.minutes(60),
      min: Duration.minutes(0), // wait=0 means deploy is asynchronous
      description: "wait",
    }),
    testlevel: flags.enum({
      char: "l",
      description: "testlevel",
      options: ["NoTestRun", "RunSpecifiedTests", "RunLocalTests", "RunAllTestsInOrg"],
      default: "NoTestRun",
    }),
    runtests: flags.array({
      char: "r",
      description: "runTests",
      default: [],
    }),
    ignoreerrors: flags.boolean({
      char: "o",
      description: "ignoreErrors",
    }),
    ignorewarnings: flags.boolean({
      char: "g",
      description: "ignoreWarnings",
    }),
    validateddeployrequestid: flags.id({
      char: "q",
      description: "validateDeployRequestId",
      exclusive: ["manifest", "metadata", "sourcepath", "checkonly", "testlevel", "runtests", "ignoreerrors", "ignorewarnings"],
    }),
    verbose: flags.builtin({
      description: "verbose",
    }),
    metadata: flags.array({
      char: "m",
      description: "metadata",
      exclusive: ["manifest", "sourcepath"],
    }),
    sourcepath: flags.array({
      char: "p",
      description: "sourcePath",
      exclusive: ["manifest", "metadata"],
    }),
    manifest: flags.filepath({
      char: "x",
      description: "flagsLong.manifest",
      exclusive: ["metadata", "sourcepath"],
    }),
    predestructivechanges: flags.filepath({
      description: "predestructivechanges",
      dependsOn: ["manifest"],
    }),
    postdestructivechanges: flags.filepath({
      description: "postdestructivechanges",
      dependsOn: ["manifest"],
    }),
    tracksource: flags.boolean({
      char: "t",
      description: "tracksource",
      exclusive: ["checkonly", "validateddeployrequestid"],
    }),
    forceoverwrite: flags.boolean({
      char: "f",
      description: "forceoverwrite",
      dependsOn: ["tracksource"],
    }),
    resultsdir: flags.directory({
      description: "resultsdir",
    }),
    coverageformatters: flags.array({
      description: "coverageformatters",
    }),
    junit: flags.boolean({ description: "junit" }),
    checkcoverage: flags.boolean({ description: "Check Apex org coverage" }),
    debug: flags.boolean({
      default: false,
      description: "debug",
    }),
    websocket: flags.string({
      description: "websocket",
    }),
  };
  protected xorFlags = ["manifest", "metadata", "sourcepath", "validateddeployrequestid"];

  public async run(): Promise<AnyJson> {
    // Run pre deployment commands if defined
    await executePrePostCommands("commandsPreDeploy", true);
    const result = await wrapSfdxCoreCommand("sfdx force:source:deploy", this.argv, this, this.flags.debug);
    // Check org coverage if requested
    if (this.flags.checkcoverage && result.stdout) {
      const orgCoveragePercent = await extractOrgCoverageFromLog(result.stdout + result.stderr || "");
      const checkOnly = this.flags.checkonly || false;
      if (orgCoveragePercent) {
        try {
          await checkDeploymentOrgCoverage(orgCoveragePercent, { check: checkOnly });
        } catch (errCoverage) {
          await GitProvider.managePostPullRequestComment();
          throw errCoverage;
        }
      }
    }
    // Run post deployment commands if defined
    await executePrePostCommands("commandsPostDeploy", process.exitCode === 0);
    await GitProvider.managePostPullRequestComment();
    return result;
  }
}
