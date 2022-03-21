import { FlagsConfig, flags, SfdxCommand } from "@salesforce/command";
import { Duration } from "@salesforce/kit";
import { AnyJson } from "@salesforce/ts-types";
import { wrapDeployCommand } from "../../../common/utils/wrapUtils";

export default class Push extends SfdxCommand {
  public static readonly description = `sfdx-hardis wrapper for sfdx force:source:push that displays tips to solve deployment errors.

See documentation at https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_push
`;  protected static readonly flagsConfig: FlagsConfig = {
    forceoverwrite: flags.boolean({
      char: "f",
      description: "forceoverwrite",
    }),
    wait: flags.minutes({
      char: "w",
      default: Duration.minutes(60),
      min: Duration.minutes(1),
      description: "wait",
    }),
    ignorewarnings: flags.boolean({
      char: "g",
      description: "ignorewarnings",
    }),
    quiet: flags.builtin({
      description: "quiet",
    }),
    debug: flags.boolean({
      default: false,
      description: "debug",
    }),
    websocket: flags.string({
      description: "websocket",
    }),
  };
  protected static requiresUsername = true;
  protected static requiresProject = true;

  public async run(): Promise<AnyJson> {
    return await wrapDeployCommand("sfdx force:source:push", process.argv, this, this.flags.debug);
  }
}
