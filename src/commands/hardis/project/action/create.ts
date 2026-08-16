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
  parseBranchListFlag,
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

Deployment actions are pre- or post-deployment steps that run automatically during CI/CD pipelines. This command lets you define new actions of various types (shell command, data import, Apex script, community publish, manual instructions, batch scheduling, or package.xml items removal) and store them at project, branch, or pull request scope.

New actions are appended to the end of the action list. Use \`hardis:project:action:reorder\` to change position.

The action ID is auto-generated using UUID.

### Target branches

An action runs on every target branch by default. To restrict it, set one of the two mutually exclusive lists:

- \`includeTargetBranches\`: the action only runs when the deployment targets one of these branches
- \`excludeTargetBranches\`: the action runs everywhere except on these branches

Branch names are matched exactly, ignoring case. The virtual name \`dev-sandboxes\` matches any target that is not a major branch declared in \`config/branches\`: a developer sandbox reached by \`hardis:work:backpromote\`, or a local deployment from a feature branch.

\`\`\`yaml
commandsPostDeploy:
  - id: publishCommunity
    label: Publish the customer community
    type: publish-community
    parameters:
      communityName: Customer
    excludeTargetBranches:
      - dev-sandboxes
\`\`\`

When an action does not apply to the branch being deployed, it is reported as skipped in the Pull Request comment, with the reason.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:create --agent --scope branch --when pre-deploy --type command --label "Disable triggers" --command "sf data update record --sobject User --where \\"Name='Admin'\\" --values \\"TriggerEnabled__c=false\\""
\`\`\`

Required in agent mode:

- \`--scope\`, \`--when\`, \`--type\`, \`--label\`
- Type-specific flags: \`--command\` for command, \`--apex-script\` for apex, \`--sfdmu-project\` for data, \`--community-name\` for publish-community, \`--instructions\` for manual, \`--class-name\` and \`--cron-expression\` for schedule-batch, \`--packagexml-items\` for remove-packagexml-items

In agent mode, \`--context\` defaults to \`process-deployment-only\`. \`--run-only-once-by-org\` defaults to \`true\` (use \`--no-run-only-once-by-org\` to disable); other optional boolean flags default to \`false\`.

Use \`--include-target-branches\` or \`--exclude-target-branches\` (comma-separated, mutually exclusive) to restrict the action to some target branches. Without either flag, the action runs on all of them.

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
    '$ sf hardis:project:action:create --agent --scope pr --pr-id 123 --when pre-deploy --type remove-packagexml-items --label "Skip legacy classes" --packagexml-items "ApexClass:MyClass1,MyClass3;Layout:MyLayout1,MyLayout2"',
    '$ sf hardis:project:action:create --agent --scope project --when post-deploy --type apex --label "Reset demo data" --apex-script scripts/apex/reset-demo.apex --exclude-target-branches "main,preprod"',
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
      options: ['command', 'data', 'apex', 'publish-community', 'manual', 'schedule-batch', 'remove-packagexml-items'],
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
    'packagexml-items': Flags.string({
      description: 'Semicolon-separated list of package.xml items to remove before deployment, each in format TypeName:Member1,Member2 (for remove-packagexml-items type). Example: "ApexClass:MyClass1,MyClass3;Layout:MyLayout1,MyLayout2"',
    }),
    context: Flags.string({
      options: ['all', 'check-deployment-only', 'process-deployment-only'],
      description: 'Execution context (default: process-deployment-only)',
    }),
    'include-target-branches': Flags.string({
      description: 'Comma-separated list of target branches the action runs on (ex: "uat,preprod"). Use dev-sandboxes for developer sandboxes. Cannot be combined with --exclude-target-branches',
    }),
    'exclude-target-branches': Flags.string({
      description: 'Comma-separated list of target branches the action is skipped on (ex: "main"). Use dev-sandboxes for developer sandboxes. Cannot be combined with --include-target-branches',
    }),
    'allow-failure': Flags.boolean({
      default: false,
      description: 'Allow action to fail without blocking deployment',
    }),
    'run-only-once-by-org': Flags.boolean({
      default: true,
      allowNo: true,
      description: 'Execute action only once per target org (default: true)',
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
    } else if (type === 'remove-packagexml-items') {
      if (when !== 'pre-deploy') {
        throw new SfError(t('actionValidationPackageXmlItemsPreDeployOnly'));
      }
      const itemsRaw: string = agentMode || isCI
        ? this.requireFlag(flags['packagexml-items'], 'packagexml-items')
        : flags['packagexml-items'] || await this.promptText(t('enterPackageXmlItems'), '');
      parameters.packageXmlItems = itemsRaw
        .split(/[;\n]/)
        .map((item: string) => item.trim())
        .filter(Boolean);
    }

    // Collect context
    // remove-packagexml-items must also run during deployment checks, so it defaults to all contexts
    const defaultContext = type === 'remove-packagexml-items' ? 'all' : 'process-deployment-only';
    const context = (flags.context || (!agentMode && !isCI ? await this.promptContext(defaultContext as PrePostCommand['context']) : defaultContext)) as PrePostCommand['context'];

    // Collect optional flags (only prompt in interactive mode)
    let allowFailure = flags['allow-failure'];
    let runOnlyOnceByOrg = flags['run-only-once-by-org'];
    let customUsername = flags['custom-username'] || '';
    let includeTargetBranches = parseBranchListFlag(flags['include-target-branches']);
    let excludeTargetBranches = parseBranchListFlag(flags['exclude-target-branches']);

    if (!agentMode && !isCI) {
      if (!flags['allow-failure']) {
        allowFailure = await this.promptConfirm(t('actionPromptAllowFailure'));
      }
      if (!flags['include-target-branches'] && !flags['exclude-target-branches']) {
        const branchFilter = await this.promptTargetBranchFilter();
        includeTargetBranches = branchFilter.includeTargetBranches || [];
        excludeTargetBranches = branchFilter.excludeTargetBranches || [];
      }
      if (type !== 'remove-packagexml-items') {
        runOnlyOnceByOrg = await this.promptConfirm(t('actionPromptRunOnlyOnceByOrg'), flags['run-only-once-by-org']);
      }
      if (!flags['custom-username']) {
        customUsername = await this.promptText(t('actionPromptCustomUsername'), '');
      }
    }
    // remove-packagexml-items only alters the current deployment, so it must run at every deployment
    if (type === 'remove-packagexml-items') {
      runOnlyOnceByOrg = false;
    }

    // Build the action
    const action = buildAction({
      id: randomUUID(),
      label,
      type,
      command,
      context,
      includeTargetBranches,
      excludeTargetBranches,
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

  private async promptContext(initialContext: PrePostCommand['context'] = 'process-deployment-only'): Promise<PrePostCommand['context']> {
    const response = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(t('selectActionContext')),
      choices: ACTION_CONTEXTS.map(ctx => ({ title: ctx, value: ctx })),
      initial: Math.max(ACTION_CONTEXTS.indexOf(initialContext), 0),
      description: t('selectActionContext'),
    });
    return response.value as PrePostCommand['context'];
  }
}
