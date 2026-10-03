import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { t } from '../../../../common/utils/i18n.js';
import { CONSTANTS } from '../../../../config/index.js';
import {
  closeActionByHand,
  requireGitProviderForActionState,
  resolveOrgBranchForStatus,
  selectRecoverableAction,
  selectSourcePullRequest,
} from '../../../../common/utils/deploymentActionRunUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionSetStatus extends SfCommand<any> {
  public static title = 'Set the status of a deployment action';

  public static description = `
## Command Behavior

**Records a failed (or stopped) deployment action as done by hand in an org branch.**

When an action failed during a deployment job and was then performed by hand, this command records it as done in the "Deployment Actions" comment of its Pull Request, so later deployments to that org do not run it again.

- The status becomes \`success\`, with a note such as "Failed in CI, then closed by hand by Jane Doe (jane@acme.com) on 2026-10-03 14:05 UTC."
- Only an action that failed, or was not run because a previous action failed, can be closed.
- Its checkboxes in the "Failed actions" lists of the Pull Request comments are ticked.
- Closing an action does not run the actions its failure stopped: run them with [hardis:project:action:run](${CONSTANTS.DOC_URL_ROOT}/hardis/project/action/run/).
- Without \`--pr\` and \`--action-id\`, it proposes the recent Pull Requests whose actions failed in the org branch, then their failed actions.

Ticking the checkbox of a failed action in a Pull Request comment does the same at the next sfdx-hardis job.

See [Recover a failed action](${CONSTANTS.DOC_URL_ROOT}/salesforce-devops-work-on-user-story-deployment-actions/#recover-a-failed-action).

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:action:set-status --agent --pr 123 --action-id abc-123 --org-branch integration --status success
\`\`\`

Required in agent mode:

- \`--pr\`, \`--action-id\`
- \`--org-branch\` or \`--target-org\`

<details markdown="1">
<summary>Technical explanations</summary>

- Reads the state of the Pull Request from its "Deployment Actions" comment, rewrites the entry of the action for the org branch, and runs the checkbox sync on the comments of the Pull Request.
- No org work is done. The org, when there is one, gives the Salesforce username written in the note, and the org branch when \`--org-branch\` is not passed.
- A git provider token is required.
</details>

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.github.io) course runs this command, click by click, on an org of your own:

- [Lab 3.3 - Read the deployment log, and what .forceignore hides from it](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-3-deploy-to-integration-and-read-the-log/)

<!-- training-links:end -->
`;

  public static examples = [
    '$ sf hardis:project:action:set-status',
    '$ sf hardis:project:action:set-status --agent --pr 123 --action-id abc-123 --org-branch integration --status success',
  ];

  public static flags: any = {
    'target-org': optionalOrgFlagWithDeprecations,
    pr: Flags.string({
      description: 'Number of the Pull Request the action comes from',
    }),
    'action-id': Flags.string({
      description: 'Id of the action',
    }),
    'org-branch': Flags.string({
      description: 'Org branch the action was done in (ex: integration)',
    }),
    status: Flags.string({
      options: ['success'],
      default: 'success',
      description: 'New status of the action',
    }),
    note: Flags.string({
      description: 'Text added to the note recorded with the status',
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
    const { flags } = await this.parse(ActionSetStatus);
    const headless = flags.agent === true || isCI;

    await requireGitProviderForActionState();
    const { orgBranch, sfUsername } = await resolveOrgBranchForStatus(flags['target-org'], flags['org-branch']);
    const prNumber = await selectSourcePullRequest(flags.pr, orgBranch, headless);
    const actionId = await selectRecoverableAction(prNumber, flags['action-id'], orgBranch, headless);

    uxLog("action", this, c.cyan(t('actionSetStatusClosing', { pr: prNumber, orgBranch })));
    const entry = await closeActionByHand(prNumber, actionId, orgBranch, sfUsername, flags.note);
    uxLog("success", this, c.green(t('actionSetStatusDone', { label: entry.actionLabel, orgBranch })));
    // Visible in the VS Code command runner, which hides plain log lines
    uxLog("action", this, c.cyan(entry.note || ''));
    if ((entry.stoppedActions || []).length > 0) {
      uxLog("warning", this, c.yellow(t('actionRunStoppedActionsLeft', { count: entry.stoppedActions!.length })));
    }
    WebSocketClient.sendRefreshPipelineMessage();
    return { outputString: 'Action status set', prNumber, actionId, orgBranch, status: entry.status, note: entry.note || '' };
  }
}
