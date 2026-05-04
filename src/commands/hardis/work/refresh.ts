/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class RefreshTask extends SfCommand<any> {
  public static title = 'Refresh User Story branch';

  public static description = `
## DEPRECATED

**This command is deprecated. Use \`sf hardis:work:backpromote\` instead.**

## Command Behavior

**Refreshes your local Git branch and Salesforce org with the latest content from another Git branch.**

This command is designed to help developers keep their local development environment synchronized with changes made by other team members. It automates the process of pulling updates from a designated branch, merging them into your current working branch, and then pushing those changes to your scratch org or source-tracked sandbox.

Key functionalities:

- **Pre-Merge Check:** Prompts the user to confirm that they have saved their current work before proceeding with the merge, preventing accidental data loss.
- **Branch Selection:** Allows you to select a target Git branch (e.g., \`integration\`, \`preprod\`) from which to pull updates.
- **Git Operations:** Performs a series of Git operations:
  - Pulls the latest version of the selected merge branch.
  - Stashes your uncommitted local changes before merging.
  - Merges the selected branch into your current local branch.
  - Handles merge conflicts interactively, prompting the user to resolve them.
  - Restores your stashed changes after the merge.
- **Org Synchronization:** Pushes the updated local branch content to your scratch org or source-tracked sandbox, ensuring your org reflects the latest merged code.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It retrieves project configurations using \`getConfig\` to determine the default development branch.
- **Git Integration:** Extensively uses \`simple-git\` (\`git()\`) for various Git operations:
  - \`git().branch()\`: Lists local and remote branches.
  - \`git().stash()\`: Saves and restores uncommitted changes.
  - \`git().fetch()\`: Fetches updates from remote repositories.
  - \`git().checkout()\`: Switches between branches.
  - \`git().pull()\`: Pulls changes from a remote branch.
  - \`git().merge()\`: Merges one branch into another, handling conflicts.
- **Interactive Prompts:** Uses the \`prompts\` library to guide the user through confirmations (e.g., saving work) and branch selection.
- **Salesforce CLI Integration:** It uses \`forceSourcePull\` to pull changes from the scratch org and \`forceSourcePush\` to push changes to the scratch org.
- **Error Handling:** Includes robust error handling for Git operations (e.g., merge conflicts) and provides guidance to the user for resolution.
- **Environment Variable Check:** Checks for an \`EXPERIMENTAL\` environment variable to gate access to this command, indicating it might not be fully stable.
</details>

### Agent Mode

Use \`--agent\` to disable all interactive prompts. The command will:

- Skip the save confirmation prompt and proceed automatically.
- Use the configured \`developmentBranch\` as the merge branch (no branch selection prompt).
- Auto-proceed on merge conflicts instead of prompting (will fail if conflicts cannot be resolved automatically).

Required flags: none beyond \`--agent\` (uses project defaults).
`;

  public static examples = ['$ sf hardis:work:refresh', '$ sf hardis:work:refresh --agent'];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    nopull: Flags.boolean({
      char: 'n',
      default: false,
      description: 'No scratch pull before save (careful if you use that!)',
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
    'target-org': requiredOrgFlagWithDeprecations,
  }; // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  /* jscpd:ignore-end */
  public async run(): Promise<AnyJson> {
    uxLog("error", this, c.red(t('workRefreshDeprecatedUseBackpromote')));
    process.exitCode = 1;
    return { outputString: 'This command is deprecated. Use sf hardis:work:backpromote instead.' };
  }
}
