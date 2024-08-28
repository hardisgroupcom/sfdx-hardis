/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { AnyJson } from "@salesforce/ts-types";
import { wrapSfdxCoreCommand } from "../../../../common/utils/wrapUtils.js";
import { checkDeploymentOrgCoverage, executePrePostCommands, extractOrgCoverageFromLog } from '../../../../common/utils/deployUtils.js';
import { GitProvider } from '../../../../common/gitProvider/index.js';

export default class ProjectDeployValidate extends SfCommand<any> {
  public static description = `sfdx-hardis wrapper for **sf project deploy validate** that displays tips to solve deployment errors.

[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_deploy_validate_unified)
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
    "target-org": Flags.requiredOrg(),
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
    const { flags } = await this.parse(ProjectDeployValidate);
    // Run pre deployment commands if defined
    await executePrePostCommands('commandsPreDeploy', true);
    const result = await wrapSfdxCoreCommand("sf project deploy start", this.argv, this, flags.debug);
    // Check org coverage if requested
    if (flags['coverage-formatters'] && result.stdout) {
      const orgCoveragePercent = await extractOrgCoverageFromLog(result.stdout + result.stderr || '');
      const checkOnly = true;
      if (orgCoveragePercent) {
        try {
          await checkDeploymentOrgCoverage(Number(orgCoveragePercent), { check: checkOnly });
        } catch (errCoverage) {
          await GitProvider.managePostPullRequestComment();
          throw errCoverage;
        }
      }
    }
    // Run post deployment commands if defined
    await executePrePostCommands('commandsPostDeploy', process.exitCode === 0);
    await GitProvider.managePostPullRequestComment();
    return result;
  }
}
/* jscpd:ignore-end */