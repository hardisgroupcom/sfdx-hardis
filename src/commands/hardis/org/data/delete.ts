/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { deleteData, selectDataWorkspace } from '../../../../common/utils/dataUtils.js';
import { promptOrgUsernameDefault } from '../../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DataExport extends SfCommand<any> {
  public static title = 'Delete data';

  public static description = `
## Command Behavior

**Deletes records in multiple Salesforce objects using an SFDMU (Salesforce Data Migration Utility) workspace.**

This command provides a powerful and controlled way to remove data from your Salesforce orgs based on configurations defined in an SFDMU workspace. It's particularly useful for:

- **Data Cleanup:** Removing test data, obsolete records, or sensitive information.
- **Environment Reset:** Preparing sandboxes for new development cycles by clearing specific data sets.
- **Compliance:** Deleting data to meet regulatory requirements.

**Important Considerations for Production Environments:**

If you intend to run this command in a production environment, you must:

- Set \`runnableInProduction\` to \`true\` in your \`export.json\` file within the SFDMU workspace.
- Define \`sfdmuCanModify: YOUR_INSTANCE_URL\` in your branch-specific configuration file (e.g., \`config/branches/.sfdx-hardis.YOUR_BRANCH.yml\`) to explicitly authorize data modification for that instance.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation relies heavily on the SFDMU plugin:

- **SFDMU Integration:** It leverages the \`sfdmu\` plugin to perform the actual data deletion operations. The command acts as a wrapper, providing an assisted interface for SFDMU execution.
- **Workspace Selection:** If the SFDMU workspace path is not provided via the \`--path\` flag, it interactively prompts the user to select a data workspace using \`selectDataWorkspace\`.
- **Org Selection:** It ensures that a target Salesforce org is selected (either via the \`--target-org\` flag or through an interactive prompt using \`promptOrgUsernameDefault\`) to specify where the data deletion will occur.
- **\`deleteData\` Utility:** The core logic for executing the SFDMU deletion process is encapsulated within the \`deleteData\` utility function, which takes the SFDMU workspace path and the target username as arguments.
- **Environment Awareness:** It checks the \`isCI\` flag to determine whether to run in an interactive mode (prompting for user input) or a non-interactive mode (relying solely on command-line flags).
- **Required Plugin:** It explicitly lists \`sfdmu\` as a required plugin, ensuring that the necessary dependency is in place before execution.
</details>
`;

  public static examples = ['$ sf hardis:org:data:delete'];

  public static flags: any = {
    path: Flags.string({
      char: 'p',
      description: 'Path to the sfdmu workspace folder',
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
  public static requiresProject = false;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ['sfdmu'];

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DataExport);
    let sfdmuPath = flags.path || null;

    // Identify sfdmu workspace if not defined
    if (sfdmuPath == null) {
      sfdmuPath = await selectDataWorkspace({ selectDataLabel: 'Please select a data workspace to use for DELETION' });
    }

    // Select org that where records will be imported
    let orgUsername = flags['target-org'].getUsername();
    if (!isCI) {
      orgUsername = await promptOrgUsernameDefault(this, orgUsername || '', { devHub: false, setDefault: false, defaultOrgUsername: flags['target-org']?.getUsername() });
    }

    // Export data from org
    await deleteData(sfdmuPath || '', this, {
      targetUsername: orgUsername,
    });

    // Output message
    const message = `Successfully deleted data from org ${c.green(orgUsername)} using SFDMU project ${c.green(
      sfdmuPath
    )}`;
    uxLog("action", this, c.cyan(message));
    return { outputString: message };
  }
}
