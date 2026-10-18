/* jscpd:ignore-start */
import { Flags } from '@salesforce/sf-plugins-core';
import { Messages, Org, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { uxLogTableWithReport } from '../../../../common/utils/filesUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import { ReplacementCommandBase } from '../../../../common/replacementRules/replacementCommandBase.js';
import { applyReplacementRules } from '../../../../common/replacementRules/ruleEngine.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');
/* jscpd:ignore-end */

export default class ReplacementPreview extends ReplacementCommandBase {
  public static title = 'Preview replacement rules (Beta)';

  public static description = `
## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Shows what the replacement rules would change in the local files for a deployment to a target org. Nothing is written.**

- \`--target-branch\` picks the major branch of the target org. Without it, the preview is the one of a dev sandbox or scratch org (\`default\` values).
- Built-in rules need the deployment API version of the target: \`--api-version\`, or \`--target-org\` to read it from the org, or the \`org-api-version\` sf config. Without any of them, built-in rules are skipped.
- Secrets are read from the environment like in a deployment job. Their values are never shown: a missing variable is reported with the names that were looked up.
- Every file of the package directories is checked, not only the files of a delta deployment.

See [Replacement rules](https://sfdx-hardis.cloudity.com/salesforce-devops-config-replacement-rules/) for the full reference.

### Agent Mode

\`\`\`sh
sf hardis:project:replacement:preview --agent --target-branch uat --api-version 67.0 --json
\`\`\`

No prompt. Without \`--target-branch\`, the dev sandbox target is used.

<details markdown="1">
<summary>Technical explanations</summary>

- Runs the engine of the deployments (\`applyReplacementRules\`) with \`write: false\`.
- The result lists, for each file and rule: \`changed\`, \`unchanged\`, \`not-found\` or \`risky-element\` (an element a disabled built-in rule would remove), plus the warnings a Pull Request comment would show.
</details>
`;

  public static examples = [
    '$ sf hardis:project:replacement:preview --target-branch uat',
    '$ sf hardis:project:replacement:preview --agent --target-branch main --api-version 67.0 --json',
    '$ sf hardis:project:replacement:preview --target-branch preprod --target-org my.user@example.com.preprod',
  ];

  public static flags: any = {
    'target-branch': Flags.string({ description: 'Major branch of the target org. Omitted: a dev sandbox or scratch org' }),
    'target-org': Flags.string({ char: 'o', description: 'Username or alias of the target org, to read its deployment API version' }),
    'api-version': Flags.string({ description: 'Deployment API version of the target org, for example 67.0' }),
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
    const { flags } = await this.parse(ReplacementPreview);
    let apiVersion: number | null = null;
    if (flags['api-version']) {
      apiVersion = parseFloat(flags['api-version']);
      if (!Number.isFinite(apiVersion)) {
        throw new SfError(t('replacementRulesBadApiVersion', { value: flags['api-version'] }));
      }
    }
    const conn = flags['target-org'] ? (await Org.create({ aliasOrUsername: flags['target-org'] })).getConnection() : null;
    const session = await applyReplacementRules({
      targetBranch: flags['target-branch'] || null,
      apiVersion,
      conn,
      write: false,
      commandThis: this,
    });
    const report = session.report;
    const rows = report.results
      .filter((result) => result.status !== 'not-found')
      .map((result) => ({ file: result.file, rule: result.ruleId, result: result.status, detail: result.detail || '' }));
    if (rows.length > 0) {
      await uxLogTableWithReport(this, rows, ['file', 'rule', 'result', 'detail'], { fileNamePrefix: 'replacement-rules-preview' });
    } else {
      uxLog('log', this, c.grey(t('replacementRulesPreviewNothing', { target: report.target.label })));
    }
    return {
      outputString: `${report.appliedRules.length} replacement rules would apply to ${report.target.label}`,
      target: report.target as any,
      results: report.results as any,
      warnings: report.warnings as any,
      appliedRules: report.appliedRules as any,
      skipped: report.skipped || null,
    };
  }
}
