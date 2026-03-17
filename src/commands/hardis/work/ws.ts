/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { WebSocketClient } from '../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class WebSocketAction extends SfCommand<any> {
  public static title = 'WebSocket operations';

  public static description = `
## Command Behavior

**Performs technical operations related to WebSocket communication, primarily for internal use by the sfdx-hardis VS Code extension.**

This command is not intended for direct end-user interaction. It facilitates communication between the sfdx-hardis CLI and the VS Code Extension, enabling features like real-time status updates and plugin refreshes.

Key functionalities:

- **Refresh Status (\`--event refreshStatus\`):** Sends a message to the VS Code Extension to refresh its displayed status, ensuring that the UI reflects the latest state of Salesforce orgs or project activities.
- **Refresh Plugins (\`--event refreshPlugins\`):** Sends a message to the VS Code Extension to refresh its loaded plugins, useful after installing or updating sfdx-hardis or other related extensions.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **WebSocketClient:** It utilizes the \`WebSocketClient\` utility to establish and manage WebSocket connections.
- **Event-Driven Communication:** It listens for specific events (e.g., \`refreshStatus\`, \`refreshPlugins\`) and triggers corresponding actions on the connected WebSocket client.
- **Internal Use:** This command is primarily called programmatically by the VS Code Extension to maintain synchronization and provide a seamless user experience.
</details>
`;

  public static uiConfig = { hide: true };

  public static examples = ['$ sf hardis:work:ws --event refreshStatus'];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    event: Flags.string({
      char: 'e',
      description: 'WebSocket event',
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
  protected event = '';

  /* jscpd:ignore-end */
  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(WebSocketAction);
    this.event = flags.event || '';

    if (WebSocketClient.isAlive()) {
      if (this.event === 'refreshStatus') {
        WebSocketClient.sendRefreshStatusMessage();
      } else if (this.event === 'refreshPlugins') {
        WebSocketClient.sendRefreshPluginsMessage();
      }
    }

    // Return an object to be displayed with --json
    return { event: this.event };
  }
}
