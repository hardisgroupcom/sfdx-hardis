/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { execCommand, isCI } from '../../../common/utils/index.js';
import { promptOrg } from '../../../common/utils/orgUtils.js';
import { prompts } from '../../../common/utils/prompts.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-template-sf-external', 'org');

export default class OrgConnect extends SfCommand<any> {
  public static title = 'Connect to an org';

  public static description = `Connect to an org without setting it as default username, then proposes to open the org in web browser
  `;

  public static examples = ['$ sf hardis:org:connect'];

  // public static args = [{name: 'file'}];

  public static flags = {
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
        message: 'Do you want to open this org in Web Browser ?',
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
