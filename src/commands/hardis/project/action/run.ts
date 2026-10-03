import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { uxLogTableWithReport } from '../../../../common/utils/filesUtils.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { t } from '../../../../common/utils/i18n.js';
import { CONSTANTS } from '../../../../config/index.js';
import {
  ActionRunResult,
  ActionRunTarget,
  NextActionsMode,
  getDevOrgSkipReason,
  promptActionRunOrg,
  readBackpromoteRowsForOrg,
  recordDevOrgRunInBackpromotes,
  listPullRequestActions,
  resolveDevOrgPullRequest,
  selectDevOrgActions,
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
import { DeploymentActionRef, loadDeploymentActionsState } from '../../../../common/utils/deploymentActionsStateUtils.js';
import { GitProvider } from '../../../../common/gitProvider/index.js';
import { BackpromoteCommentStore } from '../../../../common/utils/backpromoteCommentUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionRun extends SfCommand<any> {
  public static title = 'Run a deployment action';

  public static description = `
## Command Behavior

**Runs one post-deployment action again, outside of a deployment job, after it failed or was stopped by a failure.**

When a post-deployment action fails after the merge of a Pull Request, the metadata is already deployed: re-running the whole deployment job is not needed. This command runs only the chosen action in the org, and records the result in the "Deployment Actions" comment of its Pull Request, with who ran it.

- The org branch comes from the org: the major branch whose \`config/branches/.sfdx-hardis.<branch>.yml\` has the same \`targetUsername\` or \`instanceUrl\`, or \`dev-sandboxes\` for a developer org. With \`--org-branch\`, an org of that branch already authenticated on this computer is used: its \`targetUsername\` first, then any user of its instance.
- The action definition is read from the current checkout. When the org is a major org and the current branch is another one, the command warns and asks for confirmation.
- Without \`--pr\` and \`--action-id\`, it proposes the recent Pull Requests whose actions failed in the org branch, then their failed actions.
- An action with a \`customUsername\` runs as that user: when this computer is not authenticated with it, the command offers to log in with it, and checks the login used the right user.
- Once the action succeeds, it offers to run the actions its failure stopped: only the next one, or all of them.
- An action that only runs during validation jobs, or that removes items from the deployment package.xml, cannot be run. A pre-deployment action can, after a confirmation, since the metadata it ran before is already in the org: in agent or CI mode it is refused, re-run the deployment job instead.
- An action never run in the org, or skipped there, is run after a confirmation, and refused in agent or CI mode.

With \`--select-org\`, the command lists every org authenticated on this computer, the orgs of the major branches of the pipeline first, and runs the action in the chosen one: as a retry in a major org, as a try in a developer org. The VS Code Deployment Actions tab uses it for **Run in another org**.

Anyone authenticated to the org can retry an action, production included. A git provider token is required, to record the result in the Pull Request.

### Try the actions of your Pull Request in your own org

When the org is not a major org (a developer sandbox or a scratch org), the command runs the actions of a Pull Request there, to test them before the merge: one action, or all of them with \`--all\`, pre-deployment actions first, in the order of the actions file. It stops at the first failure, as a deployment does.

- \`--pr\` takes the Pull Request number, or \`draft\` for the actions file of a branch with no Pull Request yet. Without it, the Pull Request of the current branch is used, or the draft file.
- Validation-only actions and package.xml item removals are skipped: they only make sense during a deployment. A \`runOnlyOnceByOrg\` action already done in this org is skipped too.
- The results go to the "Deployment Actions" comment of the Pull Request, in the \`dev-sandboxes\` column shared by every developer org, and to its "Backpromotes" comment, in a row for this sandbox and org id: a later backpromote of that sandbox knows the action already ran there, and so does the next run here. They never count as done in a major org, never write "moved", and never turn the comment red. Without a Pull Request (draft) or without a git provider token, they are kept in \`config/user/deployment-actions/<Pull Request or draft>.json\`, a folder sfdx-hardis projects keep out of git.
- \`--all\` is refused on a major org: a merge runs them there. \`--dev-org\` refuses any run on a major org, which the VS Code **Run in my org** button of an action passes, so a default org that happens to be a major one is never touched.

To close an action that was done by hand, use [hardis:project:action:set-status](${CONSTANTS.DOC_URL_ROOT}/hardis/project/action/set-status/). To fix a wrong definition, move the action to a fix Pull Request with \`sf hardis:project:action:update --move-to-pr\`.

See [Recover a failed action](${CONSTANTS.DOC_URL_ROOT}/salesforce-devops-work-on-user-story-deployment-actions/#recover-a-failed-action).

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:run --agent --pr 123 --action-id abc-123 --org-branch integration --next all
sf hardis:project:action:run --agent --pr draft --all --target-org my-dev-sandbox
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
    '$ sf hardis:project:action:run --pr draft --all',
  ];

  public static flags: any = {
    'target-org': optionalOrgFlagWithDeprecations,
    pr: Flags.string({
      description: 'Number of the Pull Request the action comes from, or draft for the actions file of a branch without Pull Request (developer org only)',
    }),
    all: Flags.boolean({
      default: false,
      description: 'In a developer org, run all the actions of the Pull Request, pre-deployment first',
    }),
    'dev-org': Flags.boolean({
      default: false,
      description: 'Refuse to run when the org is a major org: the run is meant for a developer org only',
    }),
    'action-id': Flags.string({
      description: 'Id of the action to run',
    }),
    'select-org': Flags.boolean({
      default: false,
      description: 'Choose the org among all the orgs authenticated on this computer (major orgs of the pipeline first) instead of --target-org',
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

    let targetOrg = flags['target-org'];
    if (flags['select-org']) {
      if (headless) {
        throw new SfError(t('actionRunSelectOrgHeadless'));
      }
      targetOrg = await promptActionRunOrg();
    }
    const target = await resolveActionRunTarget(targetOrg, flags['select-org'] ? undefined : flags['org-branch']);
    uxLog("action", this, c.cyan(t('actionRunTargetOrg', { orgBranch: target.orgBranch, username: target.username })));
    if (!target.isMajorOrg) {
      return await this.runInDevOrg(flags, target, headless);
    }
    if (flags['dev-org']) {
      throw new SfError(t('actionRunNotDevOrg', { orgBranch: target.orgBranch, username: target.username }));
    }
    if (flags.all) {
      throw new SfError(t('actionRunAllMajorOrg', { orgBranch: target.orgBranch }));
    }
    if (String(flags.pr || '').toLowerCase() === 'draft') {
      throw new SfError(t('actionRunDraftMajorOrg', { orgBranch: target.orgBranch }));
    }
    await requireGitProviderForActionState();
    await confirmDefinitionBranch(target, flags['allow-branch-mismatch'] === true, headless);

    const prNumber = await selectSourcePullRequest(flags.pr, target.orgBranch, headless);
    const actionId = await selectRecoverableAction(prNumber, flags['action-id'], target.orgBranch, headless);
    const def = await resolveActionDefinition(prNumber, actionId, target.orgBranch);
    await checkRetryAllowed(def, prNumber, target.orgBranch, headless);
    await ensureCustomUsernameAuth(def, target, headless);

    // Read before the run: the actions this one stopped, still waiting
    const stopped = await listStoppedActionsAfter(prNumber, actionId, target.orgBranch);
    const results: ActionRunResult[] = [await runActionOutsideDeployment(def, prNumber, target)];
    if (!results[0].blocking) {
      await this.runStoppedActions(results, stopped, flags.next as NextActionsMode | undefined, target, headless);
    }

    uxLog("action", this, c.cyan(t('actionRunSummary', { orgBranch: target.orgBranch })));
    await uxLogTableWithReport(this, results.map((r) => ({ PR: `#${r.prNumber}`, Action: r.label, Status: r.status })), ['PR', 'Action', 'Status'], {
      fileNamePrefix: 'deployment-actions-run',
      fileTitle: 'Deployment actions run',
    });
    WebSocketClient.sendRefreshPipelineMessage();

    const blocking = results.find((result) => result.blocking);
    if (blocking) {
      process.exitCode = 1;
      uxLog("error", this, c.red(t('actionRunFailed', { label: blocking.label, output: blocking.output || '' })));
    } else {
      uxLog("success", this, c.green(t('actionRunSucceeded', { count: results.length, orgBranch: target.orgBranch })));
    }
    return { outputString: `${results.length} action(s) run`, orgBranch: target.orgBranch, isMajorOrg: target.isMajorOrg, results: results as any };
  }

  /**
   * Try the actions of a Pull Request in a developer org: one, or all of them in the order a
   * deployment runs them, stopping at the first failure. The results go to the Pull Request
   * comment when there is one and a git provider token, to a local file otherwise.
   */
  private async runInDevOrg(flags: any, target: ActionRunTarget, headless: boolean): Promise<AnyJson> {
    const { prNumber, prId } = await resolveDevOrgPullRequest(flags.pr, headless);
    const gitProvider = prNumber > 0 ? await GitProvider.getInstance() : null;
    const localState = !gitProvider;
    if (gitProvider) {
      await loadDeploymentActionsState([prNumber]);
    }
    const actions = await listPullRequestActions(prNumber, prId);
    const selected = await selectDevOrgActions(actions, flags['action-id'], flags.all === true, headless);
    // What already ran in this very org, and where its outcome goes: the Backpromotes comment
    const backpromoteStore = gitProvider ? new BackpromoteCommentStore(null, this) : null;
    const backpromoteRows = backpromoteStore ? await readBackpromoteRowsForOrg(backpromoteStore, prNumber, target) : null;
    uxLog("action", this, c.cyan(t('actionRunDevOrgStart', { count: selected.length, pr: prNumber > 0 ? `#${prNumber}` : 'draft', orgBranch: target.orgBranch })));

    const results: ActionRunResult[] = [];
    for (const [index, def] of selected.entries()) {
      const skipReason = getDevOrgSkipReason(def, prNumber, prId, target.orgBranch, localState, backpromoteRows ? backpromoteRows.get(def.id) || null : undefined);
      if (skipReason) {
        uxLog("action", this, c.grey(t('actionRunDevOrgSkipped', { label: def.label, reason: skipReason })));
        results.push({ prNumber, actionId: def.id, label: def.label, orgBranch: target.orgBranch, status: 'skipped', output: skipReason, blocking: false });
        continue;
      }
      await ensureCustomUsernameAuth(def, target, headless);
      const result = await runActionOutsideDeployment(def, prNumber, target, localState ? { localPrId: prId } : {});
      results.push(result);
      if (backpromoteStore) {
        await recordDevOrgRunInBackpromotes(backpromoteStore, def, prNumber, target, result.status);
      }
      if (result.blocking) {
        const notRun = selected.slice(index + 1);
        if (notRun.length > 0) {
          uxLog("warning", this, c.yellow(t('actionRunDevOrgStopped', { count: notRun.length, label: def.label })));
        }
        for (const other of notRun) {
          results.push({ prNumber, actionId: other.id, label: other.label, orgBranch: target.orgBranch, status: 'not-run', blocking: false });
        }
        break;
      }
    }

    uxLog("action", this, c.cyan(t('actionRunSummary', { orgBranch: target.orgBranch })));
    await uxLogTableWithReport(this, results.map((r) => ({ Action: r.label, Status: r.status })), ['Action', 'Status'], {
      fileNamePrefix: 'deployment-actions-run',
      fileTitle: 'Deployment actions run in your org',
    });
    WebSocketClient.sendRefreshPipelineMessage();
    const blocking = results.find((result) => result.blocking);
    if (blocking) {
      process.exitCode = 1;
      uxLog("error", this, c.red(t('actionRunFailed', { label: blocking.label, output: blocking.output || '' })));
    } else {
      uxLog("success", this, c.green(t('actionRunDevOrgDone', { count: results.filter((r) => r.status !== 'skipped').length, orgBranch: target.orgBranch })));
    }
    return { outputString: `${results.length} action(s) processed`, orgBranch: target.orgBranch, isMajorOrg: false, pr: prId, localState, results: results as any };
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
      if (result.blocking) {
        await recordNewBlocker(result, stopped.slice(stopped.indexOf(ref) + 1));
        return;
      }
      if (index === toRun.length - 1 && toRun.length < stopped.length) {
        uxLog("action", this, c.cyan(t('actionRunStoppedActionsLeft', { count: stopped.length - toRun.length })));
      }
    }
  }
}
