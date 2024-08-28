/* jscpd:ignore-start */
import c from 'chalk';
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { getConfig } from '../../../../config/index.js';
import { uxLog } from '../../../../common/utils/index.js';
import { instantiateProvider } from '../../../../common/utils/poolUtils.js';
import { KeyValueProviderInterface } from '../../../../common/utils/keyValueUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ScratchPoolLocalAuth extends SfCommand<any> {
  public static title = 'Authenticate locally to scratch org pool';

  public static description =
    'Calls the related storage service to request api keys and secrets that allows a local user to fetch a scratch org from scratch org pool';

  public static examples = ['$ sf hardis:scratch:pool:localauth'];

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
    // Get pool configuration
    const config = await getConfig('project');
    const poolConfig = config.poolConfig || {};

    // Tell user if he/she's about to overwrite existing configuration
    if (!poolConfig.storageService) {
      uxLog(
        this,
        c.yellow(
          `There is not scratch orgs pool configured on this project. Please see with your tech lead about using command hardis:scratch:pool:configure`
        )
      );
      return { outputString: 'Scratch org pool configuration to create' };
    }

    // Request additional setup to the user
    const provider: KeyValueProviderInterface = await instantiateProvider(poolConfig.storageService);
    await provider.userAuthenticate();

    // Return an object to be displayed with --json
    return { outputString: 'Locally authenticated with scratch org pool' };
  }
}
