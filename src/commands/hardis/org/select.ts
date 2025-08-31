/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from "chalk";
import { makeSureOrgIsConnected, promptOrg } from '../../../common/utils/orgUtils.js';
import { execSfdxJson, uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgSelect extends SfCommand<any> {
  public static title = 'Select org';

  public static description = `
## Command Behavior

**Allows you to select a Salesforce org and set it as your default, optionally filtering by Dev Hub or scratch orgs.**

This command simplifies switching between different Salesforce environments. It presents an interactive list of your authenticated orgs, enabling you to quickly set a new default org for subsequent Salesforce CLI commands.

Key functionalities:

- **Interactive Org Selection:** Displays a list of your authenticated Salesforce orgs, allowing you to choose one.
- **Default Org Setting:** Sets the selected org as the default for your Salesforce CLI environment.
- **Dev Hub Filtering:** The \`--devhub\` flag filters the list to show only Dev Hub orgs.
- **Scratch Org Filtering:** The \`--scratch\` flag filters the list to show only scratch orgs related to your default Dev Hub.
- **Connection Verification:** Ensures that the selected org is connected and prompts for re-authentication if necessary.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Interactive Org Prompt:** Uses the \`promptOrg\` utility to display a list of available Salesforce orgs and allows the user to select one. It passes the \`devHub\` and \`scratch\` flags to \`promptOrg\` to filter the displayed list.
- **Default Org Configuration:** The \`promptOrg\` utility (internally) handles setting the selected org as the default using Salesforce CLI's configuration mechanisms.
- **Connection Check:** It calls \`makeSureOrgIsConnected\` to verify the connection status of the selected org and guides the user to re-authenticate if the org is not connected.
- **Salesforce CLI Integration:** It leverages Salesforce CLI's underlying commands for org listing and authentication.
</details>
`;

  public static examples = ['$ sf hardis:org:select'];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    devhub: Flags.boolean({
      char: 'h',
      default: false,
      description: messages.getMessage('withDevHub'),
    }),
    scratch: Flags.boolean({
      char: 's',
      default: false,
      description: 'Select scratch org related to default DevHub',
    }),
    username: Flags.string({
      char: 't',
      description: "Username of the org you want to authenticate (overrides the interactive prompt)",
    },),
    "prompt-default": Flags.boolean({
      char: 'e',
      default: false,
      description: 'Prompt to set the selected org as default',
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
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgSelect);
    const devHub = flags.devhub || false;
    const scratch = flags.scratch;
    const promptDefault = flags["prompt-default"] || false;
    const username = flags.username;
    this.debugMode = flags.debug || false;

    let setDefault = true;
    if (promptDefault) {
      const promptDefaultRes = await prompts({
        type: 'confirm',
        name: 'setDefault',
        message: 'Do you want to set the selected org as your default org?',
        description: "If you choose 'No', the org will be connected but not set as default.",
        default: true,
      });
      if (!promptDefaultRes) {
        setDefault = false;
      }
    }

    let org: any = {};
    if (username) {
      uxLog("action", this, c.cyan(`Getting info about ${username} ...`));
      const displayOrgCommand = `sf org display --target-org ${username}`;
      const displayResult = await execSfdxJson(displayOrgCommand, this, {
        fail: false,
        output: false,
      });
      org = displayResult?.result;
    }
    else {
      // Prompt user to select an org
      org = await promptOrg(this, { devHub: devHub, setDefault: setDefault, scratch: scratch, useCache: false });
    }
    // If the org is not connected, ask the user to authenticate again
    uxLog("action", this, c.cyan(`Checking that user ${org.username} is connected to org ${org.instanceUrl} ...`));
    await makeSureOrgIsConnected(org.username);
    if (setDefault) {
      const setDefaultCommand = `sf config set target-org ${org.username}`;
      await execSfdxJson(setDefaultCommand, this, { output: false });
      uxLog("action", this, c.cyan(`Your default org is now ${org.instanceUrl} (${org.username})`));
      WebSocketClient.sendRefreshStatusMessage();
      return { outputString: `Selected org ${org.username}` };
    }
    else {
      uxLog("action", this, c.cyan(`Org ${org.instanceUrl} (${org.username}) connected`));
      WebSocketClient.sendRefreshStatusMessage();
      return { outputString: `Connected org ${org.username}` };
    }
  }
}
