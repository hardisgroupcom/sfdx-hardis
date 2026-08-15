import { Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { GitProvider } from '../../../../common/gitProvider/index.js';
import {
  DeploymentActionStateEntry,
  parseDeploymentActionsCommentBody,
} from '../../../../common/utils/deploymentActionsStateUtils.js';
import { resolvePrId } from '../../../../common/utils/actionUtils.js';
import { ActionCommandBase } from './base.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ActionState extends ActionCommandBase {
  public static title = 'Read deployment actions execution state';

  public static description = `
## Command Behavior

**Reads the per-org execution state of the deployment actions of a Pull Request.**

The state is stored in the "Deployment Actions" Pull Request comment maintained by sfdx-hardis, not in the repository. This command reads that comment and returns its parsed content, so tools that cannot read Pull Request comments (like the VS Code extension) can display the status matrix without reimplementing the parser.

For each action and each org branch, an entry reports whether the action has run, and how it went:

| Status    | Meaning                                            |
|-----------|----------------------------------------------------|
| \`success\` | The action ran successfully in that org            |
| \`failed\`  | The action ran and failed                          |
| \`manual\`  | Manual action waiting for a human to perform it    |
| \`skipped\` | The action did not apply to that org branch        |

An action with no entry for an org branch has not run there yet.

### Requirements

- A git provider token must be configured, since the state lives in a Pull Request comment.
- The Pull Request must exist. Use \`--pr-id current\` to resolve it from the current branch.

<details markdown="1">
<summary>Technical explanations</summary>

- Fetches the comment body with \`GitProvider.tryGetDeploymentActionsCommentBodyForPr\`.
- Parses it with \`parseDeploymentActionsCommentBody\`, the same parser used when actions run.
- Returns the entries plus the distinct org branches found, so callers can build the matrix columns without regrouping.
</details>
`;

  public static examples = [
    '$ sf hardis:project:action:state --pr-id 123',
    '$ sf hardis:project:action:state --pr-id current --json',
  ];

  public static flags: any = {
    'pr-id': Flags.string({
      description: 'Pull request ID. Use "current" to resolve it from the current branch',
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
    const { flags } = await this.parse(ActionState);
    const resolvedPrId = await resolvePrId(this, flags['pr-id'], true);
    const prNumber = Number(resolvedPrId);

    if (!resolvedPrId || isNaN(prNumber) || prNumber <= 0) {
      uxLog('warning', this, c.yellow(t('actionStateNoPullRequest')));
      return { outputString: 'No pull request to read deployment actions state from', entries: [], orgBranches: [] };
    }

    let entries: DeploymentActionStateEntry[] = [];
    try {
      const body = await GitProvider.tryGetDeploymentActionsCommentBodyForPr(prNumber);
      if (body) {
        entries = parseDeploymentActionsCommentBody(body);
      }
    } catch (e) {
      uxLog('warning', this, c.yellow(t('actionStateReadFailed', { pr: prNumber, message: (e as Error).message })));
      return { outputString: 'Could not read deployment actions state', entries: [], orgBranches: [] };
    }

    const orgBranches = [...new Set(entries.map((entry) => entry.orgBranch.trim()).filter(Boolean))];

    uxLog('action', this, c.cyan(t('actionStateHeader', { pr: prNumber })));

    if (entries.length === 0) {
      uxLog('log', this, c.grey(t('actionStateNoEntries', { pr: prNumber })));
      return { outputString: 'No deployment actions state found', prNumber, entries: [], orgBranches: [] };
    }

    uxLogTable(
      this,
      entries.map((entry) => ({
        Action: entry.actionLabel || entry.actionId,
        'Org Branch': entry.orgBranch,
        When: entry.when,
        Status: entry.status,
        Date: entry.date,
      })),
      ['Action', 'Org Branch', 'When', 'Status', 'Date']
    );

    return {
      outputString: `Found ${entries.length} deployment actions state entries`,
      prNumber,
      entries: entries as any,
      orgBranches,
    };
  }
}
