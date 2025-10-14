/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, selectGitBranch, uxLog } from '../../../../common/utils/index.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { GitProvider } from '../../../../common/gitProvider/index.js';
import moment from 'moment';
import { prompts } from '../../../../common/utils/prompts.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class GitPullRequestsExtract extends SfCommand<any> {
  public static title = 'Extract pull requests';

  public static description = `
## Command Behavior

**Extracts pull request information from your Git server based on specified filtering criteria.**

This command provides a powerful way to query and retrieve details about pull requests (or merge requests, depending on your Git provider) in your repository. It's highly useful for reporting, auditing, and analyzing development workflows.

Key functionalities include:

- **Target Branch Filtering:** You can filter pull requests by their target branch using the \`--target-branch\` flag. If not specified, the command will prompt you to select one.
- **Status Filtering:** Filter pull requests by their status: \`open\`, \`merged\`, or \`abandoned\` using the \`--status\` flag. An interactive prompt is provided if no status is specified.
- **Minimum Date Filtering:** Use the \`--min-date\` flag to retrieve pull requests created or updated after a specific date.
- **CSV Output:** The extracted pull request data is generated into a CSV file, which can be used for further analysis in spreadsheet software.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves interacting with a Git provider's API:

- **Git Provider Abstraction:** It uses the \`GitProvider.getInstance(true)\` to abstract away the specifics of different Git platforms (e.g., GitHub, GitLab, Azure DevOps). This ensures the command can work across various environments.
- **API Calls:** The \`gitProvider.listPullRequests()\` method is called with a \`prConstraint\` object that encapsulates the filtering criteria (target branch, minimum date, status).
- **Interactive Prompts:** The \`prompts\` library is used to interactively gather input from the user for the target branch and pull request status if they are not provided as command-line flags.
- **Date Handling:** The \`moment\` library is used to parse and handle date inputs for the \`--min-date\` flag.
- **CSV Generation:** The \`generateCsvFile\` utility is responsible for converting the retrieved pull request data into a CSV format, and \`generateReportPath\` determines the output file location.
- **Error Handling:** It includes error handling for cases where a Git provider cannot be identified.
</details>
`;

  public static examples = [
    '$ sf hardis:git:pull-requests:extract',
    '$ sf hardis:git:pull-requests:extract --target-branch main --status merged',
  ];

  public static flags: any = {
    "target-branch": Flags.string({
      char: 't',
      description: 'Target branch of PRs',
    }),
    "status": Flags.string({
      char: 'x',
      options: [
        "open",
        "merged",
        "abandoned"
      ],
      description: 'Status of the PR',
    }),
    "min-date": Flags.string({
      char: 'm',
      description: 'Minimum date for PR',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
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
    })
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected outputFile;
  protected outputFilesRes: any = {};
  protected pullRequests: any[];
  protected targetBranch: string | null = null;
  protected minDateStr: Date | null = null;
  protected minDate: Date | null = null;
  protected prStatus: string | null = null;
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(GitPullRequestsExtract);
    this.targetBranch = flags["target-branch"] || null;
    this.minDateStr = flags["min-date"] || null;
    this.prStatus = flags["status"] || null;
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;
    if (this.minDateStr) {
      this.minDate = moment(this.minDateStr).toDate()
    }

    // Startup
    uxLog("action", this, c.cyan(`This command will extract pull requests from the Git server.`));

    const gitProvider = await GitProvider.getInstance(true);
    if (gitProvider == null) {
      throw new SfError("Unable to identify a GitProvider")
    }

    // Prompt branch & PR status if not sent
    await this.handleUserInput();

    // Build constraint
    const prConstraint: any = {};
    if (this.targetBranch) {
      prConstraint.targetBranch = this.targetBranch;
    }
    if (this.minDate) {
      prConstraint.minDate = this.minDate;
    }
    if (this.prStatus) {
      prConstraint.pullRequestStatus = this.prStatus;
    }

    // Process call to git provider API
    this.pullRequests = await gitProvider.listPullRequests(prConstraint, { formatted: true });

    this.outputFile = await generateReportPath('pull-requests', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.pullRequests, this.outputFile, { fileTitle: 'Pull Requests' });

    return {
      outputString: `Extracted ${this.pullRequests.length} Pull Requests`,
      pullRequests: this.pullRequests,
    };
  }

  private async handleUserInput() {
    if (!isCI && !this.targetBranch) {
      const gitBranch = await selectGitBranch({
        remote: true,
        checkOutPull: false,
        allowAll: true,
        message: "Please select the target branch of Pull Requests"
      });
      if (gitBranch && gitBranch !== "ALL BRANCHES") {
        this.targetBranch = gitBranch;
      }
    }

    if (!isCI && !this.prStatus) {
      const statusRes = await prompts({
        message: "Please select a status criterion, or All.",
        type: "select",
        description: "Choose which pull request status to filter by.",
        placeholder: "Select status",
        choices: [
          { title: "All status", value: "all" },
          { title: "Merged", value: "merged" },
          { title: "Open", value: "open" },
          { title: "Abandoned", value: "abandoned" }
        ]
      });
      if (statusRes && statusRes.value !== "all") {
        this.prStatus = statusRes.value;
      }
    }
  }
}
