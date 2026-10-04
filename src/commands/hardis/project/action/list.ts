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
import { BackpromoteCommentStore } from '../../../../common/utils/backpromoteCommentUtils.js';
import { ActionForecastItem, findOpenPromotionPullRequest, forecastAction, markIdenticalForecasts } from '../../../../common/utils/deploymentActionForecastUtils.js';
import { listMajorOrgs } from '../../../../common/utils/orgConfigUtils.js';
import { parseWorkflowRunsFromComments, PR_COMMENT_HIDDEN_MARKER } from '../../../../common/gitProvider/prRunSummary.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionList extends ActionCommandBase {
  public static title = 'List deployment actions';

  public static description = `
## Command Behavior

**Lists deployment actions defined in the project configuration.**

Displays a table of actions for the specified scope and deployment phase, showing position, ID, label, type, and context.

With \`--with-status\` and \`--pr-ids\` (Pull Request numbers, or \`draft\`), it returns instead the status of the actions of these Pull Requests in each org branch, as recorded in their "Deployment Actions" comments: done, failed, not run because a previous action failed, moved to a fix Pull Request, waiting for a manual execution... The VS Code extension reads it to show the status of each action, and to offer **Retry** and **Mark as done** on the failed ones. With \`--forecast <branch>\` (and \`--from-branch <branch>\`), it also returns what the next promotion will do with each action in that branch: waiting for someone before the merge, a manual step to do once the promotion is deployed, done already, run by the validation job, run by the deployment job, failed there, not for that branch (branch filter, validation only), or not carried by the open promotion Pull Request, which it also returns. The VS Code Deployment Actions tab shows it in its "Next promotion" mode. When the same job runs an action once for several Pull Requests (same type, phase, user and parameters), the copies keep the job they belong to, with the \`identical-action\` reason and an \`identicalTo\` field naming the action that runs.

With \`--with-backpromotes\`, it also returns the rows of their "Backpromotes" comments: the actions run in each developer org, by sandbox name and org id. The results of actions tried in a developer org without a Pull Request comment, kept in \`config/user/deployment-actions/\`, are included. Without a git provider token, only those are returned.

With \`--with-workflows\`, it also returns what the comments of these Pull Requests report: the validation and deployment runs of sfdx-hardis (kind, outcome, target branch, job, date, number of deployment errors and of failing Apex tests) and the analysis of MegaLinter, each with the comment itself as markdown. A run reported by a version of sfdx-hardis older than this flag has its outcome and its comment, without the counts. The VS Code Pull Request view shows them in its Validation, Deployment and MegaLinter tabs.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:list --agent --scope branch --when pre-deploy
sf hardis:project:action:list --agent --with-status --pr-ids 123,124 --json
sf hardis:project:action:list --agent --with-status --with-workflows --pr-ids 123 --json
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
    '$ sf hardis:project:action:list --agent --with-status --with-workflows --pr-ids 123 --json',
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
    forecast: Flags.string({
      description: 'With --with-status, also return what the next promotion to this major branch will do with each action (ex: preprod)',
    }),
    'from-branch': Flags.string({
      description: 'With --forecast, the branch the promotion comes from (ex: uat): finds the open promotion Pull Request and the Pull Requests it carries',
    }),
    'with-backpromotes': Flags.boolean({
      default: false,
      description: 'With --with-status, also return the rows of the Backpromotes comments of --pr-ids: the actions run in each developer org',
    }),
    'with-workflows': Flags.boolean({
      default: false,
      description: 'With --with-status, also return the validation, deployment and MegaLinter results reported in the comments of --pr-ids',
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
      return await this.listStatuses(flags['pr-ids'] || '', flags['with-backpromotes'] === true, flags.forecast, flags['from-branch'], flags['with-workflows'] === true);
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
  private async listStatuses(prIdsFlag: string, withBackpromotes: boolean, forecastBranch?: string, fromBranch?: string, withWorkflows = false): Promise<AnyJson> {
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
    // The actions run in developer orgs, from the Backpromotes comments (one more read per Pull Request)
    const backpromotes: Record<string, any[]> = {};
    if (withBackpromotes && gitProvider) {
      const store = new BackpromoteCommentStore(null, this);
      for (const prNumber of prNumbers) {
        try {
          backpromotes[String(prNumber)] = (await store.read(prNumber)).actionRows;
        } catch (e) {
          uxLog("warning", this, c.yellow(t('backpromoteCommentWriteFailed', { pr: prNumber, message: (e as Error).message })));
          backpromotes[String(prNumber)] = [];
        }
      }
    }
    // The validation and deployment runs, from the comments that report them (one listing per Pull Request)
    const workflows: Record<string, any[]> = {};
    if (withWorkflows && gitProvider) {
      uxLog("action", this, c.cyan(t('actionListWorkflowsHeader', { count: prNumbers.length })));
      // Read together: the VS Code view waits for this answer, and there are only a few Pull Requests
      // (the one shown and the ones that carried it)
      const commentsByPr = await Promise.all(
        prNumbers.map((prNumber) => GitProvider.tryListPullRequestCommentsByMarker(PR_COMMENT_HIDDEN_MARKER, prNumber))
      );
      prNumbers.forEach((prNumber, index) => {
        workflows[String(prNumber)] = parseWorkflowRunsFromComments(commentsByPr[index] || []);
      });
    }
    const forecast = forecastBranch && gitProvider ? await this.buildForecast(prNumbers, forecastBranch, fromBranch) : null;
    // gitProvider false: the comments could not be read, only the local results are there, and a UI
    // must not present "no status" as "not run yet"
    return {
      outputString: `Status of the actions of ${prIds.length} Pull Request(s)`,
      statuses,
      gitProvider: prNumbers.length === 0 || !!gitProvider,
      ...(withBackpromotes ? { backpromotes } : {}),
      ...(withWorkflows ? { workflows } : {}),
      ...(forecast ? { forecast } : {}),
    } as AnyJson;
  }



  /**
   * What the next promotion to forecastBranch will do with the actions of these Pull Requests, read
   * from their actions files (what the VS Code tab lists). The states must have been loaded.
   */
  private async buildForecast(prNumbers: number[], forecastBranch: string, fromBranch?: string): Promise<AnyJson> {
    const majorBranchNames = (await listMajorOrgs()).map((org: any) => org.branchName);
    const promotionPullRequest = fromBranch ? await findOpenPromotionPullRequest(fromBranch, forecastBranch) : null;
    const actions: Record<string, any[]> = {};
    // In the order the promotion runs them, as far as the numbers tell (the deployment takes the
    // oldest merge first): an identical action runs at its first occurrence
    const forecastItems: ActionForecastItem[] = [];
    for (const prNumber of [...prNumbers].sort((a, b) => a - b)) {
      const carried = !promotionPullRequest || promotionPullRequest.carriedPrIds === null || promotionPullRequest.carriedPrIds.includes(prNumber);
      const defs = [
        ...(await readActions('pr', 'pre-deploy', undefined, String(prNumber))).map((def) => ({ ...def, when: 'pre-deploy' as const })),
        ...(await readActions('pr', 'post-deploy', undefined, String(prNumber))).map((def) => ({ ...def, when: 'post-deploy' as const })),
      ];
      actions[String(prNumber)] = defs.map((def) => {
        const forecast = forecastAction(def, prNumber, forecastBranch, majorBranchNames, carried);
        forecastItems.push({ prNumber, def, forecast });
        return forecast;
      });
    }
    await markIdenticalForecasts(forecastItems);
    return { branch: forecastBranch, fromBranch: fromBranch || null, promotionPullRequest: promotionPullRequest as any, actions };
  }
}

