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
  ActionScope,
  ActionWhen,
  applyBranchFilterFlagsToAction,
  findActionById,
  listAvailableActionTypes,
  logActionSummary,
  readActions,
  readPullRequestDescriptionActions,
  resolvePrId,
  validateActionParameters,
  validateMovedFrom,
  writeActions,
} from '../../../../common/utils/actionUtils.js';
import { CONSTANTS } from '../../../../config/index.js';
import { PrePostCommand } from '../../../../common/actionsProvider/actionsProvider.js';
import { normalizePackageXmlItems } from '../../../../common/actionsProvider/removePackageXmlItemsAction.js';
import { RUN_BATCH_CONTEXT, applyRunBatchFlags, hasRunBatchFlags } from '../../../../common/actionsProvider/runBatchAction.js';
import { getCustomFunctionById, isBuiltInActionType } from '../../../../common/utils/customFunctionUtils.js';
import { castFunctionInputValues, parseFunctionInputFlags } from '../../../../common/utils/customFunctionFlagUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionUpdate extends ActionCommandBase {
  public static title = 'Update deployment action';

  public static description = `
## Command Behavior

**Updates an existing deployment action in the project configuration.**

Allows modifying any field of an existing action, including changing its type (which requires providing new type-specific parameters). Only the fields you specify are updated; all other fields remain unchanged.

The target branch restriction (\`includeTargetBranches\` / \`excludeTargetBranches\`) can also be changed here. The two lists are mutually exclusive: setting one clears the other. Pass an empty value to a flag to remove the restriction and run the action on every target branch again.

### Fix an action that failed after its deployment

When an action of a merged Pull Request fails because its definition is wrong, move it to a fix Pull Request with \`--move-to-pr\`: the action keeps its id, leaves the file of its original Pull Request, and is added to the file of the fix Pull Request (\`current\`, \`draft\` or a number) with \`movedFrom\` set to the original Pull Request number. Correct it there, then merge the fix Pull Request: the action runs from it, and the original Pull Request shows it as moved. An action declared in the description of the original Pull Request cannot be removed from it after the merge: it is copied, and its original version no longer runs.

\`--moved-from\` sets or changes \`movedFrom\` by hand (\`0\` removes it).

See [Recover a failed action](${CONSTANTS.DOC_URL_ROOT}/salesforce-devops-work-on-user-story-deployment-actions/#recover-a-failed-action).

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
- \`--move-to-pr\` requires \`--scope pr\` and the number of the original Pull Request in \`--pr-id\`. When the action is not in its YAML file, it is read from the description of the Pull Request through the git provider API.
- A \`run-batch\` action is updated with \`--class-name\`, \`--run-mode\`, \`--batch-size\`, \`--wait-timeout\` and \`--success-even-if-batch-errors\`. It only runs in the \`process-deployment-only\` context.
</details>

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.github.io) course runs this command, click by click, on an org of your own:

- [Lab 3.3 - Read the deployment log, and what .forceignore hides from it](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-3-deploy-to-integration-and-read-the-log/)

<!-- training-links:end -->
`;

  public static examples = [
    '$ sf hardis:project:action:update',
    '$ sf hardis:project:action:update --agent --scope branch --when pre-deploy --action-id abc-123 --label "New label" --context process-deployment-only',
    '$ sf hardis:project:action:update --agent --scope project --when post-deploy --action-id abc-123 --include-target-branches "uat,preprod"',
    '$ sf hardis:project:action:update --agent --scope pr --pr-id 123 --when post-deploy --action-id abc-123 --move-to-pr current',
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
      description: 'New type of action: a built-in type (command, data, apex, publish-community, manual, schedule-batch, run-batch, remove-packagexml-items) or the id of a project custom function',
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
      description: 'New Apex batch class name (for schedule-batch and run-batch types). Write a global class of a managed package with its namespace: ns.ClassName',
    }),
    'cron-expression': Flags.string({
      description: 'New cron expression (for schedule-batch type)',
    }),
    'job-name': Flags.string({
      description: 'New job name for schedule-batch',
    }),
    'run-mode': Flags.string({
      options: ['wait', 'no-wait'],
      description: 'For run-batch type: wait for the batch to succeed, or launch it without waiting for its result (default: wait)',
    }),
    'batch-size': Flags.integer({
      description: 'Batch size for run-batch type (optional, 1 to 2000, defaults to 200)',
    }),
    'wait-timeout': Flags.integer({
      description: 'Minutes to wait for the batch of a run-batch action in wait mode (optional, defaults to 60)',
    }),
    'success-even-if-batch-errors': Flags.boolean({
      description: 'For run-batch type in wait mode: keep the action successful when the batch completes with errors',
      allowNo: true,
    }),
    'packagexml-items': Flags.string({
      description: 'New semicolon-separated list of package.xml items to remove, each in format TypeName:Member1,Member2 (for remove-packagexml-items type)',
    }),
    'new-when': Flags.string({
      options: ['pre-deploy', 'post-deploy'],
      description: 'Move the action to the other deployment phase. --when still says where to find it',
    }),
    'function-input': Flags.string({
      multiple: true,
      description: 'Value of a custom function input, as name=value. Repeat the flag once per input',
    }),
    context: Flags.string({
      options: ['all', 'check-deployment-only', 'process-deployment-only'],
      description: 'New execution context',
    }),
    'include-target-branches': Flags.string({
      description: 'New comma-separated list of target branches the action runs on. Pass an empty value to remove the restriction',
    }),
    'exclude-target-branches': Flags.string({
      description: 'New comma-separated list of target branches the action is skipped on. Pass an empty value to remove the restriction',
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
    'moved-from': Flags.integer({
      description: 'Number of the Pull Request the action was moved from (0 removes it)',
    }),
    'move-to-pr': Flags.string({
      description: 'Move the action from the Pull Request of --pr-id to this Pull Request (a number, current or draft), keeping its id and setting movedFrom',
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

    if (flags['move-to-pr']) {
      return await this.moveToPullRequest(flags, agentMode, scope, when, resolvedPrId);
    }

    // Read actions
    const actions = await readActions(scope, when, flags.branch, resolvedPrId);
    if (actions.length === 0) {
      throw new SfError(t('noActionsFound', { when, scope }));
    }

    const actionId = await this.resolveActionId(flags, agentMode, actions, t('selectActionToUpdate'));

    const { action, index } = findActionById(actions, actionId);

    // In interactive mode, prompt for each field with current value
    if (!agentMode && !isCI) {
      await this.interactiveUpdate(action, flags);
    } else {
      await this.applyFlagUpdates(action, flags);
    }
    if (flags['moved-from'] !== undefined) {
      action.movedFrom = flags['moved-from'] > 0 ? flags['moved-from'] : undefined;
    }

    // The action may be moved to the other phase: it is then removed from the list it was read
    // from and appended to the other one, instead of ending up in both.
    const targetWhen: ActionWhen = (flags['new-when'] as ActionWhen) || when;
    const isPhaseMove = targetWhen !== when;

    // Validate against the phase the action ends up in, which --new-when may have changed
    const validationErrors = [
      ...(await validateActionParameters(action, targetWhen)),
      ...validateMovedFrom(action, scope, resolvedPrId),
    ];
    if (validationErrors.length > 0) {
      throw new SfError(t('actionValidationErrors', { errors: validationErrors.join('\n') }));
    }

    uxLog("action", this, c.cyan(t('savingDeploymentActions')));
    let configFile: string;
    if (isPhaseMove) {
      actions.splice(index, 1);
      await writeActions(scope, when, actions, flags.branch, resolvedPrId);
      const targetActions = await readActions(scope, targetWhen, flags.branch, resolvedPrId);
      action.when = targetWhen;
      targetActions.push(action);
      configFile = await writeActions(scope, targetWhen, targetActions, flags.branch, resolvedPrId);
      uxLog("log", this, c.grey(t('actionMovedToPhase', { label: action.label, when: targetWhen })));
    } else {
      actions[index] = action;
      configFile = await writeActions(scope, when, actions, flags.branch, resolvedPrId);
    }

    uxLog("success", this, c.green(t('actionUpdatedSuccessfully', { label: action.label })));
    logActionSummary(this, action);
    uxLog("log", this, c.grey(t('actionSavedToFile', { file: configFile })));

    WebSocketClient.sendRefreshPipelineMessage();

    return { outputString: 'Action updated', action: action as any, configFile, movedTo: isPhaseMove ? targetWhen : undefined };
  }

  /**
   * Move an action of a merged Pull Request to a fix Pull Request, keeping its id and recording
   * where it comes from, so the corrected definition runs from the fix Pull Request only.
   */
  private async moveToPullRequest(flags: any, agentMode: boolean, scope: ActionScope, when: ActionWhen, sourcePrId?: string): Promise<AnyJson> {
    const sourcePrNumber = Number(sourcePrId);
    if (scope !== 'pr' || !Number.isInteger(sourcePrNumber) || sourcePrNumber < 1) {
      throw new SfError(t('actionMoveToPrNeedsSourcePr'));
    }
    const targetPrId = await resolvePrId(this, flags['move-to-pr'] === 'draft' ? undefined : flags['move-to-pr'], agentMode);
    if (targetPrId === sourcePrId) {
      throw new SfError(t('actionValidationMovedFromSamePr', { pr: sourcePrId }));
    }
    const sourceActions = await readActions('pr', when, undefined, sourcePrId);
    // An action declared in the Pull Request description is not in the YAML file
    const descriptionActions = await readPullRequestDescriptionActions(sourcePrNumber, when);
    const candidates = [...sourceActions, ...descriptionActions.filter((d) => !sourceActions.some((a) => a.id === d.id))];
    if (candidates.length === 0) {
      throw new SfError(t('noActionsFound', { when, scope }));
    }
    const actionId = await this.resolveActionId(flags, agentMode, candidates, t('selectActionToUpdate'));
    const { action } = findActionById(candidates, actionId);
    const fromFile = sourceActions.some((a) => a.id === actionId);

    // Remove it from the original file, then add it to the fix Pull Request file
    const movedAction: PrePostCommand = { ...action, movedFrom: sourcePrNumber };
    delete movedAction.pullRequest;
    delete movedAction.when;
    await this.applyFlagUpdates(movedAction, flags);
    const validationErrors = [
      ...(await validateActionParameters(movedAction, when)),
      ...validateMovedFrom(movedAction, 'pr', targetPrId),
    ];
    if (validationErrors.length > 0) {
      throw new SfError(t('actionValidationErrors', { errors: validationErrors.join('\n') }));
    }
    uxLog("action", this, c.cyan(t('savingDeploymentActions')));
    if (fromFile) {
      await writeActions('pr', when, sourceActions.filter((a) => a.id !== actionId), undefined, sourcePrId);
    } else {
      uxLog("warning", this, c.yellow(t('actionMovedFromDescription', { label: action.label, pr: sourcePrId })));
    }
    const targetActions = (await readActions('pr', when, undefined, targetPrId)).filter((a) => a.id !== actionId);
    targetActions.push(movedAction);
    const configFile = await writeActions('pr', when, targetActions, undefined, targetPrId);

    uxLog("success", this, c.green(t('actionMovedToPr', { label: action.label, oldPr: sourcePrId, target: targetPrId ? `#${targetPrId}` : 'draft' })));
    logActionSummary(this, movedAction);
    uxLog("log", this, c.grey(t('actionSavedToFile', { file: configFile })));
    WebSocketClient.sendRefreshPipelineMessage();
    return { outputString: 'Action moved', action: movedAction as any, configFile, movedFrom: sourcePrNumber, movedToPr: targetPrId || 'draft' };
  }

  private async interactiveUpdate(action: PrePostCommand, _flags: any): Promise<void> {
    const newLabel = await this.promptText(t('enterActionLabel'), action.label);
    if (newLabel) action.label = newLabel;

    const newType = await this.promptSelect(t('selectActionType'), await listAvailableActionTypes(action.when), action.type);
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
    } else if (action.type === 'run-batch') {
      const cn = await this.promptText(t('enterClassName'), action.parameters?.className || '');
      if (cn) action.parameters = { ...action.parameters, className: cn };
      // Asked again as a whole, so leaving the wait mode drops the wait-only parameters
      action.parameters = {
        className: action.parameters?.className,
        ...(await this.collectRunBatchParameters({}, false, action.parameters)),
      };
    } else if (action.type === 'remove-packagexml-items') {
      const itemsRaw = await this.promptText(t('enterPackageXmlItems'), normalizePackageXmlItems(action.parameters?.packageXmlItems).join(';'));
      if (itemsRaw) {
        action.parameters = {
          ...action.parameters,
          packageXmlItems: itemsRaw.split(/[;\n]/).map((item: string) => item.trim()).filter(Boolean),
        };
      }
    } else if (!isBuiltInActionType(action.type)) {
      const definition = await getCustomFunctionById(action.type);
      if (!definition) {
        throw new SfError(t('actionValidationUnknownType', { type: action.type }));
      }
      action.parameters = await this.promptCustomFunctionInputs(definition, action.parameters || {});
    }

    if (action.type === 'run-batch') {
      // run-batch only runs in one context: there is nothing to ask
      action.context = RUN_BATCH_CONTEXT;
    } else {
      const newContext = await this.promptSelect(t('selectActionContext'), ACTION_CONTEXTS.map(ctx => ({ title: ctx, value: ctx })), action.context);
      if (newContext) action.context = newContext;
    }

    // Both keys are assigned, so switching the restriction mode clears the previous list
    const branchFilter = await this.promptTargetBranchFilter(action);
    action.includeTargetBranches = branchFilter.includeTargetBranches;
    action.excludeTargetBranches = branchFilter.excludeTargetBranches;

    action.allowFailure = await this.promptConfirm(t('actionPromptAllowFailure'), action.allowFailure || false);
    if (action.type === 'remove-packagexml-items') {
      // Filtering package.xml only affects the current deployment, so it must run every time
      action.runOnlyOnceByOrg = false;
    } else {
      action.runOnlyOnceByOrg = await this.promptConfirm(t('actionPromptRunOnlyOnceByOrg'), action.runOnlyOnceByOrg || false);
    }
    const cu = await this.promptText(t('actionPromptCustomUsername'), action.customUsername || '');
    action.customUsername = cu || undefined;
  }

  private async applyFlagUpdates(action: PrePostCommand, flags: any): Promise<void> {
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
    if (action.type === 'run-batch') {
      action.parameters = applyRunBatchFlags(action.parameters, flags);
      // A run-batch action takes its only context, unless one is passed and then validated
      if (!flags.context) action.context = RUN_BATCH_CONTEXT;
    } else if (hasRunBatchFlags(flags)) {
      throw new SfError(t('actionRunBatchFlagsOnOtherType', { type: action.type }));
    }
    if (flags['packagexml-items']) {
      action.parameters = {
        ...action.parameters,
        packageXmlItems: flags['packagexml-items'].split(/[;\n]/).map((item: string) => item.trim()).filter(Boolean),
      };
    }
    if (flags.context) action.context = flags.context;
    applyBranchFilterFlagsToAction(action, flags['include-target-branches'], flags['exclude-target-branches']);
    if (flags['allow-failure'] !== undefined) action.allowFailure = flags['allow-failure'];
    if (flags['run-only-once-by-org'] !== undefined) action.runOnlyOnceByOrg = flags['run-only-once-by-org'];
    if (action.type === 'remove-packagexml-items') action.runOnlyOnceByOrg = false;
    if (flags['custom-username']) action.customUsername = flags['custom-username'];
    if ((flags['function-input'] || []).length > 0) {
      if (isBuiltInActionType(action.type)) {
        throw new SfError(t('actionFunctionInputOnBuiltInType', { type: action.type }));
      }
      // Merge rather than replace: updating one input must not drop the others
      const definition = await getCustomFunctionById(action.type);
      const flagInputs = parseFunctionInputFlags(flags['function-input']);
      action.parameters = {
        ...action.parameters,
        ...(definition ? castFunctionInputValues(flagInputs, definition) : flagInputs),
      };
    }
  }
}
