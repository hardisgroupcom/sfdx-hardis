/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { promptOrgUsernameDefault, setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { wrapSfdxCoreCommand } from '../../../../common/utils/wrapUtils.js';


Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DeploySimulate extends SfCommand<any> {
  public static title = 'Simulate the deployment of metadata in an org prompted to the user.\nUsed by VS Code extension.';

  public static description: string = `
## Command Behavior

**Simulates the deployment of Salesforce metadata to a target org, primarily used by the VS Code Extension for quick validation.**

This command allows developers to perform a dry run of a metadata deployment without actually committing changes to the Salesforce org. This is incredibly useful for:

- **Pre-Deployment Validation:** Identifying potential errors, warnings, or conflicts before a full deployment.
- **Troubleshooting:** Quickly testing metadata changes and debugging issues in a safe environment.
- **Local Development:** Validating changes to individual metadata components (e.g., a Permission Set) without needing to run a full CI/CD pipeline.

Key functionalities:

- **Source Specification:** Takes a source file or directory (\`--source-dir\`) containing the metadata to be simulated.
- **Target Org Selection:** Prompts the user to select a Salesforce org for the simulation. This allows for flexible testing across different environments.
- **Dry Run Execution:** Executes the Salesforce CLI's \`sf project deploy start --dry-run\` command, which performs all validation steps but does not save any changes to the org.

This command is primarily used by the VS Code Extension to provide immediate feedback to developers.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Interactive Org Prompt:** Uses \`promptOrgUsernameDefault\` to allow the user to select the target Salesforce org for the deployment simulation.
- **Salesforce CLI Integration:** It constructs and executes the \`sf project deploy start\` command with the \`--dry-run\` and \`--ignore-conflicts\` flags. The \`--source-dir\` and \`--target-org\` flags are dynamically populated based on user input.
- **\`wrapSfdxCoreCommand\`:** This utility is used to execute the Salesforce CLI command and capture its output.
- **Connection Variables:** Ensures Salesforce connection variables are set using \`setConnectionVariables\`.
</details>
`;

  public static examples = [
    '$ sf hardis:project:deploy:simulate --source-dir force-app/defaut/main/permissionset/PS_Admin.permissionset-meta.xml',
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    "source-dir": Flags.string({
      char: "f",
      description: "Source file or directory to simulate the deployment",
      multiple: true,
      required: true
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

  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DeploySimulate);
    const sourceDirOrFile = flags["source-dir"];
    this.debugMode = flags.debug || false;

    // Prompt target org to user
    const orgUsername = await promptOrgUsernameDefault(this,
      flags['target-org'].getUsername(),
      { devHub: false, setDefault: false, message: `Do you want to use org ${flags['target-org'].getConnection().instanceUrl} to simulate deployment of metadata ${sourceDirOrFile} ?`, quickOrgList: true });

    await setConnectionVariables(flags['target-org']?.getConnection(), true);

    // Build command
    const simulateDeployCommand = "sf project deploy start" +
      ` --source-dir "${sourceDirOrFile}"` +
      ` --target-org ${orgUsername}` +
      ` --ignore-conflicts` +
      ` --dry-run`;

    // Simulate deployment
    const result = await wrapSfdxCoreCommand(simulateDeployCommand, [], this, flags.debug);
    return result;
  }
}
