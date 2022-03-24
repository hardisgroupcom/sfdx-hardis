  /* jscpd:ignore-start */
import { flags, FlagsConfig, SfdxCommand } from "@salesforce/command";
import { Duration } from "@salesforce/kit";
import { AnyJson } from "@salesforce/ts-types";
import { wrapDeployCommand } from "../../../common/utils/wrapUtils";

const xorFlags = ["zipfile", "validateddeployrequestid", "deploydir"];
export class Deploy extends SfdxCommand {
  public static readonly description = `sfdx-hardis wrapper for sfdx force:mdapi:deploy that displays tips to solve deployment errors.

See documentation at https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_mdapi.htm#cli_reference_force_mdapi_deploy
`;
  public static readonly examples = [];
  public static readonly requiresUsername = true;
  public static readonly flagsConfig: FlagsConfig = {
    checkonly: flags.boolean({
      char: "c",
      description: "checkOnly",
    }),
    deploydir: flags.directory({
      char: "d",
      description: "deployDir",
      exactlyOne: xorFlags,
    }),
    wait: flags.minutes({
      char: "w",
      description: "wait",
      default: Duration.minutes(0),
      min: -1,
    }),
    testlevel: flags.enum({
      char: "l",
      description: "testLevel",
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
      description: "validatedDeployRequestId",
      exactlyOne: xorFlags,
      exclusive: ["testlevel", "runtests", "ignoreerrors", "ignorewarnings", "checkonly"],
    }),
    verbose: flags.builtin({
      description: "verbose",
    }),
    zipfile: flags.filepath({
      char: "f",
      description: "zipFile",
      exactlyOne: xorFlags,
    }),
    singlepackage: flags.boolean({
      char: "s",
      description: "singlePackage",
    }),
    soapdeploy: flags.boolean({
      description: "soapDeploy",
    }),
    purgeondelete: flags.boolean({
      description: "purgeOnDelete",
    }),
    concise: flags.builtin({
      description: "concise",
    }),
    debug: flags.boolean({
      default: false,
      description: "debug",
    }),
    websocket: flags.string({
      description: "websocket",
    }),
  };
  /* jscpd:ignore-end */
  public async run(): Promise<AnyJson> {
    return await wrapDeployCommand("sfdx force:mdapi:deploy", process.argv, this, this.flags.debug);
  }
}
