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

  public static description = `Extract pull requests with filtering criteria`;

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
    uxLog(this, c.cyan(`This command will extract pull request from Git Server`));

    const gitProvider = await GitProvider.getInstance(true);
    if (gitProvider == null) {
      throw new SfError("Unable to identifer a GitProvider")
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
    this.outputFilesRes = await generateCsvFile(this.pullRequests, this.outputFile);

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
        message: "Please select the target branch of PUll Requests"
      });
      if (gitBranch && gitBranch !== "ALL BRANCHES") {
        this.targetBranch = gitBranch;
      }
    }

    if (!isCI && !this.prStatus) {
      const statusRes = await prompts({
        message: "Please select a status criteria, or all",
        type: "select",
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
