/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { execCommand, isCI } from '../../../common/utils/index.js';
import { promptOrg } from '../../../common/utils/orgUtils.js';
import { prompts } from '../../../common/utils/prompts.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgConnect extends SfCommand<any> {
  public static title = 'Connect to an org';

  public static description = `
## Command Behavior

**Connects to a Salesforce org without setting it as the default username, and optionally opens the org in a web browser.**

This command provides a quick way to establish a connection to a Salesforce organization for one-off tasks or when you don't want to change your default org. It's useful for accessing different environments without disrupting your primary development setup.

Key functionalities:

- **Org Selection:** Prompts the user to select an existing Salesforce org or connect to a new one.
- **Non-Default Connection:** Ensures that the selected org is connected but does not set it as the default username for subsequent Salesforce CLI commands.
- **Browser Launch (Optional):** Offers to open the connected org directly in your default web browser, providing immediate access to the Salesforce UI.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Interactive Org Prompt:** Uses the \`promptOrg\` utility to display a list of available Salesforce orgs and allows the user to select one or initiate a new authentication flow.
- **Salesforce CLI Integration:** Internally, it leverages Salesforce CLI commands to establish the connection to the chosen org. It does not use \`sf config set target-org\` to avoid changing the default org.
- **Browser Launch:** If the user opts to open the org in a browser, it executes the \`sf org open\` command, passing the selected org's username as the target.
- **Environment Awareness:** Checks the \`isCI\` flag to determine whether to offer the browser launch option, as it's typically not applicable in continuous integration environments.
</details>
`;

  public static examples = ['$ sf hardis:org:connect'];

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
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgConnect);
    this.debugMode = flags.debug || false;

    // Prompt org to connect to
    const org = await promptOrg(this, { devHub: false, setDefault: false });

    // Prompt user if he/she wants to open org in Web Browser
    if (!isCI) {
      const openRes = await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Do you want to open this org in your web browser?',
        description: 'Launch the Salesforce org in your default web browser for immediate access.',
      });
      if (openRes.value === true) {
        const openCommand = `sf org open --target-org ${org.username}`;
        await execCommand(openCommand, this, { fail: true, output: true, debug: this.debugMode });
      }
    }

    // Return an object to be displayed with --json
    return { outputString: `Connected to org ${org.username}` };
  }
}
