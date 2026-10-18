/* jscpd:ignore-start */
import { Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { uxLogTableWithReport } from '../../../../common/utils/filesUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import { ReplacementCommandBase } from '../../../../common/replacementRules/replacementCommandBase.js';
import { buildReplacementRulesInventory, summarizeRuleDefinitions } from '../../../../common/replacementRules/ruleInventory.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');
/* jscpd:ignore-end */

export default class ReplacementList extends ReplacementCommandBase {
  public static title = 'List replacement rules (Beta)';

  public static description = `
## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Lists the replacement rules of the project: the rules of every place, the effective rules of every target org, and the built-in rules.**

Read-only. With \`--json\`, the result holds:

- \`definitions\`: every rule as stored, with its place (\`project\`, \`branch\`, \`issue\`) and the lower places it changes.
- \`effective\`: for each major branch, and \`default\` (dev sandboxes and scratch orgs), the rules after the merge of the places, whether they apply, and where their value comes from. Secrets only show the CI/CD variable names they are read from, never a value.
- \`builtInRules\`: the elements removed according to the deployment API version of the target org, and their state.
- \`layers\`, \`majorBranches\`, \`secretLookups\`, \`issues\` (invalid rules).

The VS Code Replacement Rules panel reads this result.

See [Replacement rules](https://sfdx-hardis.cloudity.com/salesforce-devops-config-replacement-rules/) for the full reference.

### Agent Mode

\`\`\`sh
sf hardis:project:replacement:list --agent --json
\`\`\`

No prompt: the command is read-only. \`--skip-issue\` avoids the call to the git provider.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads \`config/.sfdx-hardis.yml\`, every \`config/branches/.sfdx-hardis.*.yml\` and the YAML block of the "sfdx-hardis Replacement Rules" issue of the git provider.
- The merge is the one of the deployments (\`mergeReplacementRules\`): built-in, project, branch file of the target, issue.
</details>
`;

  public static examples = [
    '$ sf hardis:project:replacement:list',
    '$ sf hardis:project:replacement:list --agent --json',
    '$ sf hardis:project:replacement:list --target-branch uat --json',
  ];

  public static flags: any = {
    'target-branch': Flags.string({ description: 'Only compute the effective rules of this major branch' }),
    'skip-issue': Flags.boolean({ default: false, description: 'Do not read the rules of the git provider issue' }),
    /* jscpd:ignore-start */
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
    /* jscpd:ignore-end */
  };

  public static requiresProject = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ReplacementList);
    uxLog('action', this, c.cyan(t('replacementRulesListing')));
    const inventory = await buildReplacementRulesInventory({
      targetBranch: flags['target-branch'] !== undefined ? flags['target-branch'] : undefined,
      skipIssue: flags['skip-issue'] === true,
    });
    const rows = summarizeRuleDefinitions(inventory.definitions);
    if (rows.length > 0) {
      await uxLogTableWithReport(this, rows, ['id', 'place', 'type', 'files', 'value', 'enabled'], { fileNamePrefix: 'replacement-rules' });
    } else {
      uxLog('log', this, c.grey(t('replacementRulesNoneDefined')));
    }
    if (inventory.layers.issue.error) {
      uxLog('warning', this, c.yellow(t('replacementRulesIssueUnreadable', { message: inventory.layers.issue.error })));
    }
    for (const issue of inventory.issues) {
      uxLog('warning', this, c.yellow(t('replacementRulesInvalidRule', { id: issue.ruleId || '', reason: issue.message })));
    }
    const enabledBuiltIns = inventory.builtInRules.filter((rule: any) => rule.enabled).length;
    uxLog('log', this, c.grey(t('replacementRulesBuiltInSummary', { enabled: enabledBuiltIns, total: inventory.builtInRules.length })));
    return { outputString: `${rows.length} replacement rules`, ...inventory };
  }
}
