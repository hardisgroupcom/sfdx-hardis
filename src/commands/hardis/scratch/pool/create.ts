/* jscpd:ignore-start */
import c from 'chalk';
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { AuthInfo, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { getConfig, setConfig } from '../../../../config/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { uxLog } from '../../../../common/utils/index.js';
import { instantiateProvider, listKeyValueProviders } from '../../../../common/utils/poolUtils.js';
import { KeyValueProviderInterface } from '../../../../common/utils/keyValueUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ScratchPoolCreate extends SfCommand<any> {
  public static title = 'Create and configure scratch org pool';

  public static description = `Select a data storage service and configure information to build a scratch org pool

  Run the command, follow instruction, then you need to schedule a daily CI job for the pool maintenance:

  - Define CI ENV variable SCRATCH_ORG_POOL with value "true"

  - Call the following lines in the CI job:

\`\`\`shell
  sf hardis:auth:login --devhub
  sf hardis:scratch:pool:refresh
\`\`\`
  `;

  public static examples = ['$ sf hardis:scratch:pool:configure'];

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
    'target-dev-hub': requiredHubFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    // Get pool configuration
    const { flags } = await this.parse(ScratchPoolCreate);
    const config = await getConfig('project');
    const poolConfig = config.poolConfig || {};

    // Tell user if he/she's about to overwrite existing configuration
    if (config.poolConfig && Object.keys(poolConfig).length > 0) {
      uxLog(
        this,
        c.yellow(
          `There is already an existing scratch org pool configuration: ${JSON.stringify(config.poolConfig)}.
If you really want to replace it, please remove poolConfig property from .sfdx-hardis.yml and run again this command`
        )
      );
      return { outputString: 'Scratch org pool configuration already existing' };
    }

    const allProviders = await listKeyValueProviders();
    const response = await prompts([
      {
        type: 'select',
        name: 'storageService',
        message: c.cyanBright('What storage service do you want to use for your scratch orgs pool ?'),
        initial: 0,
        choices: allProviders.map((provider: KeyValueProviderInterface) => {
          return { title: provider.name, description: provider.description, value: provider.name };
        }),
      },
      {
        type: 'number',
        name: 'maxScratchOrgsNumber',
        message: c.cyanBright('What is the maximum number of scratch orgs in the pool ?'),
        initial: poolConfig.maxScratchOrgsNumber || 5,
      },
    ]);

    // Store updated config
    poolConfig.maxScratchOrgsNumber = response.maxScratchOrgsNumber;
    poolConfig.storageService = response.storageService;
    await setConfig('project', { poolConfig: poolConfig });

    // Request additional setup to the user
    const provider = await instantiateProvider(response.storageService);
    await provider.userSetup({
      devHubConn: flags['target-dev-hub'].getConnection(),
      devHubUsername: flags['target-dev-hub'].getUsername(),
    });

    const authInfo = await AuthInfo.create({ username: flags['target-dev-hub'].getUsername() });
    const sfdxAuthUrl = authInfo.getSfdxAuthUrl();
    if (sfdxAuthUrl) {
      uxLog(
        this,
        c.cyan(`You need to define CI masked variable ${c.green('SFDX_AUTH_URL_DEV_HUB')} = ${c.green(sfdxAuthUrl)}`)
      );
    } else {
      uxLog(
        this,
        c.yellow(
          `You'll probably need to define CI masked variable ${c.green(
            'SFDX_AUTH_URL_DEV_HUB'
          )} with content of sfdxAuthUrl that you can retrieve with ${c.white(
            'sf org display -o YOURDEVHUBUSERNAME --verbose --json'
          )}`
        )
      );
    }

    // Return an object to be displayed with --json
    return { outputString: 'Configured scratch orgs pool' };
  }
}
