/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as prompts from 'prompts';
import { MetadataUtils } from '../../../../common/metadata-utils';
import { checkGitClean, ensureGitBranch, execCommand, gitCheckOutRemote, uxLog } from '../../../../common/utils';
import { getConfig, setConfig } from '../../../../config';
import ScratchCreate from '../../scratch/create';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class NewTask extends SfdxCommand {

  public static title = 'New work task';

  public static description = messages.getMessage('newWorkTask');

  public static examples = [
    '$ sfdx hardis:work:task:new'
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    debug: flags.boolean({ char: 'd', default: false, description: messages.getMessage('debugMode') })
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debug || false;

    // Make sure the git status is clean, to not delete uncommited updates
    await checkGitClean({});

    const config = await getConfig('project');

    // Request info to build branch name. ex features/config/MYTASK
    const response = await prompts([
      {
        type: 'text',
        name: 'targetBranch',
        message: c.cyanBright('What will be the target branch of your new task ?'),
        initial: config.developmentBranch || 'developpement'
      },
      {
        type: 'select',
        name: 'branch',
        message: c.cyanBright('What is the type of the task you want to do ?'),
        initial: 0,
        choices: [
          { title: 'Feature', value: 'features' },
          { title: 'Debug', value: 'bugs' }
        ]
      },
      {
        type: 'select',
        name: 'sources',
        message: c.cyanBright('What type(s) of Salesforce updates will you have to perform for this task ?'),
        initial: 0,
        choices: [
          { title: 'Configuration', value: 'config' },
          { title: 'Development (Apex, Javascript...)', value: 'dev' },
          { title: 'Configuration + Development', value: 'dev' }
        ]
      }
    ]);

    const targetBranch = response.targetBranch || 'developpement';
    // Update config if necessary
    if (config.developmentBranch !== targetBranch) {
      await setConfig('project', { developmentBranch: targetBranch });
    }
    // Checkout development main branch
    const branchName = `${response.branch || 'features'}/${response.sources || 'dev'}`;
    uxLog(this, c.cyan(`Checking out the most recent version of branch ${c.bold(targetBranch)} on server...`));
    await gitCheckOutRemote(targetBranch);
    // Create new branch
    uxLog(this, c.cyan(`Creating new branch ${branchName}...`));
    await ensureGitBranch(branchName);

    // Select/Create scratch org
    const currentOrg = await MetadataUtils.getCurrentOrg('scratch');
    if (currentOrg == null) {
      const scratchOrgList = await MetadataUtils.listLocalOrgs('scratch');
      const scratchResponse = await prompts(
        {
          type: 'select',
          name: 'value',
          message: c.cyanBright('What is the type of the task you want to do ?'),
          initial: 0,
          choices: [...scratchOrgList.map((scratchOrg: any) => {
            return { title: `${scratchOrg.alias} - ${scratchOrg.instanceUrl}`, value: scratchOrg.alias };
          }), ...[{ title: 'Create new scratch org', value: 'newScratchOrg' }]]
        });
      if (scratchResponse.value === 'newScratchOrg') {
        await ScratchCreate.run();
      } else {
        await execCommand(`sfdx config:set defaultusername=${scratchResponse.username}`, this, {output: true, fail: true});
      }
    } else {
      uxLog(this, c.cyan(`You will use scratch org ${c.green(currentOrg.alias)} : ${c.green(currentOrg.instanceUrl)}`));
    }
    uxLog(this, c.cyan(`You are now ready to work in branch ${c.green(branchName)} :)`));
    // Return an object to be displayed with --json
    return { outputString: 'Created new task' };
  }
}
