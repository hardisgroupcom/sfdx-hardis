/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { CONSTANTS } from '../../../../config/index.js';
import { buildCheckDeployCommitSummary, handlePostDeploymentNotifications } from '../../../../common/utils/gitUtils.js';
import { GitProvider } from '../../../../common/gitProvider/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DeployNotify extends SfCommand<any> {
  public static title = 'Deployment Notifications';

  public static description = `Post notifications related to:

  - Deployment simulation
  - Deployment process

  According to the [integrations you configured](${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-integrations-home/), notifications can contain deployment informations and [Flow Visual Git Diff](${CONSTANTS.DOC_URL_ROOT}/salesforce-deployment-assistant-home/#flow-visual-git-diff)

  - GitHub, Gitlab, Azure DevOps, Bitbucket comments on Pull Requests
  - Slack, Microsoft Teams, Email deployment summary
  - JIRA tags and comments on tickets that just has been deployed

  This command is for custom SF Cli pipelines, if you are a sfdx-hardis user, it is already embedded in sf hardis:deploy:smart.

  You can also use [sfdx-hardis wrapper commands of SF deployment commands](${CONSTANTS.DOC_URL_ROOT}/salesforce-deployment-assistant-setup/#using-custom-cicd-pipeline)
  `

  public static examples = ['$ sf hardis:project:audit:apiversion'];

  public static flags: any = {
    "check-only": Flags.boolean({
      char: 'c',
      default: false,
      description: `Use this option to send notifications from a Deployment simulation job`,
    }),
    "deploy-status": Flags.string({
      char: 's',
      options: ["valid", "invalid", "unknown"],
      default: "unknown",
      description: `Send success, failure or unknown (default) to indicate if the deployment or deployment simulation is in success or not`,
    }),
    message: Flags.string({
      char: "m",
      default: "",
      description: "Custom message that you want to be added in notifications (string or markdown format)"
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;
  /* jscpd:ignore-end */

  protected checkOnly = false;
  protected message = "";
  protected debugMode = false;
  protected deployStatus: "valid" | "invalid" | "unknown" = "unknown"

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DeployNotify);
    this.checkOnly = flags["check-only"] === true ? true : false;
    this.deployStatus = flags.status || "unknown";
    this.debugMode = flags.debug || false;

    // Compute commitsSummary and store it in globalThis.pullRequestData.commitsSummary
    if (this.checkOnly) {
      await buildCheckDeployCommitSummary();
    }

    // Add deployment info
    const prData: any = {
      messageKey: "deployment",
      title:
        (this.checkOnly && this.deployStatus === "valid") ? "✅ Deployment check success" :
          (!this.checkOnly && this.deployStatus === "valid") ? "✅ Deployment success" :
            (this.checkOnly && this.deployStatus === "invalid") ? "❌ Deployment check failure" :
              (!this.checkOnly && this.deployStatus === "invalid") ? "❌ Deployment failure" :
                (this.checkOnly && this.deployStatus === "unknown") ? "🤷 Deployment check status unknown" :
                  "🤷 Deployment  status unknown",
      deployErrorsMarkdownBody: this.message,
      deployStatus: this.deployStatus,
    };
    globalThis.pullRequestData = Object.assign(globalThis.pullRequestData || {}, prData);

    if (this.checkOnly === false) {
      await handlePostDeploymentNotifications(flags, flags["target-org"].getUsername(), false, false, this.debugMode);
    }

    await GitProvider.managePostPullRequestComment();

    return { message: "Processed notifications" }
  }
}