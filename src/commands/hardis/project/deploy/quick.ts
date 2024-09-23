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

### Deployment pre or post commands

You can define command lines to run before or after a deployment, with parameters:

- **id**: Unique Id for the command
- **label**: Human readable label for the command
- **skipIfError**: If defined to "true", the post-command won't be run if there is a deployment failure
- **context**: Defines the context where the command will be run. Can be **all** (default), **check-deployment-only** or **process-deployment-only**
- **runOnlyOnceByOrg**: If set to true, the command will be run only one time per org. A record of SfdxHardisTrace__c is stored to make that possible (it needs to be existing in target org)

If the commands are not the same depending on the target org, you can define them into **config/branches/.sfdx-hardis-BRANCHNAME.yml** instead of root **config/.sfdx-hardis.yml**

Example:

\`\`\`yaml
commandsPreDeploy:
  - id: knowledgeUnassign
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: knowledgeAssign
    label: Assign Knowledge user to the deployment user
    command: sf data update record --sobject User --where "Username='deploy.github@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json

commandsPostDeploy:
  - id: knowledgeUnassign
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: knowledgeAssign
    label: Assign Knowledge user to desired username
    command: sf data update record --sobject User --where "Username='admin-yser@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json
  - id: someActionToRunJustOneTime
    label: And to run only if deployment is success
    command: sf sfdmu:run ...
    skipIfError: true
    context: process-deployment-only
    runOnlyOnceByOrg: true
\`\`\`
`;

  public static flags: any = {
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
    const conn = flags["target-org"].getConnection();
    // Run pre deployment commands if defined
    await executePrePostCommands('commandsPreDeploy', { success: true, checkOnly: false, conn: conn });
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
    await executePrePostCommands('commandsPostDeploy', { success: process.exitCode === 0, checkOnly: false, conn: conn });
    await GitProvider.managePostPullRequestComment();
    return result;
  }
}

/* jscpd:ignore-end */