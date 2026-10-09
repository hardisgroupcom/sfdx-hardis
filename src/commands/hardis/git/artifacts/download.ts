/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { uxLogTableWithReport } from '../../../../common/utils/filesUtils.js';
import { downloadJobArtifacts } from '../../../../common/utils/jobArtifactsUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class GitArtifactsDownload extends SfCommand<any> {
  public static title = 'Download job artifacts';

  public static description = `
## Command Behavior

**Downloads the files a CI job published as artifacts, and lists them.**

The validation, deployment and MegaLinter jobs keep their reports as artifacts on the CI server: the complete deployment result, the list of deployed components, the code coverage, the Flow diffs, the linter reports. This command brings them next to your sources, so you can open them like any local file.

- **Job URL:** \`--job-url\` is the link to the job, as written at the bottom of the Pull Request comment that reports it. Without it, the command asks for it.
- **Where the files go:** \`hardis-report/job-artifacts/<job>/\`. When the job published several artifacts, each one gets its own sub-folder.
- **Run twice:** nothing is downloaded again when the local copy is still the one the server holds. A job run again replaces its artifacts, and the command then replaces the local copy.
- **Expired artifacts:** the command says so. Files downloaded before they expired are kept and listed.
- **Providers:** GitHub, GitLab and Azure DevOps. Bitbucket has no API to download artifacts: open the job page instead.

The VS Code Pull Request view runs this command behind the **Files** button of its Validation, Code Quality and Deployment tabs.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:git:artifacts:download --agent --job-url https://github.com/my-org/my-repo/actions/runs/123456789 --json
\`\`\`

In agent mode:

- \`--job-url\` is required: the prompt asking for it is skipped.
- The result holds \`status\` (\`success\`, \`expired\`, \`none\` or \`unsupported\`), the absolute \`folder\`, the \`artifacts\` of the job and the \`files\` extracted, each with its path relative to the folder and its size.

<details markdown="1">
<summary>Technical explanations</summary>

- The git provider is found from the git remote and its token, like for every command that reads Pull Requests. The token needs to read CI jobs: \`Actions: Read\` on GitHub, \`api\` or \`read_api\` on GitLab, \`Build: Read\` on Azure DevOps.
- The run, job or build id is read from the URL. A URL that is not a job of the current repository is refused, so the token is never used for another repository or sent to another host.
- GitHub: \`GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts\`, then the zip of each artifact that has not expired. GitLab: \`GET /projects/{id}/jobs/{job_id}\`, then its artifacts archive. Azure DevOps: the Build API, \`getArtifacts\` then the zip of each artifact.
- Archives are extracted with \`adm-zip\`. An entry whose path would leave the target folder is skipped.
- A \`.job-artifacts.json\` manifest in the folder records the artifacts extracted, to skip a download that would bring the same files.
</details>

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.github.io) course runs this command, click by click, on an org of your own, in these labs:

- [Lab 1.6 - Open a Pull Request, pass the deployment check, merge](https://sfdx-hardis-training.github.io/en/level-1-contributor-basics/1-6-pull-request-deployment-check-and-merge/)
- [Lab 3.2 - Review and merge a contributor Pull Request](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-2-review-a-contributor-pull-request/)

<!-- training-links:end -->
`;

  public static examples = [
    '$ sf hardis:git:artifacts:download',
    '$ sf hardis:git:artifacts:download --job-url https://github.com/my-org/my-repo/actions/runs/123456789',
    '$ sf hardis:git:artifacts:download --agent --job-url https://gitlab.com/my-group/my-project/-/jobs/123456789 --json',
  ];

  public static flags: any = {
    'job-url': Flags.string({
      description: 'URL of the CI job, as written in the Pull Request comment that reports it',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
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

  public static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(GitArtifactsDownload);
    const agentMode = flags.agent === true;
    let jobUrl: string = (flags['job-url'] || '').trim();
    if (!jobUrl && !isCI && !agentMode) {
      const answer = await prompts({
        type: 'text',
        name: 'value',
        message: c.cyanBright(t('jobArtifactsPromptJobUrl')),
        description: t('jobArtifactsPromptJobUrlDescription'),
        placeholder: 'https://github.com/my-org/my-repo/actions/runs/123456789',
      });
      jobUrl = (answer.value || '').trim();
    }
    if (!jobUrl) {
      throw new SfError(t('jobArtifactsJobUrlRequired'));
    }

    uxLog("action", this, c.cyan(t('jobArtifactsDownloading', { jobUrl })));
    const result = await downloadJobArtifacts(jobUrl);
    if (result.status !== 'success') {
      uxLog("warning", this, c.yellow(result.message));
      return { outputString: result.message, ...result } as unknown as AnyJson;
    }
    uxLog("action", this, c.cyan(result.message));
    const rows = result.files.map((file) => ({ file: file.path, sizeKb: Math.ceil(file.sizeBytes / 1024) }));
    if (agentMode) {
      // No VS Code tab to truncate the table, and a panel asking for the files wants no report file
      uxLogTable(this, rows, ['file', 'sizeKb']);
    } else {
      await uxLogTableWithReport(this, rows, ['file', 'sizeKb'], { fileNamePrefix: 'job-artifacts-files' });
    }
    return { outputString: result.message, ...result } as unknown as AnyJson;
  }
}
