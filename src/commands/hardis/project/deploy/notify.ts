/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { CONSTANTS } from '../../../../config/index.js';
import { buildCheckDeployCommitSummary, handlePostDeploymentNotifications } from '../../../../common/utils/gitUtils.js';
import { GitProvider } from '../../../../common/gitProvider/index.js';
import c from "chalk"
import { uxLog } from '../../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DeployNotify extends SfCommand<any> {
  public static title = 'Deployment Notifications';

  public static description = `Post notifications related to:

- **Deployment simulation** _(use with --check-only)_

- **Deployment process** _(to call only if your deployment is successful)_

### Integrations

According to the [integrations you configured](${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-integrations-home/), notifications can contain deployment information and [Flow Visual Git Diff](${CONSTANTS.DOC_URL_ROOT}/salesforce-deployment-assistant-home/#flow-visual-git-diff)

  - GitHub, Gitlab, Azure DevOps, Bitbucket comments on Pull Requests (including Flows Visual Git Diff)

  - Slack, Microsoft Teams, Email deployment summary after a successful deployment

  - JIRA tags and comments on tickets that just has been deployed

![](${CONSTANTS.DOC_URL_ROOT}/assets/images/screenshot-jira-gitlab.jpg)

![](${CONSTANTS.DOC_URL_ROOT}/assets/images/screenshot-jira-slack.jpg)

### Flows Visual Git Diff

- Visually show you the differences on a diagram

- Display the update details without having to open any XML !

🟩 = added

🟥 = removed

🟧 = updated

![](${CONSTANTS.DOC_URL_ROOT}/assets/images/flow-visual-git-diff.jpg)

![](${CONSTANTS.DOC_URL_ROOT}/assets/images/flow-visual-git-diff-2.jpg)

### In custom CI/CD workflow

Example of usage in a custom CI/CD pipeline:

\`\`\`bash
# Disable exit-on-error temporarily
set +e

# Run the deploy command
sf project deploy start [....]
RET_CODE=$?

# Re-enable exit-on-error
set -e

# Determine MYSTATUS based on return code
if [ $RET_CODE -eq 0 ]; then
    MYSTATUS="valid"
else
    MYSTATUS="invalid"
fi

# Run the notify command with MYSTATUS
sf hardis:project:deploy:notify --check-only --deploy-status "$MYSTATUS"
\`\`\`

### Other usages

This command is for custom SF Cli pipelines, if you are a sfdx-hardis user, it is already embedded in sf hardis:deploy:smart.

You can also use [sfdx-hardis wrapper commands of SF deployment commands](${CONSTANTS.DOC_URL_ROOT}/salesforce-deployment-assistant-setup/#using-custom-cicd-pipeline)
`

  public static examples = [
    '$ sf hardis:project:deploy:notify --check-only --deploy-status valid --message "This deployment check is valid\\n\\nYahooo !!"',
    '$ sf hardis:project:deploy:notify --check-only --deploy-status invalid --message "This deployment check has failed !\\n\\Oh no !!"',
    '$ sf hardis:project:deploy:notify --deploy-status valid --message "This deployment has been processed !\\n\\nYahooo !!"'
  ];

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
    this.deployStatus = flags["deploy-status"] || "unknown";
    this.message = flags.message || "";
    this.debugMode = flags.debug || false;

    // Deployment check mode
    if (this.checkOnly) {
      uxLog(this, c.cyan("Handling Pull Request comments for a deployment check job..."));
      await buildCheckDeployCommitSummary();

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
        status: this.deployStatus,
      };
      globalThis.pullRequestData = Object.assign(globalThis.pullRequestData || {}, prData);
      // Post comments :)
      await GitProvider.managePostPullRequestComment();
    }

    // Post notifications after successful deployment
    else if (this.checkOnly === false && this.deployStatus === "valid") {
      await handlePostDeploymentNotifications(flags, flags["target-org"].getUsername(), false, false, this.debugMode, this.message);
    }
    // Fallback
    else {
      uxLog(this, c.yellow("No notification has been sent"));
      uxLog(this, c.yellow("- Pull Request comments are sent if --check-only is true"));
      uxLog(this, c.yellow("- Slack / Teams / Email / JIRA messages are sent only if --check-only is false and --deploy-status is valid"));
    }

    return { message: "Processed notifications" }
  }
}