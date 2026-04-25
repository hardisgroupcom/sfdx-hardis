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

export default class ActionReorder extends SfCommand<any> {
  public static title = 'Reorder deployment actions';

  public static description = `
## Command Behavior

**Reorders deployment actions in the project configuration.**

Supports two modes:

1. **Single move**: Move one action to a new position using \`--action-id\` and \`--position\`.
2. **Full reorder**: Provide the complete ordered list of action IDs using \`--order\` to rearrange all actions in a single call.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
# Single move
sf hardis:project:action:reorder --agent --scope branch --when pre-deploy --action-id <uuid> --position 1

# Full reorder
sf hardis:project:action:reorder --agent --scope branch --when pre-deploy --order "id1,id2,id3"
\`\`\`

Required in agent mode:

- \`--scope\`, \`--when\`
- Either \`--action-id\` + \`--position\`, or \`--order\`

<details markdown="1">
<summary>Technical explanations</summary>

- For single move: removes the action from its current position and inserts at the new position (1-based, clamped to valid range).
- For full reorder: validates that the provided IDs match exactly the existing action IDs, then reorders.
</details>
`;

  public static examples = [
    '$ sf hardis:project:action:reorder',
    '$ sf hardis:project:action:reorder --agent --scope branch --when pre-deploy --action-id abc-123 --position 1',
    '$ sf hardis:project:action:reorder --agent --scope branch --when pre-deploy --order "id1,id2,id3"',
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
      description: 'ID of the action to move (single move mode)',
    }),
    position: Flags.integer({
      description: 'New 1-based position for the action (single move mode)',
    }),
    order: Flags.string({
      description: 'Comma-separated list of all action IDs in desired order (full reorder mode)',
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
    const { flags } = await this.parse(ActionReorder);
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

    // Read actions
    // Resolve PR ID if scope is pr
    const resolvedPrId = scope === 'pr' ? await resolvePrId(this, flags['pr-id'], agentMode) : flags['pr-id'];

    let actions = await readActions(scope, when, flags.branch, resolvedPrId);
    if (actions.length === 0) {
      throw new SfError(t('noActionsFound', { when, scope }));
    }

    // Determine mode: full reorder or single move
    if (flags.order) {
      actions = this.fullReorder(actions, flags.order);
    } else if (flags['action-id'] && flags.position != null) {
      actions = this.singleMove(actions, flags['action-id'], flags.position);
    } else if (agentMode || isCI) {
      throw new SfError(t('reorderMissingFlags'));
    } else {
      // Interactive mode: ask which mode
      const mode = await this.promptSelect(t('selectReorderMode'), [
        { title: t('reorderModeSingle'), value: 'single', description: t('reorderModeSingleDesc') },
        { title: t('reorderModeFull'), value: 'full', description: t('reorderModeFullDesc') },
      ]);

      if (mode === 'single') {
        // Show current order
        this.displayCurrentOrder(actions);

        const actionId = await this.promptSelect(t('selectActionToReorder'), actions.map(a => ({
          title: `${a.label} (${a.type})`,
          value: a.id,
          description: a.id,
        })));

        const posResponse = await prompts({
          type: 'number',
          name: 'value',
          message: c.cyanBright(t('selectNewPosition', { max: String(actions.length) })),
          initial: 1,
          description: t('selectNewPosition', { max: String(actions.length) }),
        });

        actions = this.singleMove(actions, actionId, posResponse.value);
      } else {
        // Full reorder: show current, ask for new order
        this.displayCurrentOrder(actions);

        const orderStr = await this.promptText(
          t('enterFullOrder'),
          actions.map(a => a.id).join(',')
        );
        actions = this.fullReorder(actions, orderStr);
      }
    }

    // Write back
    const configFile = await writeActions(scope, when, actions, flags.branch, resolvedPrId);

    uxLog("success", this, c.green(t('actionReorderedSuccessfully')));
    this.displayCurrentOrder(actions);
    uxLog("log", this, c.grey(t('actionSavedToFile', { file: configFile })));

    WebSocketClient.sendRefreshPipelineMessage();

    return { outputString: 'Actions reordered', actions: actions.map(a => ({ id: a.id, label: a.label })), configFile };
  }

  private singleMove(actions: any[], actionId: string, position: number): any[] {
    const { index } = findActionById(actions, actionId);
    const [action] = actions.splice(index, 1);
    // Clamp position to valid range (1-based)
    const insertAt = Math.max(0, Math.min(actions.length, position - 1));
    actions.splice(insertAt, 0, action);
    return actions;
  }

  private fullReorder(actions: any[], orderStr: string): any[] {
    const orderedIds = orderStr.split(',').map(id => id.trim()).filter(id => id);
    const existingIds = new Set(actions.map(a => a.id));
    const providedIds = new Set(orderedIds);

    // Check for missing IDs
    const missingIds = [...existingIds].filter(id => !providedIds.has(id));
    if (missingIds.length > 0) {
      throw new SfError(t('reorderMissingIds', { ids: missingIds.join(', ') }));
    }

    // Check for extra IDs
    const extraIds = orderedIds.filter(id => !existingIds.has(id));
    if (extraIds.length > 0) {
      throw new SfError(t('reorderExtraIds', { ids: extraIds.join(', ') }));
    }

    // Check for duplicates
    if (orderedIds.length !== providedIds.size) {
      throw new SfError(t('reorderDuplicateIds'));
    }

    // Reorder
    const actionMap = new Map(actions.map(a => [a.id, a]));
    return orderedIds.map(id => actionMap.get(id)!);
  }

  private displayCurrentOrder(actions: any[]): void {
    uxLog("log", this, c.grey(t('actionCurrentOrder')));
    actions.forEach((a, i) => {
      uxLog("log", this, c.grey(`  ${i + 1}. ${a.label} (${a.type}) [${a.id}]`));
    });
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

  private async promptText(message: string, initial: string): Promise<string> {
    const response = await prompts({
      type: 'text',
      name: 'value',
      message: c.cyanBright(message),
      initial,
      description: message,
    });
    return response.value || '';
  }
}
