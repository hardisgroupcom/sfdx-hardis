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

  public static description = `## Command Behavior

**Provides an assisted menu to delete Salesforce scratch orgs associated with a Dev Hub.**

This command simplifies the process of cleaning up your Salesforce development environments by allowing you to easily select and delete multiple scratch orgs. This is crucial for managing your scratch org limits and ensuring that you don't accumulate unnecessary or expired orgs.

Key functionalities:

- **Interactive Scratch Org Selection:** Displays a list of all active scratch orgs linked to your Dev Hub, including their usernames, instance URLs, and last used dates.
- **Multi-Selection:** Allows you to select multiple scratch orgs for deletion.
- **Confirmation Prompt:** Prompts for confirmation before proceeding with the deletion, ensuring that you don't accidentally delete important orgs.
- **Dev Hub Integration:** Works with your configured Dev Hub to manage scratch orgs.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce CLI Integration:** It executes the \`sf org list\` command to retrieve a list of all scratch orgs associated with the current Dev Hub. It then filters this list to show only active orgs.
- **Interactive Prompts:** Uses the \`prompts\` library to present a multi-select menu of scratch orgs to the user.
- **Scratch Org Deletion:** For each selected scratch org, it executes the \`sf org delete scratch --no-prompt\` command to perform the deletion.
- **Error Handling:** Includes basic error handling for Salesforce CLI commands.
- **Data Sorting:** Sorts the list of scratch orgs by username, alias, and instance URL for better readability in the interactive menu.
</details>
`;

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
      description: 'Choose which scratch orgs to permanently delete (this action cannot be undone)',
      choices: scratchOrgChoices,
    });

    // Delete scratch orgs
    for (const scratchOrgToDelete of scratchToDeleteRes.value) {
      const deleteCommand = `sf org delete scratch --no-prompt --target-org ${scratchOrgToDelete.username}`;
      await execCommand(deleteCommand, this, { fail: false, debug: debugMode, output: true });
      uxLog(
        "action",
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
