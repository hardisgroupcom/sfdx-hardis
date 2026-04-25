/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { t } from '../../../../common/utils/i18n.js';
import {
  ActionScope,
  ActionWhen,
  findActionById,
  readActions,
  resolvePrId,
  writeActions,
} from '../../../../common/utils/actionUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionDelete extends SfCommand<any> {
  public static title = 'Delete deployment action';

  public static description = `
## Command Behavior

**Deletes an existing deployment action from the project configuration.**

Removes a single action identified by its ID from the specified scope and deployment phase.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:delete --agent --scope branch --when pre-deploy --action-id <uuid>
\`\`\`

Required in agent mode:

- \`--scope\`, \`--when\`, \`--action-id\`

<details markdown="1">
<summary>Technical explanations</summary>

- Reads the action list from the YAML config file, removes the matching action, and writes the file back.
</details>
`;

  public static examples = [
    '$ sf hardis:project:action:delete',
    '$ sf hardis:project:action:delete --agent --scope branch --when pre-deploy --action-id abc-123',
  ];

  public static flags: any = {
    scope: Flags.string({
      options: ['project', 'branch', 'pr'],
      description: 'Configuration scope: project, branch, or pr',
    }),
    when: Flags.string({
      options: ['pre-deploy', 'post-deploy'],
      description: 'When to run the action: pre-deploy or post-deploy',
    }),
    'action-id': Flags.string({
      description: 'ID of the action to delete',
    }),
    branch: Flags.string({
      description: 'Target branch name (for branch scope, defaults to current branch)',
    }),
    'pr-id': Flags.string({
      description: 'Pull request ID (for pr scope, defaults to draft)',
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
  };

  public static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ActionDelete);
    const agentMode = flags.agent === true;

    // Collect scope
    const scope: ActionScope = agentMode || isCI
      ? this.requireFlag(flags.scope, 'scope') as ActionScope
      : flags.scope || await this.promptSelect(t('selectActionScope'), [
        { title: t('actionScopeProject'), value: 'project' },
        { title: t('actionScopeBranch'), value: 'branch' },
        { title: t('actionScopePr'), value: 'pr' },
      ]);

    // Collect when
    const when: ActionWhen = agentMode || isCI
      ? this.requireFlag(flags.when, 'when') as ActionWhen
      : flags.when || await this.promptSelect(t('selectActionWhen'), [
        { title: t('actionWhenPreDeploy'), value: 'pre-deploy' },
        { title: t('actionWhenPostDeploy'), value: 'post-deploy' },
      ]);

    // Resolve PR ID if scope is pr
    const resolvedPrId = scope === 'pr' ? await resolvePrId(this, flags['pr-id'], agentMode) : flags['pr-id'];

    // Read actions
    const actions = await readActions(scope, when, flags.branch, resolvedPrId);
    if (actions.length === 0) {
      throw new SfError(t('noActionsFound', { when, scope }));
    }

    // Select action
    let actionId: string;
    if (agentMode || isCI) {
      actionId = this.requireFlag(flags['action-id'], 'action-id');
    } else if (flags['action-id']) {
      actionId = flags['action-id'];
    } else {
      actionId = await this.promptSelect(t('selectActionToDelete'), actions.map(a => ({
        title: `${a.label} (${a.type})`,
        value: a.id,
        description: a.id,
      })));
    }

    const { action, index } = findActionById(actions, actionId);
    const deletedLabel = action.label;

    // Remove action
    actions.splice(index, 1);
    const configFile = await writeActions(scope, when, actions, flags.branch, resolvedPrId);

    uxLog("success", this, c.green(t('actionDeletedSuccessfully', { label: deletedLabel })));
    uxLog("log", this, c.grey(t('actionSavedToFile', { file: configFile })));

    WebSocketClient.sendRefreshPipelineMessage();

    return { outputString: 'Action deleted', deletedLabel, configFile };
  }

  private requireFlag(value: any, flagName: string): string {
    if (!value) {
      throw new SfError(t('missingRequiredFlag', { flag: flagName }));
    }
    return value;
  }

  private async promptSelect(message: string, choices: any[]): Promise<any> {
    const response = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(message),
      choices,
      description: message,
    });
    return response.value;
  }
}
