/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from "chalk";
import { deleteRottenAuthFile, makeSureOrgIsConnected, promptOrg } from '../../../common/utils/orgUtils.js';
import { execSfdxJson, isCI, uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgSelect extends SfCommand<any> {
  public static title = 'Select org';

  public static description = `
## Command Behavior

> **This command requires human interaction and must be called manually, preferably from the [VS Code SFDX Hardis UI](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis). It is not suitable for automation or AI agent usage.**

**Allows you to select a Salesforce org and set it as your default, optionally filtering by Dev Hub or scratch orgs.**

This command simplifies switching between different Salesforce environments. It presents an interactive list of your authenticated orgs, enabling you to quickly set a new default org for subsequent Salesforce CLI commands.

Key functionalities:

- **Interactive Org Selection:** Displays a list of your authenticated Salesforce orgs, allowing you to choose one.
- **Default Org Setting:** Sets the selected org as the default for your Salesforce CLI environment.
- **Dev Hub Filtering:** The \`--devhub\` flag filters the list to show only Dev Hub orgs.
- **Scratch Org Filtering:** The \`--scratch\` flag filters the list to show only scratch orgs related to your default Dev Hub.
- **Connection Verification:** Ensures that the selected org is connected and prompts for re-authentication if necessary.
- **Forced Reconnection:** The \`--reconnect\` flag skips the connection check and goes straight to re-authentication.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Interactive Org Prompt:** Uses the \`promptOrg\` utility to display a list of available Salesforce orgs and allows the user to select one. It passes the \`devHub\` and \`scratch\` flags to \`promptOrg\` to filter the displayed list.
- **Default Org Configuration:** The \`promptOrg\` utility (internally) handles setting the selected org as the default using Salesforce CLI's configuration mechanisms.
- **Connection Check:** It calls \`makeSureOrgIsConnected\` to verify the connection status of the selected org and guides the user to re-authenticate if the org is not connected.
- **Forced Reconnection:** When \`--reconnect\` is used, the command skips the connection check and directly triggers \`sf org login web\` with \`--set-default\`, combining re-authentication and default-setting into a single CLI call.
- **Salesforce CLI Integration:** It leverages Salesforce CLI's underlying commands for org listing and authentication.
</details>
`;

  public static examples = [
    '$ sf hardis:org:select',
    '$ sf hardis:org:select --devhub',
    '$ sf hardis:org:select --username myuser@example.com --set-default',
    '$ sf hardis:org:select --username myuser@example.com --no-set-default',
    '$ sf hardis:org:select --reconnect --instance-url https://myorg.salesforce.com --set-default',
    '$ sf hardis:org:select --agent --set-default',
  ];

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
    }),
    reconnect: Flags.boolean({
      char: 'r',
      default: false,
      description: 'Force re-authentication (skip connection check and go straight to login)',
    }),
    "set-default": Flags.boolean({
      allowNo: true,
      description: 'Set the selected org as default target-org (or target-dev-hub if --devhub is used). Use --no-set-default to skip. If omitted, you will be prompted.',
    }),
    "instance-url": Flags.string({
      dependsOn: ['reconnect'],
      description: 'Instance URL to use for login when reconnecting (e.g. https://myorg.salesforce.com). Required with --reconnect.',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
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
    const username = flags.username;
    const reconnect = flags.reconnect || false;
    const agentMode = flags.agent === true;
    const instanceUrl = flags["instance-url"] || null;
    this.debugMode = flags.debug || false;

    // Resolve setDefault: explicit flag > agent/CI mode > prompt
    let setDefault: boolean;
    const setDefaultFlag = flags["set-default"];
    if (setDefaultFlag === true || setDefaultFlag === false) {
      setDefault = setDefaultFlag;
    } else if (agentMode || isCI) {
      setDefault = true;
    } else {
      const promptRes = await prompts({
        type: 'confirm',
        name: 'setDefault',
        message: t('doYouWantToSetTheSelected'),
        description: t('ifYouChooseNoTheOrgWillBeConnectedButNotSetAsDefault'),
        default: true,
      });
      setDefault = promptRes.setDefault !== false;
    }

    let org: any = {};

    if (reconnect) {
      // Force re-authentication via auth hook: skip org display / promptOrg entirely
      if (!instanceUrl) {
        throw new Error('--instance-url is required when using --reconnect');
      }
      uxLog("action", this, c.cyan(t('reconnectingToOrg', { org: username || instanceUrl })));
      // Delete potentially rotten auth file before reconnecting (e.g. after sandbox refresh)
      if (username) {
        await deleteRottenAuthFile(username);
      }
      await this.config.runHook('auth', {
        checkAuth: true,
        Command: this,
        devHub,
        setDefault,
        instanceUrl,
        forceUsername: username || undefined,
      });
      org = globalThis.justConnectedOrg || {};
    } else if (username) {
      // Get org info with a single sf org display call
      uxLog("action", this, c.cyan(t('gettingInfoAbout', { username })));
      const displayOrgCommand = `sf org display --target-org ${username}`;
      const displayResult = await execSfdxJson(displayOrgCommand, this, {
        fail: false,
        output: false,
      });
      org = displayResult?.result;
      // Pass org object to avoid a duplicate sf org display call inside makeSureOrgIsConnected
      uxLog("action", this, c.cyan(t('checkingThatUserIsConnectedToOrg', { org: org.username, org1: org.instanceUrl })));
      await makeSureOrgIsConnected(org);
      // Set default org with the correct config key for devhub vs target-org
      if (setDefault) {
        const configKey = devHub ? 'target-dev-hub' : 'target-org';
        const setDefaultCommand = `sf config set ${configKey}=${org.username}`;
        await execSfdxJson(setDefaultCommand, this, { output: false });
      }
    } else {
      // Prompt user to select an org
      // promptOrg handles connection verification and default-setting
      org = await promptOrg(this, { devHub, setDefault, scratch, useCache: false });
    }

    if (setDefault) {
      uxLog("action", this, c.cyan(t('yourDefaultOrgIsNow', { org: org?.instanceUrl, org1: org?.username })));
    } else {
      uxLog("action", this, c.cyan(t('orgConnected', { org: org?.instanceUrl, org1: org?.username })));
    }
    WebSocketClient.sendRefreshStatusMessage();
    return { outputString: `${setDefault ? 'Selected' : 'Connected'} org ${org?.username}` };
  }
}
