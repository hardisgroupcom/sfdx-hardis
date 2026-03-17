/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { forceSourcePush } from '../../../common/utils/deployUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class SourcePush extends SfCommand<any> {
  public static title = 'Scratch PUSH';

  public static description = `## Command Behavior

**Pushes local Salesforce DX source files to a scratch org or source-tracked sandbox.**

This command is a fundamental operation in Salesforce DX development, allowing developers to synchronize their local codebase with their development org. It ensures that changes made locally are reflected in the scratch org, enabling testing and validation.

Key functionalities:

- **Source Synchronization:** Deploys all local changes (metadata and code) to the target scratch org.
- **Underlying Command:** Internally, this command executes \`sf project deploy start\` to perform the push operation.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce CLI Wrapper:** It acts as a wrapper around the standard Salesforce CLI \`sf project deploy start\` command.
- **\`forceSourcePush\` Utility:** The core logic resides in the \`forceSourcePush\` utility function, which orchestrates the deployment process.
- **Connection Handling:** It uses the connection to the target org to perform the push operation.
</details>
`;

  public static examples = ['$ sf hardis:scratch:push'];

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
    const { flags } = await this.parse(SourcePush);
    const debugMode = flags.debug || false;
    await forceSourcePush(flags['target-org'].getUsername() || '', this, debugMode, {
      conn: flags['target-org'].getConnection(),
    });
    // Return an object to be displayed with --json
    return { outputString: 'Pushed local git branch in scratch org' };
  }
}
