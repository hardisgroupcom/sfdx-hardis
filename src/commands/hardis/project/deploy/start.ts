import { FlagsConfig, flags, SfdxCommand } from "@salesforce/command";
import { Duration } from "@salesforce/kit";
import { AnyJson } from "@salesforce/ts-types";
import { wrapSfdxCoreCommand } from "../../../../common/utils/wrapUtils";

export default class ProjectDeployStart extends SfdxCommand {
  public static readonly description = `sfdx-hardis wrapper for sfdx project deploy start that displays tips to solve deployment errors.

[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_push)
`;

  public static readonly flagsConfig: FlagsConfig = {
    "api-version": flags.number({
      char: "a",
      description: "api-version",
    }),
    async: flags.boolean({
      description: "async",
      exclusive: ["wait"],
    }),
    "dry-run": flags.boolean({
      description: "dry-run",
      default: false,
    }),
    "ignore-conflicts": flags.boolean({
      char: "c",
      description: "ignore-conflicts",
      default: false,
    }),
    "ignore-errors": flags.boolean({
      char: "r",
      description: "ignore-errors",
      default: false,
    }),
    "ignore-warnings": flags.boolean({
      char: "g",
      description: "ignore-warnings",
      default: false,
    }),
    manifest: flags.string({
      char: "x",
      description: "manifest",
    }),
    metadata: flags.string({
      char: "m",
      description: "metadata",
      multiple: true,
    }),
    "metadata-dir": flags.string({
      description: "metadata-dir",
    }),
    "single-package": flags.boolean({
      dependsOn: ["metadata-dir"],
      description: "single-package",
    }),
    "source-dir": flags.string({
      char: "d",
      description: "source-dir",
      multiple: true,
    }),
    "target-org": flags.string({
      description: "target-org",
    }),
    tests: flags.string({
      description: "tests",
    }),
    "test-level": flags.string({
      description: "test-level",
    }),
    wait: flags.minutes({
      char: "w",
      default: Duration.minutes(33),
      min: Duration.minutes(1),
      description: "wait",
      exclusive: ["async"],
    }),
    "purge-on-delete": flags.boolean({
        description: "purge-on-delete",
    }),
    "pre-destructive-changes": flags.string({
      dependsOn: ["manifest"],
      description: "pre-destructive-changes",
    }),
    "post-destructive-changes": flags.string({
      dependsOn: ["manifest"],
      description: "post-destructive-changes",
    }),
    "coverage-formatters": flags.string({
        description: "coverage-formatters",
      }),
    junit: flags.boolean({
        description: "junit",
    }),
    "results-dir": flags.string({
        description: "results-dir",
    }),
  };

  protected static requiresUsername = true;
  protected static requiresProject = true;

  public async run(): Promise<AnyJson> {
    return await wrapSfdxCoreCommand("sf project deploy start", this.argv, this, this.flags.debug);
  }
}
