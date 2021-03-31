/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, SfdxError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import { getCurrentGitBranch, git, uxLog } from '../../../common/utils';
import { forceSourcePull, forceSourcePush } from '../../../common/utils/deployUtils';
import { prompts } from '../../../common/utils/prompts';
import { getConfig } from '../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class RefreshTask extends SfdxCommand {

    public static title = 'Refresh work task';

    public static description = messages.getMessage('refreshWorkTask');

    public static examples = [
        '$ sfdx hardis:work:refresh'
    ];

    // public static args = [{name: 'file'}];

    protected static flagsConfig = {
        debug: flags.boolean({ char: 'd', default: false, description: messages.getMessage('debugMode') })
    };

    // Comment this out if your command does not require an org username
    protected static requiresUsername = true;

    // Comment this out if your command does not support a hub org username
    protected static supportsDevhubUsername = false;

    // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
    protected static requiresProject = true;

    protected debugMode = false;

    /* jscpd:ignore-end */
    public async run(): Promise<AnyJson> {
        try {
            return await this.runRefresh()
        } catch (e) {
            uxLog(this,c.yellow("There has been a merge conflict or a technical error, please contact a Developer for help !"));
            throw e;
        }
    }

    private async runRefresh(): Promise<AnyJson> {
        this.debugMode = this.flags.debug || false;
        const config = await getConfig('project');
        const localBranch = await getCurrentGitBranch();
        uxLog(this, c.cyan(`This script will refresh your local branch ${c.green(localBranch)} and your local scratch org ${c.green(this.org.getUsername())} with the latest state of ${c.green(config.developmentBranch)}`));

        if (localBranch === config.developmentBranch) {
            throw new SfdxError('[sfdx-hardis] You can not refresh from the same branch');
        }

        uxLog(this, c.cyan(`Pulling sources from scratch org ${this.org.getUsername()}...`));
        await forceSourcePull(this.org.getUsername(),this.debugMode);

        // Stash
        uxLog(this, c.cyan(`Stashing your uncommited updates in ${c.green(localBranch)} before merging ${c.green(config.developmentBranch)} into your local branch ${c.green(localBranch)}...`));
        const stashResult = await git({output: true}).stash(['save',`[sfdx-hardis] Stash of ${localBranch}`]);
        const stashed = stashResult.includes('Saved working directory');
        // Pull most recent version of development branch
        uxLog(this, c.cyan(`Pulling most recent version of remote branch ${c.green(config.developmentBranch)}...`));
        await git({output: true}).fetch();
        await git({output: true}).checkout(config.developmentBranch);
        const pullRes = await git({output: true}).pull();
        // Go back to current work branch
        await git({output: true}).checkout(localBranch);
        // Merge into current branch if necessary
        if (pullRes.summary.changes > 0) {
            // Create new commit from merge
            uxLog(this, c.cyan(`Creating a merge commit of ${c.green(config.developmentBranch)} within ${c.green(localBranch)}...`));
            let mergeSummary = await git({output: true}).merge([config.developmentBranch]);
            while(mergeSummary.failed) {
                const mergeResult = await prompts({
                    type: 'select',
                    name: 'value',
                    message: c.cyanBright('There are merge conflicts, please solve them, then select YES here. Otherwise, exit the script and call a developer for help :)'),
                    choices: [
                        { value: true, title: "If finished to merge conflicts"},
                        { value: false, title: "I can't merge conflicts, I give up for now"}
                    ]
                })
                if (mergeResult.value === false) {
                    uxLog(this, 'Refresh script stopped by user');
                    process.exit(0);
                }
                mergeSummary = await git({output: true}).merge(['--continue']);
            }
        } else {
            uxLog(this, c.cyan(`Local branch ${c.green(localBranch)} is already up to date with ${c.green(config.developmentBranch)}`));
        }
        // Restoring stash
        if (stashed) {
            uxLog(this, c.cyan(`Restoring stash into your local branch ${c.green(localBranch)}...`));
            await git({output: true}).stash(['pop']);
        }

        // Push new branch state to scratch org
        await forceSourcePush(this.org.getUsername(), this.debugMode);

        // Return an object to be displayed with --json
        return { outputString: 'Refreshed the task' };
    }
}
