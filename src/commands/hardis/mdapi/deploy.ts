/* jscpd:ignore-start */
import { flags, FlagsConfig, SfdxCommand } from "@salesforce/command";
import * as c from "chalk";
import { Duration } from "@salesforce/kit";
import { AnyJson } from "@salesforce/ts-types";
import { wrapSfdxCoreCommand } from "../../../common/utils/wrapUtils";
import { uxLog } from "../../../common/utils";

const xorFlags = ["zipfile", "validateddeployrequestid", "deploydir"];
export class Deploy extends SfdxCommand {
  public static readonly description = `sfdx-hardis wrapper for sfdx force:mdapi:deploy that displays tips to solve deployment errors.

[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_mdapi.htm#cli_reference_force_mdapi_deploy)
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
    uxLog(this,c.red("This command will be removed by Salesforce in November 2024."));
    uxLog(this,c.red("Please migrate to command sf hardis project deploy start"));
    uxLog(this,c.red("See https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_mig_deploy_retrieve.htm"));
    return await wrapSfdxCoreCommand("sfdx force:mdapi:deploy", this.argv, this, this.flags.debug);
  }
}
