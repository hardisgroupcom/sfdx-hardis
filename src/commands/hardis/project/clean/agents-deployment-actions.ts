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
} from '../../../../common/utils/agentUtils.js';
import { CONSTANTS } from '../../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CleanAgentsDeploymentActions extends SfCommand<any> {
  public static title = 'Add the deployment actions of Agentforce agents';

  public static description: string = `
## Command Behavior

**Writes in the sources what the deployment of Agentforce agents needs, before the Pull Request jobs run.**

A deployed agent version is inactive, and Salesforce refuses a deployment that holds the active version of an agent. [hardis:project:deploy:smart](${CONSTANTS.DOC_URL_ROOT}/hardis/project/deploy/smart/) never changes the package.xml or adds actions during the job: this cleaning records both in the project, so they show in the Pull Request.

- **Activation:** for each agent with an \`AiAgentDefinitionVersion\` changed in the User Story, an \`agent-activate\` post-deployment action of the Pull Request activates its latest version (\`agentVersion: latest\`). The label names the version of the project when the User Story was saved. When several Pull Requests are deployed together, their actions for the same agent are the same action and run once, so the order of the Pull Requests does not matter. An action that already activates this agent is updated.
- **Versions already in the target org:** \`AiAgentDefinitionVersion\` is added to \`manifest/package-no-overwrite.xml\` and to every file of \`packageNoOverwritePath\` in the project and branch configs, so only the new versions are deployed. Like for any item of package-no-overwrite.xml, a deployment that holds an agent version then lists the content of the target org, which can take a few minutes on a large org.
- **Automatic cleaning:** Add \`autoAddAgentsDeploymentActions\` to \`autoCleanTypes\` in \`.sfdx-hardis.yml\` to run it each time a User Story is saved with [hardis:work:save](${CONSTANTS.DOC_URL_ROOT}/hardis/work/save/).

See [Agentforce agents in CI/CD](${AGENT_DOC_URL}).

<details markdown="1">
<summary>Technical explanations</summary>

- **Changed agents:** with \`--delta-from <commit>\` (passed by hardis:work:save), the agents are the ones with a file under \`aiAgentDefinitionVersions/<Agent>#<n>/\` in \`git diff --name-only <commit>\` or not tracked yet. Without it, every agent of the project.
- **Version:** \`latest\`, the highest version of the target org after the deployment. The label shows the highest \`<n>\` of the \`aiAgentDefinitionVersions\` folders of the agent at save time, in English, as it is committed.
- **Actions file:** the Pull Request of the current branch is found with the git provider (\`scripts/actions/.sfdx-hardis.<id>.yml\`), else the actions go to \`scripts/actions/.sfdx-hardis.draft.yml\`, to link with [hardis:project:action:link-pull-request](${CONSTANTS.DOC_URL_ROOT}/hardis/project/action/link-pull-request/).
- **Action:** type \`agent-activate\`, context \`process-deployment-only\`, \`runOnlyOnceByOrg: false\` (an active version is left as it is).
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
      description: 'Git commit or ref the User Story starts from: only the agents changed since are handled (default: every agent of the project)',
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
    const deltaFrom: string | null = flags['delta-from'] || null;
    const agentNames = deltaFrom ? await listAgentsChangedSince(deltaFrom) : null;
    const versions = agentNames && agentNames.length === 0 ? [] : await listLocalAgentLatestVersions(agentNames);
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
    const actions = await readActions('pr', 'post-deploy', undefined, prId);
    for (const { agentName, version } of versions) {
      upsertAgentActivateAction(actions, agentName, version, randomUUID);
    }
    const actionsFile = await writeActions('pr', 'post-deploy', actions, undefined, prId);
    for (const { agentName, version } of versions) {
      uxLog("action", this, c.cyan(t('agentActivateActionWritten', { agentName: c.bold(agentName), version, file: actionsFile })));
    }
    return { outputString: `Agent activation written in ${actionsFile}`, actions: versions };
  }
}
