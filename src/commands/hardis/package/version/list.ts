/* jscpd:ignore-start */
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { execCommand } from '../../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageVersionList extends SfCommand<any> {
  public static title = 'Create a new version of a package';

  public static description = `
## Command Behavior

**Lists all Salesforce package versions associated with your Dev Hub.**

This command provides a comprehensive overview of your Salesforce packages and their versions, including details such as package ID, version number, installation key status, and creation date. It's an essential tool for managing your package development lifecycle, tracking releases, and identifying available versions for installation or promotion.

Key functionalities:

- **Comprehensive Listing:** Displays all package versions, regardless of their status (e.g., released, beta).
- **Dev Hub Integration:** Retrieves package version information directly from your connected Dev Hub.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation is straightforward:

- **Salesforce CLI Integration:** It directly executes the \`sf package version list\` command.
- **\`execCommand\`:** This utility is used to run the Salesforce CLI command and capture its output.
- **Output Display:** The raw output from the Salesforce CLI command is displayed to the user, providing all the details about the package versions.
</details>
`;

  public static examples = ['$ sf hardis:package:version:list'];

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
    const { flags } = await this.parse(PackageVersionList);
    const debugMode = flags.debug || false;
    const createCommand = 'sf package version list';
    await execCommand(createCommand, this, {
      fail: true,
      output: true,
      debug: debugMode,
    });
    // Return an object to be displayed with --json
    return { outputString: 'Listed package versions' };
  }
}
