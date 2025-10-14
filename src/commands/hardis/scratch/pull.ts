/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { forceSourcePull } from '../../../common/utils/deployUtils.js';
import { uxLog } from '../../../common/utils/index.js';
import c from "chalk";
import { CONSTANTS } from '../../../config/index.js';
import { WebSocketClient } from '../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class SourcePull extends SfCommand<any> {
  public static title = 'Scratch PULL';

  public static description = `
## Command Behavior

**Pulls metadata changes from your scratch org or source-tracked sandbox into your local project files.**

This command is essential for synchronizing your local development environment with the changes you've made directly in your Salesforce org. After pulling, you can then stage and commit the relevant files to your version control system.

Key features and considerations:

- **Underlying Command:** Internally, this command executes \`sf project retrieve start\` to fetch the metadata.
- **Error Handling:** If the pull operation encounters errors, it offers to automatically add the problematic items to your \`.forceignore\` file and then attempts to pull again, helping you resolve conflicts and ignore unwanted metadata.
- **Missing Updates:** If you don't see certain updated items in the pull results, you might need to manually retrieve them using the Salesforce Extension's **Org Browser** or the **Salesforce CLI** directly. Refer to the [Retrieve Metadatas documentation](${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-publish-task/#retrieve-metadatas) for more details.
- **Automatic Retrieval:** You can configure the \`autoRetrieveWhenPull\` property in your \`.sfdx-hardis.yml\` file to always retrieve specific metadata types (e.g., \`CustomApplication\`) that might not always be detected as updates by \`project:retrieve:start\`.

Example \`.sfdx-hardis.yml\` configuration for \`autoRetrieveWhenPull\`:
\`\`\`yaml
autoRetrieveWhenPull:
  - CustomApplication:MyCustomApplication
  - CustomApplication:MyOtherCustomApplication
  - CustomApplication:MyThirdCustomApp
\`\`\`

For a visual explanation of the process, watch this video:

<iframe width="560" height="315" src="https://www.youtube.com/embed/Ik6whtflmfY" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation focuses on robust metadata synchronization:

- **Salesforce CLI Wrapper:** It acts as a wrapper around the standard Salesforce CLI \`sf project retrieve start\` command, providing enhanced error handling and configuration options.
- **Force Source Pull Utility:** The core logic resides in the \`forceSourcePull\` utility function, which orchestrates the retrieval process, including handling \`.forceignore\` updates.
- **Configuration Integration:** It reads the \`autoRetrieveWhenPull\` setting from the project's \`.sfdx-hardis.yml\` to determine additional metadata to retrieve automatically.
- **User Feedback:** Provides clear messages to the user regarding the pull status and guidance for troubleshooting.
</details>
`;

  public static examples = ['$ sf hardis:scratch:pull'];

  // public static args = [{name: 'file'}];

  public static flags: any = {
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

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(SourcePull);
    const debugMode = flags.debug || false;
    const targetUsername = flags['target-org'].getUsername() || '';
    uxLog("action", this, c.cyan(`Pulling all latest metadata changes from dev org to local project files (including changes by other users)`));
    uxLog("action", this, c.cyan(`Pulling metadata changes from org: ${c.bold(targetUsername)}`));
    await forceSourcePull(targetUsername, debugMode);

    uxLog("warning", this, c.yellow(`Updated items not visible? Check documentation: https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/#retrieve-metadatas`));

    WebSocketClient.sendReportFileMessage("workbench.view.scm", "Commit your retrieved files", "actionCommand");
    WebSocketClient.sendReportFileMessage(`${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-publish-task/#commit-your-updates`, "Retrieve and Commit documentation", 'docUrl');
    // Return an object to be displayed with --json
    return { outputString: 'Pulled scratch org / source-tracked sandbox updates' };
  }
}
