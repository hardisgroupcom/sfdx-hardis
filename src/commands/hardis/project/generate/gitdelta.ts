/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
import {
  createTempDir,
  ensureGitRepository,
  git,
  gitCheckOutRemote,
  selectGitBranch,
  uxLog,
} from '../../../../common/utils/index.js';
import { callSfdxGitDelta } from '../../../../common/utils/gitUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-template-sf-external', 'org');

export default class GenerateGitDelta extends SfCommand<any> {
  public static title = 'Generate Git Delta';

  public static description = 'Generate package.xml git delta between 2 commits';

  public static examples = ['$ sf hardis:project:generate:gitdelta'];

  public static flags = {
    branch: Flags.string({
      description: 'Git branch to use to generate delta',
    }),
    fromcommit: Flags.string({
      description: 'Hash of commit to start from',
    }),
    tocommit: Flags.string({
      description: 'Hash of commit to stop at',
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
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(GenerateGitDelta);
    let gitBranch = flags.branch || null;
    let fromCommit = flags.fromcommit || null;
    let toCommit = flags.fromcommit || null;
    this.debugMode = flags.debug || false;
    // Check git repo
    await ensureGitRepository();

    // Select git branch
    if (gitBranch === null) {
      gitBranch = await selectGitBranch({ remote: true, checkOutPull: true });
    } else {
      await gitCheckOutRemote(gitBranch);
    }

    // List branch commits
    const branchCommits = await git().log(['--first-parent']);
    const branchCommitsChoices = branchCommits.all.map((commit) => {
      return {
        title: commit.message,
        description: `${commit.author_name} on ${new Date(commit.date).toLocaleString()}`,
        value: commit,
      };
    });

    // Prompt fromCommit
    if (fromCommit === null) {
      const headItem = {
        title: 'HEAD',
        description: `Current git HEAD`,
        value: { hash: 'HEAD' },
      };
      const commitFromResp = await prompts({
        type: 'select',
        name: 'value',
        message: 'Please select the commit that you want to start from',
        choices: [headItem, ...branchCommitsChoices],
      });
      fromCommit = commitFromResp.value.hash;
    }

    // Prompt toCommit
    if (toCommit === null) {
      const currentItem = {
        title: 'current',
        description: `Local files not committed yet`,
        value: { hash: '*' },
      };
      const commitToResp = await prompts({
        type: 'select',
        name: 'value',
        message: 'Please select the commit hash that you want to go to',
        choices: [currentItem, ...branchCommitsChoices],
      });
      toCommit = commitToResp.value.hash;
    }

    // Generate package.xml & destructiveChanges.xml using sfdx-git-delta
    const tmpDir = await createTempDir();
    await callSfdxGitDelta(fromCommit || '', toCommit || '', tmpDir, { debug: this.debugMode });

    const diffPackageXml = path.join(tmpDir, 'package', 'package.xml');
    const diffDestructiveChangesXml = path.join(tmpDir, 'destructiveChanges', 'destructiveChanges.xml');

    uxLog(this, c.cyan(`Generated diff package.xml at ${c.green(diffPackageXml)}`));
    uxLog(this, c.cyan(`Generated diff destructiveChanges.xml at ${c.green(diffDestructiveChangesXml)}`));

    // Return an object to be displayed with --json
    return {
      outputString: 'Generated package.xml',
      diffPackageXml: diffPackageXml,
      diffDestructiveChangesXml: diffDestructiveChangesXml,
    };
  }
}
