/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import { execCommand, getCurrentGitBranch, git, uxLog } from '../../../../common/utils';
import { getConfig } from '../../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class RefreshTask extends SfdxCommand {

    public static title = 'Refresb work task';

    public static description = messages.getMessage('refreshWorkTask');

    public static examples = [
        '$ sfdx hardis:work:task:refresh'
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
        this.debugMode = this.flags.debug || false;
        const config = await getConfig('project');
        const localBranch = await getCurrentGitBranch();
        uxLog(this, c.cyan(`This script will refresh your local branch ${c.green(localBranch)} and your local scratch org ${c.green(this.org.getUsername())} with the latest state of ${c.green(config.developmentBranch)}`));

        uxLog(this, c.cyan(`Pulling sources from scratch org ${this.org.getUsername()}...`));
        const pullCommand = 'sfdx force:source:pull -w 60 --forceoverwrite';
        await execCommand(pullCommand, this, { output: true, fail: true });

        // Stash
        uxLog(this, c.cyan(`Stash your local updates before merging ${c.green(config.developmentBranch)} into your local branch ${c.green(localBranch)}...`));
        await git.stash();

        // Pull most recent version of development branch
        uxLog(this, c.cyan(`Retrieving most recent version of remote branch ${config.developmentBranch}...`));
        await git.fetch();
        await git.checkout(config.developmentBranch);
        await git.pull();
        // Merge into current branch
        // Create new commit from merge
        uxLog(this, c.cyan(`Creating a merge commit within ${localBranch}...`));
        await git.mergeFromTo(config.developmentBranch, localBranch)
            .add('./*')
            .commit(`[sfdx-hardis] Merge from ${config.developmentBranch}`);
        uxLog(this, c.cyan(`Restoring stash into your local branch ${c.green(localBranch)}...`));
        await git.checkout(localBranch);
        await git.stash(['pop']);

        // Return an object to be displayed with --json
        return { outputString: 'Refreshed the task' };
    }
}
