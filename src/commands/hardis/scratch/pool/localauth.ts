/* jscpd:ignore-start */
import c from 'chalk';
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { getConfig } from '../../../../config/index.js';
import { uxLog } from '../../../../common/utils/index.js';
import { instantiateProvider } from '../../../../common/utils/poolUtils.js';
import { KeyValueProviderInterface } from '../../../../common/utils/keyValueUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ScratchPoolLocalAuth extends SfCommand<any> {
  public static title = 'Authenticate locally to scratch org pool';

  public static description = `
## Command Behavior

**Authenticates a local user to the configured scratch org pool storage service, enabling them to fetch and manage scratch orgs from the pool.**

This command is essential for developers who want to utilize a shared scratch org pool for their local development. It establishes the necessary authentication with the backend storage service (e.g., Salesforce Custom Object, Redis) that manages the pool's state, allowing the user to retrieve available scratch orgs for their work.

Key functionalities:

- **Storage Service Authentication:** Initiates the authentication process with the chosen storage service to obtain the required API keys or secrets.
- **Enables Pool Access:** Once authenticated, the local user can then use other sfdx-hardis commands to fetch, use, and return scratch orgs from the pool.
- **Configuration Check:** Verifies if a scratch org pool is already configured for the current project and provides guidance if it's not.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It retrieves the \`poolConfig\` from the project's .sfdx-hardis.yml file to identify the configured storage service.
- **Provider Instantiation:** It uses the \`instantiateProvider\` utility function to create an instance of the \`KeyValueProviderInterface\` corresponding to the configured storage service.
- **User Authentication:** It then calls the \`userAuthenticate()\` method on the instantiated provider. This method encapsulates the specific logic for authenticating with the chosen storage service (e.g., prompting for API keys, performing OAuth flows).
- **Error Handling:** It checks for the absence of a configured scratch org pool and provides a user-friendly message.
</details>
`;

  public static examples = ['$ sf hardis:scratch:pool:localauth'];

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
    'target-dev-hub': requiredHubFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    // Get pool configuration
    const config = await getConfig('project');
    const poolConfig = config.poolConfig || {};

    // Tell user if he/she's about to overwrite existing configuration
    if (!poolConfig.storageService) {
      uxLog(
        "warning",
        this,
        c.yellow(
          `There is not scratch orgs pool configured on this project. Please see with your tech lead about using command hardis:scratch:pool:configure`
        )
      );
      return { outputString: 'Scratch org pool configuration to create' };
    }

    // Request additional setup to the user
    const provider: KeyValueProviderInterface = await instantiateProvider(poolConfig.storageService);
    await provider.userAuthenticate();

    // Return an object to be displayed with --json
    return { outputString: 'Locally authenticated with scratch org pool' };
  }
}
