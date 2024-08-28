import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { AnyJson } from "@salesforce/ts-types";
import { wrapSfdxCoreCommand } from "../../../../common/utils/wrapUtils.js";

export default class ProjectDeployStart extends SfCommand<any> {
  public static description = `sfdx-hardis wrapper for sfdx project deploy start that displays tips to solve deployment errors.

[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_push)
`;

  public static flags = {
    "api-version": Flags.integer({
      char: "a",
      description: "api-version",
    }),
    async: Flags.boolean({
      description: "async",
      exclusive: ["wait"],
    }),
    "dry-run": Flags.boolean({
      description: "dry-run",
      default: false,
    }),
    "ignore-conflicts": Flags.boolean({
      char: "c",
      description: "ignore-conflicts",
      default: false,
    }),
    "ignore-errors": Flags.boolean({
      char: "r",
      description: "ignore-errors",
      default: false,
    }),
    "ignore-warnings": Flags.boolean({
      char: "g",
      description: "ignore-warnings",
      default: false,
    }),
    manifest: Flags.string({
      char: "x",
      description: "manifest",
    }),
    metadata: Flags.string({
      char: "m",
      description: "metadata",
      multiple: true,
    }),
    "metadata-dir": Flags.string({
      description: "metadata-dir",
    }),
    "single-package": Flags.boolean({
      dependsOn: ["metadata-dir"],
      description: "single-package",
    }),
    "source-dir": Flags.string({
      char: "d",
      description: "source-dir",
      multiple: true,
    }),
    "target-org": Flags.string({
      description: "target-org",
    }),
    tests: Flags.string({
      description: "tests",
    }),
    "test-level": Flags.string({
      description: "test-level",
    }),
    wait: Flags.integer({
      char: "w",
      default: 33,
      min: 1,
      description: "wait",
      exclusive: ["async"],
    }),
    "purge-on-delete": Flags.boolean({
      description: "purge-on-delete",
    }),
    "pre-destructive-changes": Flags.string({
      dependsOn: ["manifest"],
      description: "pre-destructive-changes",
    }),
    "post-destructive-changes": Flags.string({
      dependsOn: ["manifest"],
      description: "post-destructive-changes",
    }),
    "coverage-formatters": Flags.string({
      description: "coverage-formatters",
    }),
    junit: Flags.boolean({
      description: "junit",
    }),
    "results-dir": Flags.string({
      description: "results-dir",
    }),
    debug: Flags.boolean({
      default: false,
      description: "debug",
    }),
  };

  public static requiresProject = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ProjectDeployStart);
    return await wrapSfdxCoreCommand("sf project deploy start", this.argv, this, flags.debug);
  }
}
