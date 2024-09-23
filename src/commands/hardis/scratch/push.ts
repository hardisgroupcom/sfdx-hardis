/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { forceSourcePush } from '../../../common/utils/deployUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class SourcePush extends SfCommand<any> {
  public static title = 'Scratch PUSH';

  public static description = `Push local files to scratch org

Calls \`sf project deploy start\` under the hood
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
