/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as prompts from 'prompts';
import { execCommand, execSfdxJson, getCurrentGitBranch, git, interactiveGitAdd, uxLog } from '../../../common/utils';
import { getConfig, setConfig } from '../../../config';

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

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ['sfdx-essentials', 'sfdx-git-delta'];

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

    const gitUrl = await git().listRemote(['--get-url']);
    const currentGitBranch = await getCurrentGitBranch();
    await interactiveGitAdd();

    // Commit updates
    const gitStatus = await git().status();
    if (gitStatus.staged.length > 0) {
      // Request commit info
      const commitResponse = await prompts([
        {
          type: 'text',
          name: 'commitText',
          message: c.cyanBright('Please define a title describing what you did in the work task (50 chars max). Exemples "Update sharing rules configuration", "Create new webservice getAccount"...')
        }
      ]);
      uxLog(this, c.cyan(`Committing files in local git branch ${c.green(currentGitBranch)}...`));
      await git().commit(commitResponse.commitText || 'Updated by sfdx-hardis');
    }

    // Retrieving info about current branch latest commit and master branch latest commit
    const logResult = await git().log([`${config.developmentBranch}..${currentGitBranch}`]);
    const toCommit = logResult.latest;
    const mergeBaseCommand = `git merge-base ${config.developmentBranch} ${currentGitBranch}`;
    const mergeBaseCommandResult = await execCommand(mergeBaseCommand, this, { fail: true, debug: this.debugMode });
    const masterBranchLatestCommit = mergeBaseCommandResult.stdout.replace('\n', '').replace('\r', '');

    // Build package.xml delta between most recent commit and developpement
    uxLog(this, c.cyan(`Calculating package.xml diff from [${c.green(config.developmentBranch)}] to [${c.green(currentGitBranch)} - ${c.green(toCommit.message)}]`));
    const tmpDir = path.join(os.tmpdir(), 'sfdx-hardis-package-xml-') + Math.random().toString(36).slice(-5);
    await fs.ensureDir(tmpDir);
    const packageXmlCommand = `sfdx sgd:source:delta --from ${masterBranchLatestCommit} --to ${toCommit.hash} --output ${tmpDir}`;
    const packageXmlResult = await execSfdxJson(packageXmlCommand, this, { output: false, fail: false, debug: this.debugMode });
    if (packageXmlResult.status === 0) {
      // Upgrade local package.xml
      const localPackageXml = path.join('manifest', 'package.xml');
      const diffPackageXml = path.join(tmpDir, 'package', 'package.xml');
      const packageXmlDiffStr = await fs.readFile(diffPackageXml, 'utf8');
      uxLog(this, c.bold(c.cyan(`package.xml diff to be merged within ${c.green(localPackageXml)}:\n`)) + c.green(packageXmlDiffStr));
      const appendPackageXmlCommand = 'sfdx essentials:packagexml:append' +
        ` --packagexmls ${localPackageXml},${diffPackageXml}` +
        ` --outputfile ${localPackageXml}`;
      await execCommand(appendPackageXmlCommand, this, { fail: true, debug: this.debugMode });
      await git().add(localPackageXml);

      // Upgrade local destructivePackage.xml
      const localDestructiveChangesXml = path.join('manifest', 'destructiveChanges.xml');
      const diffDestructivePackageXml = path.join(tmpDir, 'destructiveChanges', 'destructiveChanges.xml');
      const destructivePackageXmlDiffStr = await fs.readFile(diffDestructivePackageXml, 'utf8');
      uxLog(this, c.bold(c.cyan(`destructiveChanges.xml diff to be merged within ${c.green(localDestructiveChangesXml)}:\n`)) + c.red(destructivePackageXmlDiffStr));
      const appendDestructivePackageXmlCommand = 'sfdx essentials:packagexml:append' +
        ` --packagexmls ${localDestructiveChangesXml},${diffDestructivePackageXml}` +
        ` --outputfile ${localDestructiveChangesXml}`;
      await execCommand(appendDestructivePackageXmlCommand, this, { fail: true, debug: this.debugMode });
      await git().add(localDestructiveChangesXml);
    } else {
      uxLog(this, `[error] ${c.grey(JSON.stringify(packageXmlResult))}`);
      uxLog(this, c.red(`Unable to build git diff. Please call a developer to ${c.yellow(c.bold('update package.xml and destructivePackage.xml manually'))}`));
    }

    // Commit updates
    const gitStatusWithConfig = await git().status();
    if (gitStatusWithConfig.staged.length > 0) {
      uxLog(this, `Committing files in local git branch ${c.green(currentGitBranch)}...`);
      await git().commit('[sfdx-hardis] Update package content');
    }

    // Push new commit(s)
    if (gitStatus.staged.length > 0 || gitStatusWithConfig.staged.length > 0) {
      const pushResponse = await prompts({
        type: 'confirm',
        name: 'push',
        default: true,
        message: c.cyanBright(`Do you want to save your updates your updates on server ? (git push in remote git branch ${c.green(currentGitBranch)})`)
      });
      if (pushResponse.push === true) {
        uxLog(this, c.cyan(`Pushing new commit(s) in remote git branch ${c.green(`origin/${currentGitBranch}`)}...`));
        const configUSer = await getConfig('user');
        if (configUSer.canForcePush === true) {
          // Force push if hardis:work:resetselection has been called before
          await git({ output: true }).push(['-u', 'origin', currentGitBranch, '--force']);
          await setConfig('user', { canForcePush: false });
        } else {
          await git({ output: true }).push(['-u', 'origin', currentGitBranch]);
        }
      }
    }

    // Merge request
    uxLog(this, c.cyan(`If your work is ${c.bold('completed')}, you can create a ${c.bold('merge request')}:`));
    uxLog(this, c.cyan(`- click on the link in the upper text, below ${c.italic('To create a merge request for ' + currentGitBranch + ', visit')}`));
    uxLog(this, c.cyan(`- or manually create the merge request on repository UI: ${c.green(gitUrl)}`));
    // const remote = await git().listRemote();
    // const remoteMergeRequest = `${remote.replace('.git','-/merge_requests/new')}`;
    // await open(remoteMergeRequest, {wait: true});

    // Return an object to be displayed with --json
    return { outputString: 'Saved the task' };
  }
}
