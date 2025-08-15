/* jscpd:ignore-start */
import c from 'chalk';
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { getConfig } from '../../../../config/index.js';
import { uxLog } from '../../../../common/utils/index.js';
import { getPoolStorage } from '../../../../common/utils/poolUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ScratchPoolView extends SfCommand<any> {
  public static title = 'View scratch org pool info';

  public static description = `
## Command Behavior

**Displays information about the configured scratch org pool, including its current state and available scratch orgs.**

This command provides visibility into your scratch org pool, allowing you to monitor its health, check the number of available orgs, and verify its configuration. It's a useful tool for administrators and developers managing shared scratch org environments.

Key functionalities:

- **Pool Configuration Display:** Shows the \`poolConfig\` defined in your ".sfdx-hardis.yml" file, including the chosen storage service and the maximum number of scratch orgs.
- **Pool Storage Content:** Displays the raw content of the pool storage, which includes details about each scratch org in the pool (e.g., alias, username, expiration date).
- **Available Scratch Org Count:** Provides a summary of how many scratch orgs are currently available in the pool.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It retrieves the \`poolConfig\` from the project's ".sfdx-hardis.yml" file using \`getConfig\`.
- **Pool Storage Retrieval:** It uses \`getPoolStorage\` to connect to the configured storage service (e.g., Salesforce Custom Object, Redis) and retrieve the current state of the scratch org pool.
- **Data Display:** It logs the retrieved pool configuration and pool storage content to the console in a human-readable format.
- **Error Handling:** It checks if a scratch org pool is configured for the project and provides a warning message if it's not.
</details>
`;

  public static examples = ['$ sf hardis:scratch:pool:view'];

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
    const { flags } = await this.parse(ScratchPoolView);
    // Get pool configuration
    const config = await getConfig('project');
    const poolConfig = config.poolConfig || {};
    uxLog("log", this, 'Pool config: ' + c.grey(JSON.stringify(poolConfig, null, 2)));

    // Missing scratch orgs pool configuration
    if (!poolConfig.storageService) {
      uxLog(
        "warning",
        this,
        c.yellow(
          `There is not scratch orgs pool configured on this project. Please see with your tech lead about using command hardis:scratch:pool:configure`
        )
      );
      return { status: 1, outputString: 'Scratch org pool configuration to create' };
    }

    // Query pool storage
    const poolStorage = await getPoolStorage({
      devHubConn: flags['target-dev-hub']?.getConnection(),
      devHubUsername: flags['target-dev-hub']?.getUsername(),
    });
    uxLog("other", this, 'Pool storage: ' + c.grey(JSON.stringify(poolStorage, null, 2)));

    const scratchOrgs = poolStorage.scratchOrgs || [];
    const availableNumber = scratchOrgs.length;

    // Display logs
    uxLog("action", this, c.cyan(`There are ${c.bold(availableNumber)} available scratch orgs`));

    // Return an object to be displayed with --json
    return {
      status: 0,
      outputString: 'Viewed scratch org pool',
      poolStorage: poolStorage,
      availableScratchOrgs: availableNumber,
      maxScratchOrgs: poolConfig.maxScratchOrgsNumber,
    };
  }
}
