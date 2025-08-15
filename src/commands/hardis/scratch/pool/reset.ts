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

  public static description = `
## Command Behavior

**Resets the scratch org pool by deleting all existing scratch orgs within it.**

This command provides a way to clear out the entire scratch org pool, effectively starting fresh. This can be useful for:

- **Troubleshooting:** If the pool becomes corrupted or contains problematic scratch orgs.
- **Major Changes:** When there are significant changes to the scratch org definition or initialization process that require all existing orgs to be recreated.
- **Cleanup:** Periodically cleaning up the pool to ensure only the latest and most relevant scratch orgs are available.

Key functionalities:

- **Full Pool Deletion:** Identifies all scratch orgs currently in the pool and initiates their deletion.
- **Dev Hub Integration:** Works with your configured Dev Hub to manage the scratch orgs within the pool.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It retrieves the \`poolConfig\` from the project's .sfdx-hardis.yml file to ensure a pool is configured.
- **Pool Storage Interaction:** It uses \`getPoolStorage\` to retrieve the current list of scratch orgs in the pool and \`setPoolStorage\` to clear the pool's record.
- **Scratch Org Deletion:** It iterates through each scratch org in the retrieved list. For each org, it authenticates to it using \`authenticateWithSfdxUrlStore\` and then executes \`sf org delete scratch\` via \`execCommand\`.
- **Logging:** Provides clear messages about the deletion process and the status of each scratch org.
</details>
`;

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
        "warning",
        this,
        c.yellow('Configuration file must contain a poolConfig property') +
        '\n' +
        c.grey(JSON.stringify(config, null, 2))
      );
      return { outputString: 'Configuration file must contain a poolConfig property' };
    }
    uxLog("action", this, c.cyan(`Reseting scratch org pool on org ${c.green(flags['target-dev-hub'].getUsername())}...`));
    uxLog("log", this, c.grey('Pool config: ' + JSON.stringify(config.poolConfig)));

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
        "action",
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
