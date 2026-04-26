import { Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { randomUUID } from 'crypto';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { ActionCommandBase } from './base.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { t } from '../../../../common/utils/i18n.js';
import {
  ACTION_CONTEXTS,
  ACTION_TYPES,
  ActionScope,
  ActionWhen,
  buildAction,
  logActionSummary,
  readActions,
  resolvePrId,
  validateActionParameters,
  writeActions,
} from '../../../../common/utils/actionUtils.js';
import { PrePostCommand } from '../../../../common/actionsProvider/actionsProvider.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionCreate extends ActionCommandBase {
  public static title = 'Create deployment action';

  public static description = `
## Command Behavior

**Creates a new deployment action in the project configuration.**

Deployment actions are pre- or post-deployment steps that run automatically during CI/CD pipelines. This command lets you define new actions of various types (shell command, data import, Apex script, community publish, manual instructions, or batch scheduling) and store them at project, branch, or pull request scope.

New actions are appended to the end of the action list. Use \`hardis:project:action:reorder\` to change position.

The action ID is auto-generated using UUID.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:create --agent --scope branch --when pre-deploy --type command --label "Disable triggers" --command "sf data update record --sobject User --where \\"Name='Admin'\\" --values \\"TriggerEnabled__c=false\\""
\`\`\`

Required in agent mode:

- \`--scope\`, \`--when\`, \`--type\`, \`--label\`
- Type-specific flags: \`--command\` for command, \`--apex-script\` for apex, \`--sfdmu-project\` for data, \`--community-name\` for publish-community, \`--instructions\` for manual, \`--class-name\` and \`--cron-expression\` for schedule-batch

In agent mode, \`--context\` defaults to \`all\`. \`--run-only-once-by-org\` defaults to \`true\`; other optional boolean flags default to \`false\`.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads and writes YAML config files using \`js-yaml\` and \`fs-extra\`.
- Validates that referenced files (Apex scripts) and workspaces (SFDMU projects) exist before saving.
- Generates action ID with \`crypto.randomUUID()\`.
- Supports three config scopes: project (\`config/.sfdx-hardis.yml\`), branch (\`config/branches/.sfdx-hardis.<branch>.yml\`), PR (\`scripts/actions/.sfdx-hardis.<prId>.yml\`).
</details>
`;

  public static examples = [
    '$ sf hardis:project:action:create',
    '$ sf hardis:project:action:create --agent --scope branch --when pre-deploy --type command --label "Disable triggers" --command "sf apex run --file scripts/disable-triggers.apex"',
    '$ sf hardis:project:action:create --agent --scope pr --pr-id 123 --when post-deploy --type data --label "Import test data" --sfdmu-project TestData',
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
    type: Flags.string({
      options: ['command', 'data', 'apex', 'publish-community', 'manual', 'schedule-batch'],
      description: 'Type of action',
    }),
    label: Flags.string({
      description: 'Human-readable label for the action',
    }),
    branch: Flags.string({
      description: 'Target branch name (for branch scope, defaults to current branch)',
    }),
    'pr-id': Flags.string({
      description: 'Pull request ID (for pr scope, defaults to draft)',
    }),
    command: Flags.string({
      description: 'Shell command to execute (for command type)',
    }),
    'apex-script': Flags.string({
      description: 'Path to Apex script file (for apex type)',
    }),
    'sfdmu-project': Flags.string({
      description: 'SFDMU workspace name (for data type)',
    }),
    'community-name': Flags.string({
      description: 'Community name (for publish-community type)',
    }),
    instructions: Flags.string({
      description: 'Manual instructions text (for manual type)',
    }),
    'class-name': Flags.string({
      description: 'Apex batch class name (for schedule-batch type)',
    }),
    'cron-expression': Flags.string({
      description: 'Cron expression (for schedule-batch type)',
    }),
    'job-name': Flags.string({
      description: 'Job name for schedule-batch (optional, defaults to <className>_Schedule)',
    }),
    context: Flags.string({
      options: ['all', 'check-deployment-only', 'process-deployment-only'],
      description: 'Execution context (default: all)',
    }),
    'skip-if-error': Flags.boolean({
      default: false,
      description: 'Skip action if deployment failed',
    }),
    'allow-failure': Flags.boolean({
      default: false,
      description: 'Allow action to fail without blocking deployment',
    }),
    'run-only-once-by-org': Flags.boolean({
      default: false,
      description: 'Execute action only once per target org',
    }),
    'custom-username': Flags.string({
      description: 'Run action with a specific Salesforce username',
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

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ActionCreate);
    const agentMode = flags.agent === true;

    // Collect scope
    const scope: ActionScope = agentMode || isCI
      ? this.requireFlag(flags.scope, 'scope') as ActionScope
      : flags.scope || await this.promptScope();

    // Collect when
    const when: ActionWhen = agentMode || isCI
      ? this.requireFlag(flags.when, 'when') as ActionWhen
      : flags.when || await this.promptWhen();

    // Collect type
    const type: PrePostCommand['type'] = agentMode || isCI
      ? this.requireFlag(flags.type, 'type') as PrePostCommand['type']
      : flags.type || await this.promptType();

    // Collect label
    const label: string = agentMode || isCI
      ? this.requireFlag(flags.label, 'label')
      : flags.label || await this.promptText(t('enterActionLabel'), '');

    // Collect type-specific parameters
    const parameters: Record<string, any> = {};
    let command = '';

    if (type === 'command') {
      command = agentMode || isCI
        ? this.requireFlag(flags.command, 'command')
        : flags.command || await this.promptText(t('enterCommand'), '');
    } else if (type === 'apex') {
      parameters.apexScript = agentMode || isCI
        ? this.requireFlag(flags['apex-script'], 'apex-script')
        : flags['apex-script'] || await this.promptText(t('enterApexScriptPath'), '');
    } else if (type === 'data') {
      parameters.sfdmuProject = agentMode || isCI
        ? this.requireFlag(flags['sfdmu-project'], 'sfdmu-project')
        : flags['sfdmu-project'] || await this.promptText(t('enterSfdmuProject'), '');
    } else if (type === 'publish-community') {
      parameters.communityName = agentMode || isCI
        ? this.requireFlag(flags['community-name'], 'community-name')
        : flags['community-name'] || await this.promptText(t('enterCommunityName'), '');
    } else if (type === 'manual') {
      parameters.instructions = agentMode || isCI
        ? this.requireFlag(flags.instructions, 'instructions')
        : flags.instructions || await this.promptText(t('enterInstructions'), '');
    } else if (type === 'schedule-batch') {
      parameters.className = agentMode || isCI
        ? this.requireFlag(flags['class-name'], 'class-name')
        : flags['class-name'] || await this.promptText(t('enterClassName'), '');
      parameters.cronExpression = agentMode || isCI
        ? this.requireFlag(flags['cron-expression'], 'cron-expression')
        : flags['cron-expression'] || await this.promptText(t('enterCronExpression'), '');
      if (flags['job-name']) {
        parameters.jobName = flags['job-name'];
      } else if (!agentMode && !isCI) {
        const jobName = await this.promptText(t('enterJobName'), '');
        if (jobName) {
          parameters.jobName = jobName;
        }
      }
    }

    // Collect context
    const context = (flags.context || (!agentMode && !isCI ? await this.promptContext() : 'all')) as PrePostCommand['context'];

    // Collect optional flags (only prompt in interactive mode)
    let skipIfError = flags['skip-if-error'];
    let allowFailure = flags['allow-failure'];
    let runOnlyOnceByOrg = flags['run-only-once-by-org'];
    let customUsername = flags['custom-username'] || '';

    if (!agentMode && !isCI) {
      if (!flags['skip-if-error']) {
        skipIfError = await this.promptConfirm(t('actionPromptSkipIfError'));
      }
      if (!flags['allow-failure']) {
        allowFailure = await this.promptConfirm(t('actionPromptAllowFailure'));
      }
      if (!flags['run-only-once-by-org']) {
        runOnlyOnceByOrg = await this.promptConfirm(t('actionPromptRunOnlyOnceByOrg'));
      }
      if (!flags['custom-username']) {
        customUsername = await this.promptText(t('actionPromptCustomUsername'), '');
      }
    }

    // Build the action
    const action = buildAction({
      id: randomUUID(),
      label,
      type,
      command,
      context,
      skipIfError,
      allowFailure,
      runOnlyOnceByOrg,
      customUsername,
      parameters,
    });

    // Validate parameters
    const validationErrors = await validateActionParameters(action);
    if (validationErrors.length > 0) {
      throw new SfError(t('actionValidationErrors', { errors: validationErrors.join('\n') }));
    }

    // Resolve PR ID if scope is pr
    const resolvedPrId = scope === 'pr' ? await resolvePrId(this, flags['pr-id'], agentMode) : flags['pr-id'];

    // Read existing actions, append, and write back
    const actions = await readActions(scope, when, flags.branch, resolvedPrId);
    actions.push(action);
    const configFile = await writeActions(scope, when, actions, flags.branch, resolvedPrId);

    uxLog("success", this, c.green(t('actionCreatedSuccessfully', { label: action.label, id: action.id })));
    logActionSummary(this, action);
    uxLog("log", this, c.grey(t('actionSavedToFile', { file: configFile })));

    WebSocketClient.sendRefreshPipelineMessage();

    return { outputString: 'Action created', action: action as any, configFile };
  }

  private async promptScope(): Promise<ActionScope> {
    const response = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(t('selectActionScope')),
      choices: [
        { title: t('actionScopeProject'), value: 'project', description: t('actionScopeProjectDesc') },
        { title: t('actionScopeBranch'), value: 'branch', description: t('actionScopeBranchDesc') },
        { title: t('actionScopePr'), value: 'pr', description: t('actionScopePrDesc') },
      ],
      description: t('selectActionScope'),
    });
    return response.value as ActionScope;
  }

  private async promptWhen(): Promise<ActionWhen> {
    const response = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(t('selectActionWhen')),
      choices: [
        { title: t('actionWhenPreDeploy'), value: 'pre-deploy' },
        { title: t('actionWhenPostDeploy'), value: 'post-deploy' },
      ],
      description: t('selectActionWhen'),
    });
    return response.value as ActionWhen;
  }

  private async promptType(): Promise<PrePostCommand['type']> {
    const response = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(t('selectActionType')),
      choices: ACTION_TYPES.map(t2 => ({ title: t2, value: t2 })),
      description: t('selectActionType'),
    });
    return response.value as PrePostCommand['type'];
  }

  private async promptContext(): Promise<PrePostCommand['context']> {
    const response = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(t('selectActionContext')),
      choices: ACTION_CONTEXTS.map(ctx => ({ title: ctx, value: ctx })),
      description: t('selectActionContext'),
    });
    return response.value as PrePostCommand['context'];
  }
}
