/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { t } from '../../../../common/utils/i18n.js';
import {
  ActionScope,
  ActionWhen,
  readActions,
  resolvePrId,
} from '../../../../common/utils/actionUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionList extends SfCommand<any> {
  public static title = 'List deployment actions';

  public static description = `
## Command Behavior

**Lists deployment actions defined in the project configuration.**

Displays a table of actions for the specified scope and deployment phase, showing position, ID, label, type, and context.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:list --agent --scope branch --when pre-deploy
\`\`\`

Required in agent mode:

- \`--scope\`, \`--when\`

<details markdown="1">
<summary>Technical explanations</summary>

- Reads the action list from the YAML config file and displays it as a formatted table.
- Supports \`--json\` output via SfCommand.
</details>
`;

  public static examples = [
    '$ sf hardis:project:action:list',
    '$ sf hardis:project:action:list --agent --scope branch --when pre-deploy',
    '$ sf hardis:project:action:list --scope project --when post-deploy --json',
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
    const { flags } = await this.parse(ActionList);
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

    uxLog("action", this, c.cyan(t('actionListHeader', { when, scope })));

    if (actions.length === 0) {
      uxLog("log", this, c.grey(t('noActionsFound', { when, scope })));
      return { outputString: 'No actions found', actions: [] };
    }

    // Build table data
    const tableData = actions.map((a, i) => ({
      '#': i + 1,
      Id: a.id,
      Label: a.label,
      Type: a.type || 'command',
      Context: a.context || 'all',
      'Skip If Error': a.skipIfError ? 'Yes' : 'No',
      'Allow Failure': a.allowFailure ? 'Yes' : 'No',
    }));

    uxLogTable(this, tableData, ['#', 'Id', 'Label', 'Type', 'Context', 'Skip If Error', 'Allow Failure']);

    return { outputString: `Found ${actions.length} actions`, actions: actions as any };
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
