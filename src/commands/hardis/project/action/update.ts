import { Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { ActionCommandBase } from './base.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { t } from '../../../../common/utils/i18n.js';
import {
  ACTION_CONTEXTS,
  ACTION_TYPES,
  findActionById,
  logActionSummary,
  readActions,
  resolvePrId,
  validateActionParameters,
  writeActions,
} from '../../../../common/utils/actionUtils.js';
import { PrePostCommand } from '../../../../common/actionsProvider/actionsProvider.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionUpdate extends ActionCommandBase {
  public static title = 'Update deployment action';

  public static description = `
## Command Behavior

**Updates an existing deployment action in the project configuration.**

Allows modifying any field of an existing action, including changing its type (which requires providing new type-specific parameters). Only the fields you specify are updated; all other fields remain unchanged.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:update --agent --scope branch --when pre-deploy --action-id <uuid> --label "Updated label"
\`\`\`

Required in agent mode:

- \`--scope\`, \`--when\`, \`--action-id\`
- At least one field to update

<details markdown="1">
<summary>Technical explanations</summary>

- Reads the action list from the YAML config file, finds the action by ID, applies updates, validates, and writes back.
- Changing \`--type\` clears old type-specific parameters and requires new ones.
</details>
`;

  public static examples = [
    '$ sf hardis:project:action:update',
    '$ sf hardis:project:action:update --agent --scope branch --when pre-deploy --action-id abc-123 --label "New label" --context process-deployment-only',
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
      description: 'ID of the action to update',
    }),
    branch: Flags.string({
      description: 'Target branch name (for branch scope, defaults to current branch)',
    }),
    'pr-id': Flags.string({
      description: 'Pull request ID (for pr scope, defaults to draft)',
    }),
    type: Flags.string({
      options: ['command', 'data', 'apex', 'publish-community', 'manual', 'schedule-batch'],
      description: 'New type of action',
    }),
    label: Flags.string({
      description: 'New label for the action',
    }),
    command: Flags.string({
      description: 'New shell command (for command type)',
    }),
    'apex-script': Flags.string({
      description: 'New path to Apex script file (for apex type)',
    }),
    'sfdmu-project': Flags.string({
      description: 'New SFDMU workspace name (for data type)',
    }),
    'community-name': Flags.string({
      description: 'New community name (for publish-community type)',
    }),
    instructions: Flags.string({
      description: 'New manual instructions text (for manual type)',
    }),
    'class-name': Flags.string({
      description: 'New Apex batch class name (for schedule-batch type)',
    }),
    'cron-expression': Flags.string({
      description: 'New cron expression (for schedule-batch type)',
    }),
    'job-name': Flags.string({
      description: 'New job name for schedule-batch',
    }),
    context: Flags.string({
      options: ['all', 'check-deployment-only', 'process-deployment-only'],
      description: 'New execution context',
    }),
    'skip-if-error': Flags.boolean({
      description: 'Skip action if deployment failed',
      allowNo: true,
    }),
    'allow-failure': Flags.boolean({
      description: 'Allow action to fail without blocking deployment',
      allowNo: true,
    }),
    'run-only-once-by-org': Flags.boolean({
      description: 'Execute action only once per target org',
      allowNo: true,
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
    const { flags } = await this.parse(ActionUpdate);
    const agentMode = flags.agent === true;

    const { scope, when } = await this.collectScopeAndWhen(flags, agentMode);

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
      actionId = await this.promptSelect(t('selectActionToUpdate'), actions.map(a => ({
        title: `${a.label} (${a.type})`,
        value: a.id,
        description: a.id,
      })));
    }

    const { action, index } = findActionById(actions, actionId);

    // In interactive mode, prompt for each field with current value
    if (!agentMode && !isCI) {
      await this.interactiveUpdate(action, flags);
    } else {
      this.applyFlagUpdates(action, flags);
    }

    // Validate
    const validationErrors = await validateActionParameters(action);
    if (validationErrors.length > 0) {
      throw new SfError(t('actionValidationErrors', { errors: validationErrors.join('\n') }));
    }

    // Write back
    actions[index] = action;
    const configFile = await writeActions(scope, when, actions, flags.branch, resolvedPrId);

    uxLog("success", this, c.green(t('actionUpdatedSuccessfully', { label: action.label })));
    logActionSummary(this, action);
    uxLog("log", this, c.grey(t('actionSavedToFile', { file: configFile })));

    WebSocketClient.sendRefreshPipelineMessage();

    return { outputString: 'Action updated', action: action as any, configFile };
  }

  private async interactiveUpdate(action: PrePostCommand, _flags: any): Promise<void> {
    const newLabel = await this.promptText(t('enterActionLabel'), action.label);
    if (newLabel) action.label = newLabel;

    const newType = await this.promptSelect(t('selectActionType'), ACTION_TYPES.map(t2 => ({ title: t2, value: t2 })), action.type);
    if (newType && newType !== action.type) {
      action.type = newType;
      action.parameters = {};
      action.command = '';
    }

    if (action.type === 'command') {
      const val = await this.promptText(t('enterCommand'), action.command || '');
      if (val) action.command = val;
    } else if (action.type === 'apex') {
      const val = await this.promptText(t('enterApexScriptPath'), action.parameters?.apexScript || '');
      if (val) action.parameters = { ...action.parameters, apexScript: val };
    } else if (action.type === 'data') {
      const val = await this.promptText(t('enterSfdmuProject'), action.parameters?.sfdmuProject || '');
      if (val) action.parameters = { ...action.parameters, sfdmuProject: val };
    } else if (action.type === 'publish-community') {
      const val = await this.promptText(t('enterCommunityName'), action.parameters?.communityName || '');
      if (val) action.parameters = { ...action.parameters, communityName: val };
    } else if (action.type === 'manual') {
      const val = await this.promptText(t('enterInstructions'), action.parameters?.instructions || '');
      if (val) action.parameters = { ...action.parameters, instructions: val };
    } else if (action.type === 'schedule-batch') {
      const cn = await this.promptText(t('enterClassName'), action.parameters?.className || '');
      if (cn) action.parameters = { ...action.parameters, className: cn };
      const ce = await this.promptText(t('enterCronExpression'), action.parameters?.cronExpression || '');
      if (ce) action.parameters = { ...action.parameters, cronExpression: ce };
      const jn = await this.promptText(t('enterJobName'), action.parameters?.jobName || '');
      if (jn) action.parameters = { ...action.parameters, jobName: jn };
    }

    const newContext = await this.promptSelect(t('selectActionContext'), ACTION_CONTEXTS.map(ctx => ({ title: ctx, value: ctx })), action.context);
    if (newContext) action.context = newContext;

    action.skipIfError = await this.promptConfirm(t('actionPromptSkipIfError'), action.skipIfError || false);
    action.allowFailure = await this.promptConfirm(t('actionPromptAllowFailure'), action.allowFailure || false);
    action.runOnlyOnceByOrg = await this.promptConfirm(t('actionPromptRunOnlyOnceByOrg'), action.runOnlyOnceByOrg || false);
    const cu = await this.promptText(t('actionPromptCustomUsername'), action.customUsername || '');
    action.customUsername = cu || undefined;
  }

  private applyFlagUpdates(action: PrePostCommand, flags: any): void {
    if (flags.label) action.label = flags.label;
    if (flags.type) {
      action.type = flags.type;
      action.parameters = {};
      action.command = '';
    }
    if (flags.command) action.command = flags.command;
    if (flags['apex-script']) action.parameters = { ...action.parameters, apexScript: flags['apex-script'] };
    if (flags['sfdmu-project']) action.parameters = { ...action.parameters, sfdmuProject: flags['sfdmu-project'] };
    if (flags['community-name']) action.parameters = { ...action.parameters, communityName: flags['community-name'] };
    if (flags.instructions) action.parameters = { ...action.parameters, instructions: flags.instructions };
    if (flags['class-name']) action.parameters = { ...action.parameters, className: flags['class-name'] };
    if (flags['cron-expression']) action.parameters = { ...action.parameters, cronExpression: flags['cron-expression'] };
    if (flags['job-name']) action.parameters = { ...action.parameters, jobName: flags['job-name'] };
    if (flags.context) action.context = flags.context;
    if (flags['skip-if-error'] !== undefined) action.skipIfError = flags['skip-if-error'];
    if (flags['allow-failure'] !== undefined) action.allowFailure = flags['allow-failure'];
    if (flags['run-only-once-by-org'] !== undefined) action.runOnlyOnceByOrg = flags['run-only-once-by-org'];
    if (flags['custom-username']) action.customUsername = flags['custom-username'];
  }
}
