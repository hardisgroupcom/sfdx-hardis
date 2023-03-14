import { flags, FlagsConfig, SfdxCommand } from "@salesforce/command";
import { Duration } from "@salesforce/kit";
import { AnyJson } from "@salesforce/ts-types";
import { GitProvider } from "../../../common/gitProvider";
import { checkDeploymentOrgCoverage, extractOrgCoverageFromLog } from "../../../common/utils/deployUtils";
import { wrapSfdxCoreCommand } from "../../../common/utils/wrapUtils";

// Wrapper for sfdx force:source:deploy
export class Deploy extends SfdxCommand {
  public static readonly description = `sfdx-hardis wrapper for sfdx force:source:deploy that displays tips to solve deployment errors.

Additional to the base command wrapper: If using **--checkonly**, add options **--checkcoverage** and **--coverageformatters json-summary** to check that org coverage is > 75% (or value defined in .sfdx-hardis.yml property **apexTestsMinCoverageOrgWide**)

[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

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
    const result = await wrapSfdxCoreCommand("sfdx force:source:deploy", process.argv, this, this.flags.debug);
    // Check org coverage if requested
    if (this.flags.checkcoverage && result.stdout) {
      const orgCoveragePercent = await extractOrgCoverageFromLog(result.stdout + result.stderr || "");
      if (orgCoveragePercent) {
        try {
          await checkDeploymentOrgCoverage(orgCoveragePercent);
        } catch (errCoverage) {
          await GitProvider.managePostPullRequestComment();
          throw errCoverage;
        }
      }
    }
    await GitProvider.managePostPullRequestComment();
    return result;
  }
}
