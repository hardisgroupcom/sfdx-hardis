/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as prompts from 'prompts';
import { execCommand, getCurrentGitBranch, git, interactiveGitAdd, uxLog } from '../../../common/utils';
import { getConfig } from '../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class SaveTask extends SfdxCommand {

  public static title = 'Save work task';

  public static description = messages.getMessage('completeWorkTask');

  public static examples = [
    '$ sfdx hardis:work:task:save'
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

    uxLog(this, c.cyan(`This script will prepare the merge request from your local branch ${c.green(localBranch)} to remote ${c.green(config.developmentBranch)}`));
    uxLog(this, c.cyan(`Pulling sources from scratch org ${this.org.getUsername()}...`));
    const pullCommand = 'sfdx force:source:pull -w 60 --forceoverwrite';
    await execCommand(pullCommand, this, { output: true, fail: true });

    const currentgitBranch = await getCurrentGitBranch();
    const added = await interactiveGitAdd();

    // Commit / push
    if (added.length > 0) {
      // Request commit info
      const commitResponse = await prompts([
        {
          type: 'text',
          name: 'commitText',
          message: c.cyanBright('Please define a title describing what you did in the work task (50 chars max). Exemples "Update sharing rules configuration", "Create new webservice getAccount"...')
        }
      ]);

      uxLog(this, `Committing files in local git branch ${c.green(currentgitBranch)}...`);
      await git.commit(commitResponse.commitText || 'Updated by sfdx-hardis');

      // Push new commit
      const pushResponse = await prompts([
        {
          type: 'confirm',
          name: 'push',
          default: true,
          message: c.cyanBright(`Do you want to save your updates your updates on server ?(in remote git branch ${c.green(currentgitBranch)}) ?`)
        }
      ]);
      if (pushResponse.push === true) {
        uxLog(this, c.cyan(`Pushing new commit in remote git branch ${c.green(`origin/${currentgitBranch}`)}...`));
        await git.push(['-u', 'origin', currentgitBranch]);
      }
    }
    // Merge request
    const gitUrl = await git.listRemote(['--get-url']);
    uxLog(this, c.cyan(`If your work is ${c.bold('completed')}, you can create a ${c.bold('merge request')}:`));
    uxLog(this, c.cyan(`- click on the link in the upper text, below ${c.italic('To create a merge request for ' + currentgitBranch + ', visit')}`));
    uxLog(this, c.cyan(`- or manually create the merge request on repository UI: ${c.green(gitUrl)}`));
    // const remote = await git.listRemote();
    // const remoteMergeRequest = `${remote.replace('.git','-/merge_requests/new')}`;
    // await open(remoteMergeRequest, {wait: true});

    // Return an object to be displayed with --json
    return { outputString: 'Saved the task' };
  }
}
