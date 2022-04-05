import { flags, FlagsConfig, SfdxCommand } from "@salesforce/command";
import { Duration } from "@salesforce/kit";
import { AnyJson } from "@salesforce/ts-types";
import { wrapDeployCommand } from "../../../common/utils/wrapUtils";

// Wrapper for sfdx force:source:deploy
export class Deploy extends SfdxCommand {
  public static readonly description = `sfdx-hardis wrapper for sfdx force:source:deploy that displays tips to solve deployment errors.

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_deploy)
`;
  public static readonly examples = [];
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
    return await wrapDeployCommand("sfdx force:source:deploy", process.argv, this, this.flags.debug);
  }
}
