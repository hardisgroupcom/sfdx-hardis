/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { execCommand, getCurrentGitBranch, git, gitFetch, gitPull, uxLog } from '../../../common/utils/index.js';
import { forceSourcePull, forceSourcePush } from '../../../common/utils/deployUtils.js';
import { prompts } from '../../../common/utils/prompts.js';
import { getConfig } from '../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class RefreshTask extends SfCommand<any> {
  public static title = 'Refresh User Story branch';

  public static description = `
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
`;

  public static examples = ['$ sf hardis:work:refresh'];

  // public static args = [{name: 'file'}];

  public static flags: any = {
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

  protected debugMode = false;
  protected noPull = false;
  protected mergeBranch = null;

  /* jscpd:ignore-end */
  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(RefreshTask);
    const config = await getConfig('project');
    if (config.get('EXPERIMENTAL', '') !== 'true') {
      const msg = 'This command is not stable enough to be used. Use EXPERIMENTAL=true to use it anyway';
      uxLog("warning", this, c.yellow(msg));
      return { outputString: msg };
    }

    this.noPull = flags.nopull || false;
    uxLog(
      "action",
      this,
      c.cyan('This command will refresh your git branch and your org with the content of another git branch')
    );
    // Verify that the user saved his/her work before merging another branch
    const savePromptRes = await prompts({
      type: 'select',
      message: c.cyanBright(
        `This is a SENSITIVE OPERATION. Did you run ${c.green('hardis:work:save')} BEFORE running this command ?`
      ),
      name: 'value',
      description: 'Confirm that you have saved your current work before proceeding with this sensitive operation',
      placeholder: 'Select an option',
      choices: [
        {
          title: 'Yes I did save my current updates before merging updates from others !',
          value: true,
        },
        { title: 'No, I did not, I will do that right now', value: false },
      ],
    });
    if (savePromptRes.value !== true) {
      process.exit(0);
    }
    // Select branch to merge
    const localBranch = await getCurrentGitBranch();
    const branchSummary = await git().branch(['-r']);
    const branchChoices = [
      {
        title: `${config.developmentBranch} (recommended)`,
        value: config.developmentBranch,
      },
    ];
    for (const branchName of Object.keys(branchSummary.branches)) {
      const branchNameLocal = branchName.replace('origin/', '');
      if (branchNameLocal !== config.developmentBranch) {
        branchChoices.push({ title: branchNameLocal, value: branchNameLocal });
      }
    }
    const branchRes = await prompts({
      type: 'select',
      message: `Please select the branch that you want to merge in your current branch ${c.green(localBranch)}`,
      name: 'value',
      description: 'Choose which branch to merge into your current working branch',
      placeholder: 'Select a branch to merge',
      choices: branchChoices,
    });
    this.mergeBranch = branchRes.value;
    // Run refresh of local branch
    try {
      return await this.runRefresh(localBranch, flags);
    } catch (e) {
      uxLog(
        "warning",
        this,
        c.yellow('There has been a merge conflict or a technical error, please contact a Developer for help !')
      );
      throw e;
    }
  }

  private async runRefresh(localBranch, flags): Promise<AnyJson> {
    this.debugMode = flags.debug || false;

    uxLog(
      "action",
      this,
      c.cyan(
        `sfdx-hardis will refresh your local branch ${c.green(localBranch)} and your local scratch org ${c.green(
          flags['target-org'].getUsername()
        )} with the latest state of ${c.green(this.mergeBranch)}`
      )
    );

    if (localBranch === this.mergeBranch) {
      throw new SfError('[sfdx-hardis] You can not refresh from the same branch');
    }

    // Pull from scratch org
    if (this.noPull) {
      uxLog("action", this, c.cyan(`Skipped pull from scratch org`));
    } else {
      uxLog("action", this, c.cyan(`Pulling sources from scratch org ${flags['target-org'].getUsername()}...`));
      await forceSourcePull(flags['target-org'].getUsername(), this.debugMode);
    }

    // Stash
    uxLog(
      "action",
      this,
      c.cyan(
        `Stashing your uncommitted updates in ${c.green(localBranch)} before merging ${c.green(
          this.mergeBranch
        )} into your local branch ${c.green(localBranch)}...`
      )
    );
    const stashResult = await git({ output: true }).stash(['save', `[sfdx-hardis] Stash of ${localBranch}`]);
    const stashed = stashResult.includes('Saved working directory');
    // Pull most recent version of development branch
    uxLog("action", this, c.cyan(`Pulling most recent version of remote branch ${c.green(this.mergeBranch)}...`));
    await gitFetch({ output: true });
    await git({ output: true }).checkout(this.mergeBranch || '');
    const pullRes = await gitPull({ output: true });
    // Go back to current work branch
    await git({ output: true }).checkout(localBranch);
    // Check if merge is necessary ( https://stackoverflow.com/a/30177226/7113625 )
    const mergeRef = (
      await execCommand(`git show-ref --heads -s ${this.mergeBranch}`, this, {
        output: true,
      })
    ).stdout;
    const localRef = (await execCommand(`git merge-base ${this.mergeBranch} ${localBranch}`, this, { output: true }))
      .stdout;
    // Merge into current branch if necessary
    if (pullRes.summary.changes > 0 || mergeRef !== localRef) {
      // Create new commit from merge
      uxLog("action", this, c.cyan(`Creating a merge commit of ${c.green(this.mergeBranch)} within ${c.green(localBranch)}...`));
      let mergeSummary = await git({ output: true }).merge([this.mergeBranch || '']);
      while (mergeSummary.failed) {
        const mergeResult = await prompts({
          type: 'select',
          name: 'value',
          message: c.cyanBright(
            'There are merge conflicts, please solve them, then select YES here. Otherwise, exit the script and call a developer for help 😊'
          ),
          description: 'Choose your next action after attempting to resolve merge conflicts',
          placeholder: 'Select an option',
          choices: [
            { value: true, title: 'If finished to merge conflicts' },
            {
              value: false,
              title: "I can't merge conflicts, I give up for now",
            },
          ],
        });
        if (mergeResult.value === false) {
          uxLog("other", this, 'Refresh script stopped by user');
          process.exit(0);
        }
        mergeSummary = await git({ output: true }).merge(['--continue']);
      }
    } else {
      uxLog(
        "action",
        this,
        c.cyan(`Local branch ${c.green(localBranch)} is already up to date with ${c.green(this.mergeBranch)}`)
      );
    }
    // Restoring stash
    if (stashed) {
      uxLog("action", this, c.cyan(`Restoring stash into your local branch ${c.green(localBranch)}...`));
      await git({ output: true }).stash(['pop']);
    }

    // Push new branch state to scratch org
    await forceSourcePush(flags['target-org'].getUsername(), this, this.debugMode, {
      conn: flags['target-org'].getConnection(),
    });

    // Return an object to be displayed with --json
    return { outputString: 'Refreshed the User Story branch & org' };
  }
}
