/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class Login extends SfCommand<any> {
  public static title = 'Login';

  public static description = messages.getMessage('loginToOrg');

  public static examples = [
    '$ sf hardis:auth:login',
    'CI=true sf hardis:auth:login'
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    instanceurl: Flags.string({
      char: 'r',
      description: messages.getMessage('instanceUrl'),
    }),
    devhub: Flags.boolean({
      char: 'h',
      default: false,
      description: messages.getMessage('withDevHub'),
    }),
    scratchorg: Flags.boolean({
      char: 's',
      default: false,
      description: messages.getMessage('scratch'),
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

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    console.log('Entering Login command to authenticate to Salesforce org');
    const { flags } = await this.parse(Login);
    const devHub = flags.devhub || false;
    const scratch = flags.scratchorg || false;
    await this.config.runHook('auth', {
      checkAuth: !devHub,
      Command: this,
      devHub,
      scratch,
    });

    // Return an object to be displayed with --json
    return { outputString: 'Logged to Salesforce org' };
  }
}
