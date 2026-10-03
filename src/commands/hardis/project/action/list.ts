import { Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { uxLogTableWithReport } from '../../../../common/utils/filesUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import {
  readActions,
  resolvePrId,
} from '../../../../common/utils/actionUtils.js';
import { ActionCommandBase } from './base.js';
import { getStateEntriesForPr, loadDeploymentActionsState } from '../../../../common/utils/deploymentActionsStateUtils.js';
import { readLocalActionStates } from '../../../../common/utils/deploymentActionsLocalState.js';
import { GitProvider } from '../../../../common/gitProvider/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionList extends ActionCommandBase {
  public static title = 'List deployment actions';

  public static description = `
## Command Behavior

**Lists deployment actions defined in the project configuration.**

Displays a table of actions for the specified scope and deployment phase, showing position, ID, label, type, and context.

With \`--with-status\` and \`--pr-ids\` (Pull Request numbers, or \`draft\`), it returns instead the status of the actions of these Pull Requests in each org branch, as recorded in their "Deployment Actions" comments: done, failed, not run because a previous action failed, moved to a fix Pull Request, waiting for a manual execution... The VS Code extension reads it to show the status of each action, and to offer **Retry** and **Mark as done** on the failed ones. The results of actions tried in a developer org without a Pull Request comment, kept in \`config/user/deployment-actions/\`, are included. Without a git provider token, only those are returned.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:list --agent --scope branch --when pre-deploy
sf hardis:project:action:list --agent --with-status --pr-ids 123,124 --json
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
    'with-status': Flags.boolean({
      default: false,
      description: 'Return the status of the actions of --pr-ids in each org branch, read from their Deployment Actions comments',
    }),
    'pr-ids': Flags.string({
      description: 'Comma-separated list of Pull Request numbers, or draft (with --with-status)',
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
    const { flags } = await this.parse(ActionList);
    const agentMode = flags.agent === true;

    if (flags['with-status']) {
      return await this.listStatuses(flags['pr-ids'] || '');
    }

    const { scope, when } = await this.collectScopeAndWhen(flags, agentMode);

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
      'Allow Failure': a.allowFailure ? 'Yes' : 'No',
    }));

    await uxLogTableWithReport(this, tableData, ['#', 'Id', 'Label', 'Type', 'Context', 'Allow Failure'], {
      fileNamePrefix: 'deployment-actions',
      fileTitle: 'Deployment actions',
    });

    return { outputString: `Found ${actions.length} actions`, actions: actions as any };
  }

  /**
   * Status of the actions of some Pull Requests in each org branch, from their Deployment Actions
   * comments, for the VS Code Deployment Actions tab.
   */
  private async listStatuses(prIdsFlag: string): Promise<AnyJson> {
    const prIds = [...new Set(prIdsFlag.split(',').map((id) => id.replace('#', '').trim()).filter((id) => id === 'draft' || /^\d+$/.test(id)))];
    if (prIds.length === 0) {
      throw new SfError(t('missingRequiredFlag', { flag: 'pr-ids' }));
    }
    uxLog("action", this, c.cyan(t('actionListStatusHeader', { count: prIds.length })));
    // The Pull Request comments when a git provider is available, the local results of the actions
    // tried in a developer org in any case (a draft only has those)
    const prNumbers = prIds.filter((id) => id !== 'draft').map((id) => parseInt(id, 10));
    const gitProvider = prNumbers.length > 0 ? await GitProvider.getInstance() : null;
    if (gitProvider) {
      await loadDeploymentActionsState(prNumbers);
    }
    const statuses: Record<string, any[]> = {};
    for (const prId of prIds) {
      const fromComment = prId !== 'draft' && gitProvider ? getStateEntriesForPr(parseInt(prId, 10)) : [];
      const fromLocal = readLocalActionStates(prId).filter(
        (local) => !fromComment.some((e) => e.actionId === local.actionId && e.orgBranch === local.orgBranch)
      );
      statuses[prId] = [...fromComment, ...fromLocal].map((e) => ({
        actionId: e.actionId,
        actionLabel: e.actionLabel,
        orgBranch: e.orgBranch,
        when: e.when,
        status: e.status,
        date: e.date,
        jobUrl: e.jobUrl,
        note: e.note || '',
        movedTo: e.movedTo || null,
        blockedBy: e.blockedBy || null,
        stoppedActions: e.stoppedActions || [],
        local: fromLocal.includes(e),
      }));
    }
    return { outputString: `Status of the actions of ${prIds.length} Pull Request(s)`, statuses };
  }


}

