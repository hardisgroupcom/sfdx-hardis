/* jscpd:ignore-start */
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { execCommand } from '../../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageVersionList extends SfCommand<any> {
  public static title = 'Create a new version of a package';

  public static description = messages.getMessage('packageVersionList');

  public static examples = ['$ sf hardis:package:version:list'];

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
