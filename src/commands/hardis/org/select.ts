/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { makeSureOrgIsConnected, promptOrg } from '../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgSelect extends SfCommand<any> {
  public static title = 'Select org';

  public static description = messages.getMessage('selectOrg');

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
    this.debugMode = flags.debug || false;

    // Prompt user to select an org
    const org = await promptOrg(this, { devHub: devHub, setDefault: true, scratch: scratch });

    // If the org is not connected, ask the user to authenticate again
    await makeSureOrgIsConnected(org.username);

    // Return an object to be displayed with --json
    return { outputString: `Selected org ${org.username}` };
  }
}
