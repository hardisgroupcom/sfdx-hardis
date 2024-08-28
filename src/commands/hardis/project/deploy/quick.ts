/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { AnyJson } from "@salesforce/ts-types";
import { wrapSfdxCoreCommand } from "../../../../common/utils/wrapUtils.js";
import { checkDeploymentOrgCoverage, executePrePostCommands, extractOrgCoverageFromLog } from '../../../../common/utils/deployUtils.js';
import { GitProvider } from '../../../../common/gitProvider/index.js';

export default class ProjectDeployStart extends SfCommand<any> {
  public static description = `sfdx-hardis wrapper for **sf project deploy quick** that displays tips to solve deployment errors.

[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_deploy_quick_unified)
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
    "target-org": Flags.requiredOrg(),
    tests: Flags.string({
      description: "tests",
    }),
    "--job-id": Flags.string({
      char: "i",
      description: "job-id",
    }),
    "--use-most-recent": Flags.boolean({
      char: "r",
      description: "use-most-recent",
    }),
    wait: Flags.integer({
      char: "w",
      default: 33,
      min: 1,
      description: "wait",
      exclusive: ["async"],
    }),
    debug: Flags.boolean({
      default: false,
      description: "debug",
    }),
  };

  public static requiresProject = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ProjectDeployStart);
    // Run pre deployment commands if defined
    await executePrePostCommands('commandsPreDeploy', true);
    const result = await wrapSfdxCoreCommand("sf project deploy start", this.argv, this, flags.debug);
    // Check org coverage if requested
    if (flags['coverage-formatters'] && result.stdout) {
      const orgCoveragePercent = await extractOrgCoverageFromLog(result.stdout + result.stderr || '');
      const checkOnly = false;
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