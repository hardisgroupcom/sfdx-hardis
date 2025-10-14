/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { execCommand, getCurrentGitBranch, git, uxLog } from '../../../common/utils/index.js';
import { selectTargetBranch } from '../../../common/utils/gitUtils.js';
import { setConfig } from '../../../config/index.js';
import { prompts } from '../../../common/utils/prompts.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class RebuildSelection extends SfCommand<any> {
  public static title = 'Select again';

  public static description = `
## Command Behavior

**Resets the local Git repository to allow for a new selection of files to be included in a merge request.**

This command is designed to be used when you need to re-evaluate which changes should be part of your next merge request. It performs a soft Git reset, effectively unstaging all committed changes since the last merge with the target branch, and then cleans up any generated files.

Key functionalities:

- **Target Branch Selection:** Prompts you to select the target branch of your current or future merge request.
- **Soft Git Reset:** Performs a \`git reset --soft\` operation to uncommit changes, moving the HEAD pointer back but keeping the changes in your working directory.
- **Generated File Cleanup:** Resets and checks out \`manifest/package.xml\` and \`manifest/destructiveChanges.xml\` to their state before the reset, ensuring a clean slate for new selections.
- **Force Push Authorization:** Sets a flag in your user configuration (\`canForcePush: true\`) to allow a force push in the subsequent \`hardis:work:save\` command, as the history will have been rewritten.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Git Integration:** Uses \`simple-git\` (\`git()\`) to interact with the Git repository:
  - \`git().branch()\`: Retrieves information about local and remote branches.
  - \`git().log()\`: Fetches the commit history to determine which commits to reset.
  - \`git().reset()\`: Performs the soft reset operation.
  - \`git().checkout()\`: Resets specific files (\`package.xml\`, \`destructiveChanges.xml\`) to their previous state.
  - \`git().status()\`: Displays the current status of the Git repository after the reset.
- **Interactive Prompts:** Uses the \`prompts\` library to confirm the reset operation with the user and to select the target branch.
- **Configuration Management:** Updates the user's configuration (\`.sfdx-hardis.yml\`) using \`setConfig\` to set the \`canForcePush\` flag.
- **Error Handling:** Includes a check to prevent resetting protected branches.
</details>
`;

  public static examples = ['$ sf hardis:work:resetsave'];

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
    'target-org': requiredOrgFlagWithDeprecations,
  }; // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(RebuildSelection);
    this.debugMode = flags.debug || false;

    const targetBranch = await selectTargetBranch({
      message: 'Please select the target branch of your current or future merge request',
    });

    uxLog("action", this, c.cyan(`This script will rebuild selection that you will want to merge into ${c.green(targetBranch)}`));

    const currentGitBranch = await getCurrentGitBranch();
    if (currentGitBranch === targetBranch) {
      throw new SfError(c.red('[sfdx-hardis] You can not revert commits of a protected branch !'));
    }

    // Ask user to confirm
    const confirm = await prompts({
      type: 'confirm',
      message: `This command will git reset (soft) your branch ${currentGitBranch}. You will need to select and commit again your files. Are you sure ?`,
      description: 'Confirm that you want to perform a soft git reset on your current branch',
    });
    if (confirm.value === false) {
      throw new SfError(c.red('[sfdx-hardis] Cancelled by user.'));
    }

    // List all commits since the branch creation
    const logResult = await git().log([`${targetBranch}..${currentGitBranch}`]);
    const commitstoReset = logResult.all;
    const commitsToResetNumber = commitstoReset.length;
    // Reset commits
    await git({ output: true }).reset(['--soft', `HEAD~${commitsToResetNumber}`]);
    await setConfig('user', { canForcePush: true });
    // unstage files
    await execCommand('git reset', this, {
      output: true,
      fail: true,
      debug: this.debugMode,
    }); // await git({output:true}).reset(); does not work, let's use direct command
    await git({ output: true }).checkout(['--', 'manifest/package.xml']);
    await git({ output: true }).checkout(['--', 'manifest/destructiveChanges.xml']);
    await git({ output: true }).status();
    uxLog("action", this, c.cyan('The following items are now available for selection'));
    uxLog("action", this, c.cyan('Selection has been reset'));
    // Return an object to be displayed with --json
    return { outputString: 'Reset selection pocessed' };
  }
}
