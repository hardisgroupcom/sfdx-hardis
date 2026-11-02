/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { randomUUID } from 'crypto';
import { uxLog } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { readActions, resolvePrId, writeActions } from '../../../../common/utils/actionUtils.js';
import { AGENT_DOC_URL, listAgentsChangedSince, upsertAgentPublishAction, upsertAgentRunningUserAction } from '../../../../common/utils/agentUtils.js';
import { listAgentsWithRunningUser } from '../../../../common/replacementRules/agentRunningUserBuiltInRule.js';
import { CONSTANTS } from '../../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CleanAgentsDeploymentActions extends SfCommand<any> {
  public static title = 'Add the deployment actions of Agentforce agents';

  public static description: string = `
## Command Behavior

**Writes in the Pull Request the deployment actions that deliver Agentforce agents, before the Pull Request jobs run.**

The project holds the authoring bundle of each agent (\`aiAuthoringBundles/<Agent>/\`), not its versions: a version is created in each org when the bundle is published there. [hardis:project:deploy:smart](${CONSTANTS.DOC_URL_ROOT}/hardis/project/deploy/smart/) never adds actions during the job: this cleaning records them in the project, so they show in the Pull Request.

- **Publication:** for each agent whose bundle changed in the User Story, an \`agent-publish\` post-deployment action of the Pull Request publishes the bundle in the target org and activates the version it created. It runs once by org: each publication creates a new version, even when nothing changed.
- **Running user:** for each of these agents that runs as a user (\`default_agent_user\`), an \`agent-running-user\` pre-deployment action creates that user with \`sf org create agent-user\` in an org that has none. The built-in replacement rule \`builtin-agent-running-user\` then writes the user of the target org in the bundle while it is published, and never creates one.
- **Automatic cleaning:** Add \`autoAddAgentsDeploymentActions\` to \`autoCleanTypes\` in \`.sfdx-hardis.yml\` to run it each time a User Story is saved with [hardis:work:save](${CONSTANTS.DOC_URL_ROOT}/hardis/work/save/).

See [Agentforce agents in CI/CD](${AGENT_DOC_URL}).

<details markdown="1">
<summary>Technical explanations</summary>

- **Changed agents:** the agents with a file under \`aiAuthoringBundles/<Agent>/\` in \`git diff --name-only <commit>\` or not tracked yet. The bundles of versions (\`<Agent>_<n>\`) are ignored. \`<commit>\` is \`--delta-from\` (passed by hardis:work:save), else \`HEAD\`: run by hand, the cleaning only handles the changes not committed yet.
- **Actions file:** the Pull Request of the current branch is found with the git provider (\`scripts/actions/.sfdx-hardis.<id>.yml\`), else the actions go to \`scripts/actions/.sfdx-hardis.draft.yml\`, to link with [hardis:project:action:link-pull-request](${CONSTANTS.DOC_URL_ROOT}/hardis/project/action/link-pull-request/).
- **Actions:** \`agent-publish\`, context \`process-deployment-only\`, \`runOnlyOnceByOrg: true\`, and \`agent-running-user\`, context \`all\`, \`runOnlyOnceByOrg: false\`: an existing user is found again. An action already there for the agent is kept as it is. The labels are in English, as they are committed.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:clean:agents-deployment-actions --agent
\`\`\`

The command has no prompt: \`--agent\` only exists for consistency with the other cleanings.
`;

  public static examples = [
    '$ sf hardis:project:clean:agents-deployment-actions',
    '$ sf hardis:project:clean:agents-deployment-actions --delta-from origin/integration',
    '$ sf hardis:project:clean:agents-deployment-actions --agent',
  ];

  public static flags: any = {
    'delta-from': Flags.string({
      description: 'Git commit or ref the User Story starts from: only the agents changed since are handled (default: HEAD, the changes not committed yet)',
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

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanAgentsDeploymentActions);
    const agentNames = await listAgentsChangedSince(flags['delta-from'] || 'HEAD');
    if (agentNames.length === 0) {
      uxLog("log", this, c.grey(t('agentsDeploymentActionsNoAgentChanged')));
      return { outputString: 'No agent changed', actions: [] };
    }

    const prId = await resolvePrId(this, 'current', true);
    const withRunningUser = new Set((await listAgentsWithRunningUser()).map((agent) => agent.agentName.toLowerCase()));
    const runningUserAgents = agentNames.filter((agentName) => withRunningUser.has(agentName.toLowerCase()));
    if (runningUserAgents.length > 0) {
      const preDeployActions = await readActions('pr', 'pre-deploy', undefined, prId);
      for (const agentName of runningUserAgents) {
        upsertAgentRunningUserAction(preDeployActions, agentName, randomUUID);
      }
      const preDeployFile = await writeActions('pr', 'pre-deploy', preDeployActions, undefined, prId);
      for (const agentName of runningUserAgents) {
        uxLog("action", this, c.cyan(t('agentRunningUserActionWritten', { agentName: c.bold(agentName), file: preDeployFile })));
      }
    }

    const actions = await readActions('pr', 'post-deploy', undefined, prId);
    agentNames.forEach((agentName) => upsertAgentPublishAction(actions, agentName, randomUUID));
    const actionsFile = await writeActions('pr', 'post-deploy', actions, undefined, prId);
    for (const agentName of agentNames) {
      uxLog("action", this, c.cyan(t('agentPublishActionWritten', { agentName: c.bold(agentName), file: actionsFile })));
    }
    return { outputString: `Agent publication written in ${actionsFile}`, actions: agentNames.map((agentName) => ({ agentName })) };
  }
}
