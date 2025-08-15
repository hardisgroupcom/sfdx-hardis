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
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class GenerateGitDelta extends SfCommand<any> {
  public static title = 'Generate Git Delta';

  public static description = `
## Command Behavior

**Generates a \`package.xml\` and \`destructiveChanges.xml\` representing the metadata differences between two Git commits.**

This command is a powerful tool for managing Salesforce metadata deployments by focusing only on the changes between specific points in your version control history. It leverages \`sfdx-git-delta\` to accurately identify added, modified, and deleted metadata components.

Key functionalities:

- **Commit-Based Comparison:** Allows you to specify a starting commit (\`--fromcommit\`) and an ending commit (\`--tocommit\`) to define the scope of the delta. If not provided, interactive prompts will guide you through selecting commits from your Git history.
- **Branch Selection:** You can specify a Git branch (\`--branch\`) to work with. If not provided, it will prompt you to select one.
- **\`package.xml\` Generation:** Creates a \`package.xml\` file that lists all metadata components that have been added or modified between the specified commits.
- **\`destructiveChanges.xml\` Generation:** Creates a \`destructiveChanges.xml\` file that lists all metadata components that have been deleted between the specified commits.
- **Temporary File Output:** The generated \`package.xml\` and \`destructiveChanges.xml\` files are placed in a temporary directory.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Git Integration:** Uses \`simple-git\` (\`git()\`) to interact with the Git repository, including fetching branches (\`git().fetch()\`), checking out branches (\`git().checkoutBranch()\`), and listing commit history (\`git().log()\`).
- **Interactive Prompts:** Leverages the \`prompts\` library to guide the user through selecting a Git branch and specific commits for delta generation if they are not provided as command-line arguments.
- **\`sfdx-git-delta\` Integration:** The core of the delta generation is handled by the \`callSfdxGitDelta\` utility function, which wraps the \`sfdx-git-delta\` tool. This tool performs the actual Git comparison and generates the \`package.xml\` and \`destructiveChanges.xml\` files.
- **Temporary Directory Management:** Uses \`createTempDir\` to create a temporary directory for storing the generated XML files, ensuring a clean working environment.
- **File System Operations:** Uses \`fs-extra\` to manage temporary files and directories.
- **User Feedback:** Provides clear messages to the user about the generated files and their locations.
</details>
`;

  public static examples = ['$ sf hardis:project:generate:gitdelta'];

  public static flags: any = {
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
    let pos = 0;
    const branchCommitsChoices = branchCommits.all.map((commit: any) => {
      commit.pos = pos;
      pos++;
      return {
        title: commit.message,
        description: `${commit.author_name} on ${new Date(commit.date).toLocaleString()}`,
        value: commit,
      };
    });

    // Prompt fromCommit
    let selectedFirstCommitLabel = "";
    let selectedFirstCommitPos = 0;
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
        description: 'Choose the starting commit for the delta generation',
        placeholder: 'Select a commit',
        choices: [headItem, ...branchCommitsChoices],
      });
      fromCommit = commitFromResp.value.hash;
      selectedFirstCommitLabel = commitFromResp.value.message;
      selectedFirstCommitPos = commitFromResp.value.pos;
    }

    // Prompt toCommit
    if (toCommit === null) {
      const currentItem = {
        title: 'current',
        description: `Local files not committed yet`,
        value: { hash: '*' },
      };
      const singleCommitChoice = {
        title: 'Single commit',
        description: `Only for ${selectedFirstCommitLabel}`,
        value: branchCommitsChoices[selectedFirstCommitPos + 1].value
      };
      const commitToResp = await prompts({
        type: 'select',
        name: 'value',
        message: 'Please select the commit hash that you want to go to',
        description: 'Choose the ending commit for the delta generation',
        placeholder: 'Select a commit',
        choices: [currentItem, singleCommitChoice, ...branchCommitsChoices],
      });
      toCommit = commitToResp.value.hash;
    }

    // Generate package.xml & destructiveChanges.xml using sfdx-git-delta
    uxLog("action", this, c.cyan(`Generating delta from commit ${c.bold(fromCommit)} to commit ${c.bold(toCommit)} on branch ${c.bold(gitBranch)}`));
    const tmpDir = await createTempDir();
    await callSfdxGitDelta(fromCommit || '', toCommit || '', tmpDir, { debug: this.debugMode });

    const diffPackageXml = path.join(tmpDir, 'package', 'package.xml');
    const diffDestructiveChangesXml = path.join(tmpDir, 'destructiveChanges', 'destructiveChanges.xml');

    uxLog("log", this, c.grey(`Generated diff package.xml at ${c.green(diffPackageXml)}`));
    uxLog("log", this, c.grey(`Generated diff destructiveChanges.xml at ${c.green(diffDestructiveChangesXml)}`));

    if (WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.sendReportFileMessage(diffPackageXml, 'Git Delta package.xml', "report");
      WebSocketClient.sendReportFileMessage(diffDestructiveChangesXml, 'Git Delta destructiveChanges.xml', "report");
    } else {
      WebSocketClient.requestOpenFile(diffPackageXml);
      WebSocketClient.requestOpenFile(diffDestructiveChangesXml);
    }

    // Return an object to be displayed with --json
    return {
      outputString: 'Generated package.xml',
      diffPackageXml: diffPackageXml,
      diffDestructiveChangesXml: diffDestructiveChangesXml,
    };
  }
}
