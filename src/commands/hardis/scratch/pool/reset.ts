/* jscpd:ignore-start */
import c from 'chalk';
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { getPoolStorage, setPoolStorage } from '../../../../common/utils/poolUtils.js';
import { getConfig } from '../../../../config/index.js';
import { execCommand, uxLog } from '../../../../common/utils/index.js';
import { authenticateWithSfdxUrlStore } from '../../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ScratchPoolReset extends SfCommand<any> {
  public static title = 'Reset scratch org pool';

  public static description = 'Reset scratch org pool (delete all scratches in the pool)';

  public static examples = ['$ sf hardis:scratch:pool:refresh'];

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
  private debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ScratchPoolReset);
    this.debugMode = flags.debug || false;

    // Check pool configuration is defined on project
    const config = await getConfig('project');
    if (config.poolConfig == null) {
      uxLog(
        this,
        c.yellow('Configuration file must contain a poolConfig property') +
        '\n' +
        c.grey(JSON.stringify(config, null, 2))
      );
      return { outputString: 'Configuration file must contain a poolConfig property' };
    }
    uxLog(this, c.cyan(`Reseting scratch org pool on org ${c.green(flags['target-dev-hub'].getUsername())}...`));
    uxLog(this, c.grey('Pool config: ' + JSON.stringify(config.poolConfig)));

    // Get pool storage
    const poolStorage = await getPoolStorage({
      devHubConn: flags['target-dev-hub'].getConnection(),
      devHubUsername: flags['target-dev-hub'].getUsername(),
    });
    let scratchOrgs = poolStorage.scratchOrgs || [];

    // Delete existing scratch orgs
    /* jscpd:ignore-start */
    const scratchOrgsToDelete = [...scratchOrgs];
    scratchOrgs = [];
    poolStorage.scratchOrgs = scratchOrgs;
    await setPoolStorage(poolStorage, {
      devHubConn: flags['target-dev-hub'].getConnection(),
      devHubUsername: flags['target-dev-hub'].getUsername(),
    });
    for (const scratchOrgToDelete of scratchOrgsToDelete) {
      // Authenticate to scratch org to delete
      await authenticateWithSfdxUrlStore(scratchOrgToDelete);
      // Delete scratch org
      const deleteCommand = `sf org delete scratch --no-prompt --target-org ${scratchOrgToDelete.scratchOrgUsername}`;
      await execCommand(deleteCommand, this, { fail: false, debug: this.debugMode, output: true });
      uxLog(
        this,
        c.cyan(
          `Scratch org ${c.green(scratchOrgToDelete.scratchOrgUsername)} at ${scratchOrgToDelete?.authFileJson?.result?.instanceUrl
          } has been deleted`
        )
      );
    }
    /* jscpd:ignore-end */

    return { outputString: 'Reset scratch orgs pool' };
  }
}
