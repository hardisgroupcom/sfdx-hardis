/* jscpd:ignore-start */
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { execCommand, execSfdxJson, uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import c from 'chalk';
import sortArray from 'sort-array';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ScratchDelete extends SfCommand<any> {
  public static title = 'Delete scratch orgs(s)';

  public static description = 'Assisted menu to delete scratch orgs associated to a DevHub';

  public static examples = ['$ sf hardis:scratch:delete'];

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

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ScratchDelete);
    const debugMode = flags.debug || false;

    // List all scratch orgs referenced on local computer
    const orgListRequest = 'sf org list';
    const hubOrgUsername = flags['target-dev-hub'].getUsername();
    const orgListResult = await execSfdxJson(orgListRequest, this, { fail: true, output: false, debug: debugMode });
    const scratchOrgsSorted = sortArray(orgListResult?.result?.scratchOrgs || [], {
      by: ['username', 'alias', 'instanceUrl'],
      order: ['asc', 'asc', 'asc'],
    });
    const scratchOrgChoices = scratchOrgsSorted
      .filter((scratchInfo: any) => {
        return scratchInfo.devHubUsername === hubOrgUsername;
      })
      .map((scratchInfo: any) => {
        return {
          title: scratchInfo.username,
          description: `${scratchInfo.instanceUrl}, last used on ${new Date(
            scratchInfo.lastUsed
          ).toLocaleDateString()}`,
          value: scratchInfo,
        };
      });

    // Request user which scratch he/she wants to delete
    const scratchToDeleteRes = await prompts({
      type: 'multiselect',
      name: 'value',
      message: c.cyanBright('Please select the list of scratch orgs you want to delete'),
      choices: scratchOrgChoices,
    });

    // Delete scratch orgs
    for (const scratchOrgToDelete of scratchToDeleteRes.value) {
      const deleteCommand = `sf org delete scratch --no-prompt --target-org ${scratchOrgToDelete.username}`;
      await execCommand(deleteCommand, this, { fail: false, debug: debugMode, output: true });
      uxLog(
        this,
        c.cyan(
          `Scratch org ${c.green(scratchOrgToDelete.username)} at ${scratchOrgToDelete.instanceUrl} has been deleted`
        )
      );
    }

    // Return an object to be displayed with --json
    return { outputString: 'Deleted scratch orgs' };
  }
}
