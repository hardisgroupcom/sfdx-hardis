import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { t } from '../../../../common/utils/i18n.js';
import { CONSTANTS } from '../../../../config/index.js';
import {
  ActionRunResult,
  NextActionsMode,
  checkRetryAllowed,
  chooseNextActionsMode,
  confirmDefinitionBranch,
  ensureCustomUsernameAuth,
  listStoppedActionsAfter,
  recordNewBlocker,
  requireGitProviderForActionState,
  resolveActionDefinition,
  resolveActionRunTarget,
  runActionOutsideDeployment,
  selectRecoverableAction,
  selectSourcePullRequest,
} from '../../../../common/utils/deploymentActionRunUtils.js';
import { DeploymentActionRef } from '../../../../common/utils/deploymentActionsStateUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionRun extends SfCommand<any> {
  public static title = 'Run a deployment action';

  public static description = `
## Command Behavior

**Runs one post-deployment action again, outside of a deployment job, after it failed or was stopped by a failure.**

When a post-deployment action fails after the merge of a Pull Request, the metadata is already deployed: re-running the whole deployment job is not needed. This command runs only the chosen action in the org, and records the result in the "Deployment Actions" comment of its Pull Request, with who ran it.

- The org branch comes from the org: the major branch whose \`config/branches/.sfdx-hardis.<branch>.yml\` has the same \`targetUsername\` or \`instanceUrl\`, or the current git branch for a dev org. With \`--org-branch\`, an org of that branch already authenticated on this computer is used: its \`targetUsername\` first, then any user of its instance.
- The action definition is read from the current checkout. When the org is a major org and the current branch is another one, the command warns and asks for confirmation.
- Without \`--pr\` and \`--action-id\`, it proposes the recent Pull Requests whose actions failed in the org branch, then their failed actions.
- An action with a \`customUsername\` runs as that user: when this computer is not authenticated with it, the command offers to log in with it, and checks the login used the right user.
- Once the action succeeds, it offers to run the actions its failure stopped: only the next one, or all of them.
- A pre-deployment action, or an action that only runs during validation jobs, cannot be retried.

Anyone authenticated to the org can retry an action, production included. A git provider token is required, to record the result in the Pull Request.

To close an action that was done by hand, use [hardis:project:action:set-status](${CONSTANTS.DOC_URL_ROOT}/hardis/project/action/set-status/). To fix a wrong definition, move the action to a fix Pull Request with \`sf hardis:project:action:update --move-to-pr\`.

See [Recover a failed action](${CONSTANTS.DOC_URL_ROOT}/salesforce-devops-work-on-user-story-deployment-actions/#recover-a-failed-action).

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:run --agent --pr 123 --action-id abc-123 --org-branch integration --next all
\`\`\`

Required in agent mode:

- \`--pr\`, \`--action-id\`
- \`--org-branch\` or \`--target-org\`
- \`--allow-branch-mismatch\` when the current branch is not the org branch

Defaults applied: \`--next none\`. The confirmations are skipped with a warning. An action whose \`customUsername\` is not authenticated on this computer fails instead of prompting for a login.

<details markdown="1">
<summary>Technical explanations</summary>

- Loads the state of the Pull Request from its "Deployment Actions" comment, then runs the action with the same code as a deployment job (branch filters, references to the outputs of other actions, validity checks, execution, state).
- The outputs other actions of the Pull Request persisted in the org are replayed, so references to them still resolve.
- The \`sf\` commands started by the action target the org through the \`SF_TARGET_ORG\` environment variable of the process: the default org of the project is not changed.
- The state entry carries a note such as "Run locally by Jane Doe (jane@acme.com) on 2026-10-03 14:05 UTC."
- The stopped actions come from the failed entry (\`stoppedActions\`) and from the \`blockedBy\` link of each stopped entry.
</details>

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.github.io) course runs this command, click by click, on an org of your own:

- [Lab 3.3 - Read the deployment log, and what .forceignore hides from it](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-3-deploy-to-integration-and-read-the-log/)

<!-- training-links:end -->
`;

  public static examples = [
    '$ sf hardis:project:action:run',
    '$ sf hardis:project:action:run --pr 123 --action-id abc-123 --org-branch integration',
    '$ sf hardis:project:action:run --agent --pr 123 --action-id abc-123 --org-branch integration --next all',
  ];

  public static flags: any = {
    'target-org': optionalOrgFlagWithDeprecations,
    pr: Flags.string({
      description: 'Number of the Pull Request the action comes from',
    }),
    'action-id': Flags.string({
      description: 'Id of the action to run',
    }),
    'org-branch': Flags.string({
      description: 'Major branch of the org to run the action in (ex: integration). Uses an org of that instance authenticated on this computer',
    }),
    next: Flags.string({
      options: ['none', 'one', 'all'],
      description: 'Once the action succeeded, run none, the next one, or all the actions its failure stopped',
    }),
    'allow-branch-mismatch': Flags.boolean({
      default: false,
      description: 'Run even when the current git branch is not the branch of the org (the definition is read from the current branch)',
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

  public static requiresProject = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ActionRun);
    const headless = flags.agent === true || isCI;

    await requireGitProviderForActionState();
    const target = await resolveActionRunTarget(flags['target-org'], flags['org-branch']);
    uxLog("action", this, c.cyan(t('actionRunTargetOrg', { orgBranch: target.orgBranch, username: target.username })));
    await confirmDefinitionBranch(target, flags['allow-branch-mismatch'] === true, headless);

    const prNumber = await selectSourcePullRequest(flags.pr, target.orgBranch, headless);
    const actionId = await selectRecoverableAction(prNumber, flags['action-id'], target.orgBranch, headless);
    const def = await resolveActionDefinition(prNumber, actionId, target.orgBranch);
    await checkRetryAllowed(def, prNumber, target.orgBranch, headless);
    await ensureCustomUsernameAuth(def, target, headless);

    // Read before the run: the actions this one stopped, still waiting
    const stopped = await listStoppedActionsAfter(prNumber, actionId, target.orgBranch);
    const results: ActionRunResult[] = [await runActionOutsideDeployment(def, prNumber, target)];
    if (results[0].status === 'success') {
      await this.runStoppedActions(results, stopped, flags.next as NextActionsMode | undefined, target, headless);
    }

    uxLog("action", this, c.cyan(t('actionRunSummary', { orgBranch: target.orgBranch })));
    uxLogTable(this, results.map((r) => ({ PR: `#${r.prNumber}`, Action: r.label, Status: r.status })));
    WebSocketClient.sendRefreshPipelineMessage();

    const last = results[results.length - 1];
    if (last.status !== 'success') {
      process.exitCode = 1;
      uxLog("error", this, c.red(t('actionRunFailed', { label: last.label, output: last.output || '' })));
    } else {
      uxLog("success", this, c.green(t('actionRunSucceeded', { count: results.length, orgBranch: target.orgBranch })));
    }
    return { outputString: `${results.length} action(s) run`, orgBranch: target.orgBranch, isMajorOrg: target.isMajorOrg, results: results as any };
  }

  /**
   * Run the actions the failure stopped, in order, as the user chose. Stops at the first failure,
   * which then becomes the action the remaining ones wait for.
   */
  private async runStoppedActions(results: ActionRunResult[], stopped: DeploymentActionRef[], nextFlag: NextActionsMode | undefined, target: any, headless: boolean): Promise<void> {
    const mode = await chooseNextActionsMode(stopped.length, nextFlag, headless);
    if (mode === 'none') {
      return;
    }
    const toRun = mode === 'one' ? stopped.slice(0, 1) : stopped;
    for (const [index, ref] of toRun.entries()) {
      const def = await resolveActionDefinition(ref.pr, ref.actionId, target.orgBranch);
      await ensureCustomUsernameAuth(def, target, headless);
      const result = await runActionOutsideDeployment(def, ref.pr, target);
      results.push(result);
      if (result.status !== 'success' && result.status !== 'skipped') {
        await recordNewBlocker(result, stopped.slice(stopped.indexOf(ref) + 1));
        return;
      }
      if (index === toRun.length - 1 && toRun.length < stopped.length) {
        uxLog("action", this, c.cyan(t('actionRunStoppedActionsLeft', { count: stopped.length - toRun.length })));
      }
    }
  }
}
