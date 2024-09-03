/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { WebSocketClient } from '../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class WebSocketAction extends SfCommand<any> {
  public static title = 'WebSocket operations';

  public static description = 'Technical calls to WebSocket functions';

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
        WebSocketClient.sendMessage({ event: 'refreshStatus' });
      } else if (this.event === 'refreshPlugins') {
        WebSocketClient.sendMessage({ event: 'refreshPlugins' });
      }
    }

    // Return an object to be displayed with --json
    return { event: this.event };
  }
}
