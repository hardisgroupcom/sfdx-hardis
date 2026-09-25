/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import fs from '../../../../common/utils/fsUtils.js';
import { getCurrentGitBranch, isCI } from '../../../../common/utils/index.js';
import { CONSTANTS, removeFromConfigFile, setInConfigFile } from '../../../../config/index.js';
import { t } from '../../../../common/utils/i18n.js';
import {
  logDeploymentRepositoryChange,
  MONITORING_CONFIG_FILE,
  readDeploymentRepository,
  resolveDeploymentRepositoryChange,
} from '../../../../common/monitoring/monitoringDeploymentRepository.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgConfigureMonitoringDeploymentRepository extends SfCommand<any> {
  public static title = 'Set the deployment repository of a monitored org';

  public static description = `
## Command Behavior

**Sets, or removes, the CI/CD repository that deploys to the org monitored by the current branch of a monitoring repository.**

In a monitoring repository, each branch monitors one org and has its own \`.sfdx-hardis.yml\` at the root. The \`deploymentRepository\` property of that file is the address of the sfdx-hardis CI/CD repository that deploys to the org: the mirror of \`monitoringRepository\` in the CI/CD repository.

The \`AGENTS.md\` file written by [the monitoring backup](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-metadata-backup/#ask-questions-with-a-coding-agent) then tells coding agents to search that repository, its branches and the pipeline logs of both repositories.

- Without flags, asks for the address. It suggests the current value, else the value set on another monitoring branch of the repository. Emptying the answer removes the current value.
- The address must be a git repository address: \`https://host/path\`, \`ssh://host/path\` or \`user@host:path\`.
- The rest of \`.sfdx-hardis.yml\` and its comments are kept as they are.

[hardis:org:configure:monitoring](${CONSTANTS.DOC_URL_ROOT}/hardis/org/configure/monitoring/) asks the same question while it configures a monitored org. This command changes the address alone. The Org Monitoring panel of VS Code runs it.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:configure:monitoring-deployment-repository --agent --repository https://github.com/my-company/my-project
sf hardis:org:configure:monitoring-deployment-repository --agent --clear
\`\`\`

In agent mode:

- \`--repository\` or \`--clear\` is required.
- No question is asked.

<details markdown="1">
<summary>Technical explanations</summary>

- Must run at the root of a monitoring repository, on the branch of the monitored org: it updates \`./.sfdx-hardis.yml\`, and fails when that file does not exist.
- The suggestion reads \`deploymentRepository\` in the \`.sfdx-hardis.yml\` of the other local and remote \`monitoring_*\` branches, with \`git show\`.
- The file is edited as a YAML document, so its comments are kept. A file that is not valid YAML is left untouched and the command fails.
- Nothing is committed: commit and push \`.sfdx-hardis.yml\` so that the next backup writes the address in \`AGENTS.md\`.
</details>
`;

  public static examples = [
    '$ sf hardis:org:configure:monitoring-deployment-repository',
    '$ sf hardis:org:configure:monitoring-deployment-repository --repository https://github.com/my-company/my-project',
    '$ sf hardis:org:configure:monitoring-deployment-repository --clear',
    '$ sf hardis:org:configure:monitoring-deployment-repository --agent --repository git@gitlab.com:my-group/my-project.git',
  ];

  public static flags: any = {
    repository: Flags.string({
      char: 'r',
      description: 'Address of the sfdx-hardis CI/CD repository that deploys to the monitored org',
    }),
    clear: Flags.boolean({
      default: false,
      description: 'Remove deploymentRepository from .sfdx-hardis.yml',
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

  public static requiresProject = false;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgConfigureMonitoringDeploymentRepository);
    const agentMode = flags.agent === true;
    if (!fs.existsSync(MONITORING_CONFIG_FILE)) {
      throw new SfError(t('deploymentRepositoryNotMonitoringRepo'));
    }
    if (agentMode && flags.repository === undefined && flags.clear !== true) {
      throw new SfError(t('deploymentRepositoryAgentModeNeedsValue'));
    }
    const previous = await readDeploymentRepository();
    const change = await resolveDeploymentRepositoryChange(this, {
      repository: flags.repository,
      clear: flags.clear,
      interactive: !isCI && !agentMode,
      currentBranch: (await getCurrentGitBranch()) || '',
    });
    logDeploymentRepositoryChange(this, change);
    if (change.action === 'set') {
      await setInConfigFile([], { deploymentRepository: change.value }, MONITORING_CONFIG_FILE);
    } else if (change.action === 'clear') {
      await removeFromConfigFile(MONITORING_CONFIG_FILE, ['deploymentRepository']);
    }
    const deploymentRepository = change.action === 'set' ? change.value : change.action === 'clear' ? null : previous;
    return { outputString: `deploymentRepository: ${deploymentRepository ?? '(none)'}`, deploymentRepository, previous, action: change.action };
  }
}
