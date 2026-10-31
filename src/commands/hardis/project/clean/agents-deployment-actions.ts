/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { randomUUID } from 'crypto';
import { uxLog } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { readActions, resolvePrId, writeActions } from '../../../../common/utils/actionUtils.js';
import {
  AGENT_DOC_URL,
  ensureAgentVersionsInPackageNoOverwrite,
  listAgentsChangedSince,
  listLocalAgentLatestVersions,
  listPackageNoOverwriteFiles,
  upsertAgentActivateAction,
  upsertAgentRunningUserAction,
} from '../../../../common/utils/agentUtils.js';
import { listAgentsWithRunningUser } from '../../../../common/replacementRules/agentRunningUserBuiltInRule.js';
import { CONSTANTS } from '../../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CleanAgentsDeploymentActions extends SfCommand<any> {
  public static title = 'Add the deployment actions of Agentforce agents';

  public static description: string = `
## Command Behavior

**Writes in the sources what the deployment of Agentforce agents needs, before the Pull Request jobs run.**

A deployed agent version is inactive, and Salesforce refuses a deployment that holds the active version of an agent. [hardis:project:deploy:smart](${CONSTANTS.DOC_URL_ROOT}/hardis/project/deploy/smart/) never changes the package.xml or adds actions during the job: this cleaning records both in the project, so they show in the Pull Request.

- **Activation:** for each agent with an \`AiAgentDefinitionVersion\` changed in the User Story, an \`agent-activate\` post-deployment action of the Pull Request activates the version saved with the User Story (\`agentVersion: 3\`), so the Pull Request says what is activated. An action that already activates this agent is updated. An action set to \`latest\` by hand stays \`latest\`.
- **Running user:** for each of these agents that runs as a user (\`botUser\`, \`default_agent_user\`), an \`agent-running-user\` pre-deployment action creates that user with \`sf org create agent-user\` in an org that has none. It runs in the deployment checks too, so a check validates the agent with the user of the target org. The built-in replacement rule \`builtin-agent-running-user\` then writes the user in the deployed files, and never creates one.
- **Versions already in the target org:** \`AiAgentDefinitionVersion\` is added to \`manifest/package-no-overwrite.xml\` and to every file of \`packageNoOverwritePath\` in the project and branch configs, so only the new versions are deployed. Like for any item of package-no-overwrite.xml, a deployment that holds an agent version then lists the content of the target org, which can take a few minutes on a large org.
- **Automatic cleaning:** Add \`autoAddAgentsDeploymentActions\` to \`autoCleanTypes\` in \`.sfdx-hardis.yml\` to run it each time a User Story is saved with [hardis:work:save](${CONSTANTS.DOC_URL_ROOT}/hardis/work/save/).

See [Agentforce agents in CI/CD](${AGENT_DOC_URL}).

<details markdown="1">
<summary>Technical explanations</summary>

- **Changed agents:** the agents with a file under \`aiAgentDefinitionVersions/<Agent>#<n>/\` in \`git diff --name-only <commit>\` or not tracked yet. \`<commit>\` is \`--delta-from\` (passed by hardis:work:save), else \`HEAD\`: run by hand, the cleaning only handles the versions not committed yet.
- **Version:** the highest \`<n>\` of the \`aiAgentDefinitionVersions\` folders of the agent at save time. The label is in English, as it is committed.
- **Actions file:** the Pull Request of the current branch is found with the git provider (\`scripts/actions/.sfdx-hardis.<id>.yml\`), else the actions go to \`scripts/actions/.sfdx-hardis.draft.yml\`, to link with [hardis:project:action:link-pull-request](${CONSTANTS.DOC_URL_ROOT}/hardis/project/action/link-pull-request/).
- **Actions:** \`agent-activate\`, context \`process-deployment-only\`, and \`agent-running-user\`, context \`all\`, both with \`runOnlyOnceByOrg: false\`: an active version is left as it is, and an existing user is found again.
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
      description: 'Git commit or ref the User Story starts from: only the agents changed since are handled (default: HEAD, the versions not committed yet)',
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
    const versions = agentNames.length === 0 ? [] : await listLocalAgentLatestVersions(agentNames);
    if (versions.length === 0) {
      uxLog("log", this, c.grey(t('agentsDeploymentActionsNoAgentChanged')));
      return { outputString: 'No agent version changed', actions: [] };
    }

    for (const packageNoOverwrite of await listPackageNoOverwriteFiles()) {
      if (await ensureAgentVersionsInPackageNoOverwrite(packageNoOverwrite)) {
        uxLog("action", this, c.cyan(t('agentVersionsAddedToPackageNoOverwrite', { file: packageNoOverwrite })));
      }
    }

    const prId = await resolvePrId(this, 'current', true);
    const withRunningUser = new Set((await listAgentsWithRunningUser()).map((agent) => agent.agentName.toLowerCase()));
    const runningUserAgents = versions.filter(({ agentName }) => withRunningUser.has(agentName.toLowerCase()));
    if (runningUserAgents.length > 0) {
      const preDeployActions = await readActions('pr', 'pre-deploy', undefined, prId);
      for (const { agentName } of runningUserAgents) {
        upsertAgentRunningUserAction(preDeployActions, agentName, randomUUID);
      }
      const preDeployFile = await writeActions('pr', 'pre-deploy', preDeployActions, undefined, prId);
      for (const { agentName } of runningUserAgents) {
        uxLog("action", this, c.cyan(t('agentRunningUserActionWritten', { agentName: c.bold(agentName), file: preDeployFile })));
      }
    }

    const actions = await readActions('pr', 'post-deploy', undefined, prId);
    const written = versions.map(({ agentName, version }) => upsertAgentActivateAction(actions, agentName, version, randomUUID));
    const actionsFile = await writeActions('pr', 'post-deploy', actions, undefined, prId);
    for (const action of written) {
      uxLog("action", this, c.cyan(t('agentActivateActionWritten', { agentName: c.bold(action.parameters?.agentName), version: action.parameters?.agentVersion, file: actionsFile })));
    }
    return { outputString: `Agent activation written in ${actionsFile}`, actions: versions };
  }
}
