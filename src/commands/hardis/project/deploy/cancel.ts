/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { CONSTANTS } from '../../../../config/index.js';
import { cancelRunningDeploymentSimulation } from '../../../../common/utils/deployCancelUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DeployCancel extends SfCommand<any> {
  public static title = 'Cancel deployment simulation of a cancelled CI job';

  public static description = `
## Command Behavior

**Cancels in the Salesforce org the deployment simulation started by the current CI job, when this CI job is cancelled.**

When a CI job running [hardis:project:deploy:smart](${CONSTANTS.DOC_URL_ROOT}/hardis/project/deploy/smart/) with \`--check\` is cancelled (for example when a new commit is pushed on the Merge Request), killing the job does not stop the deployment simulation in the org. Salesforce keeps it running, and the next simulations on the same org wait for it.

Call this command from the cancellation hook of your CI job, after the job has been cancelled:

- GitLab: \`after_script\`, when \`CI_JOB_STATUS\` is \`canceled\`
- GitHub Actions: a step with \`if: cancelled()\`
- Azure Pipelines: a step with \`condition: canceled()\`
- Jenkins: \`post { unsuccessful }\` of the stage that runs the simulation

Bitbucket Pipelines runs no script when a step is stopped or times out, so a stopped simulation cannot be cancelled there.

The default sfdx-hardis CI/CD templates already do it.

Key behaviors:

- **Only the simulation of this CI job:** it never cancels the deployment of another Merge Request, even if both target the same org with the same user, as long as each CI job runs in its own container, as in the default templates. When several jobs run at the same time on the same host without a container (GitLab shell executor, self-hosted GitHub or Azure runners) and share the same home folder, a job can record and cancel the simulation of another one.
- **Simulations only:** a real deployment is never cancelled.
- **Never fails:** if there is nothing to cancel, or if the deployment is already completed, it logs the reason and exits with code 0, so it cannot make a CI job fail.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:deploy:cancel --agent
\`\`\`

This command has no interactive prompt: \`--agent\` changes nothing, it is accepted for consistency with other commands.

<details markdown="1">
<summary>Technical explanations</summary>

- **Job id recording:** in CI, while \`sf hardis:project:deploy:smart --check\` runs \`sf project deploy start --dry-run\`, it watches the Salesforce CLI deploy cache (\`~/.sf/deploy-cache.json\`) and writes the job id of the new simulation in \`.cache/sfdx-hardis/running-deployment-simulation.json\`, in the working tree. The file is deleted when the deploy command succeeds, and by this command once it has used it. It is kept after a failed deploy command: when a CI job is cancelled, some runners (GitLab) kill the deploy command first, so the failure can be the cancellation itself. If the simulation is already completed, this command logs it and does nothing.
- **Why the working tree:** with some CI executors (GitLab Docker executor), the cancellation hook runs in a new container where the home folder of the job, and its Salesforce CLI cache, are lost. The working tree is kept.
- **Cancellation:** runs \`sf project deploy cancel --job-id <id> --target-org <username> --async\`. On GitLab Docker executor, run \`sf hardis:auth:login\` before, as the authentication of the job is lost too.
- **Result:** returns \`status\` (\`canceled\`, \`nothing-to-cancel\`, \`already-completed\`, \`skipped-not-simulation\` or \`failed\`), \`jobId\` and \`targetUsername\`.
</details>
`;

  public static examples = ['$ sf hardis:project:deploy:cancel', '$ sf hardis:project:deploy:cancel --agent'];

  public static flags: any = {
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
  };

  public static requiresProject = false;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DeployCancel);
    const result = await cancelRunningDeploymentSimulation(this, { debug: flags.debug === true });
    return result as unknown as AnyJson;
  }
}
