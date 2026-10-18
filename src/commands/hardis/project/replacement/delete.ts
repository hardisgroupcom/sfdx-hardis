/* jscpd:ignore-start */
import { Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { ReplacementCommandBase } from '../../../../common/replacementRules/replacementCommandBase.js';
import { replacementRuleLayerFlags } from '../../../../common/replacementRules/ruleFlags.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');
/* jscpd:ignore-end */

export default class ReplacementDelete extends ReplacementCommandBase {
  public static title = 'Delete replacement rule (Beta)';

  public static description = `
## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Removes a replacement rule, or an override of a rule, from one place (project config, branch config file or git provider issue).**

Removing an override from the issue gives back the rule of the repository: this is how a temporary fix made in the issue is undone. Removing the override of a built-in rule turns it back to its default state.

See [Replacement rules](https://sfdx-hardis.cloudity.com/salesforce-devops-config-replacement-rules/) for the full reference.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:replacement:delete --agent --layer issue --id partner-site-admin
\`\`\`

Required in agent mode: \`--layer\` (and \`--branch\` with \`--layer branch\`) and \`--id\`. The confirmation prompt is skipped.

<details markdown="1">
<summary>Technical explanations</summary>

- Project and branch rules are rewritten with \`js-yaml\`, keeping every other key; the \`replacementRules\` key is removed when it becomes empty.
- Issue rules are the YAML block of the issue body; the issue itself is kept.
</details>
`;

  public static examples = [
    '$ sf hardis:project:replacement:delete',
    '$ sf hardis:project:replacement:delete --agent --layer issue --id partner-site-admin',
    '$ sf hardis:project:replacement:delete --agent --layer branch --branch uat --id uat-hide-case-actions',
  ];

  public static flags: any = {
    ...replacementRuleLayerFlags(),
    id: Flags.string({ description: 'Id of the rule to remove' }),
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
    const { flags } = await this.parse(ReplacementDelete);
    const headless = flags.agent === true || isCI;
    const place = await this.resolvePlace(flags, headless);
    const rules = await this.readPlaceRules(place);
    if (rules.length === 0) {
      throw new SfError(t('replacementRulesNoRuleInPlace', { place: this.placeLabel(place) }));
    }
    const id: string = headless
      ? this.requireFlag(flags.id, 'id')
      : flags.id || (await this.promptSelect(t('replacementRulesSelectRuleToDelete'), rules.map((rule) => ({ title: rule.id, value: rule.id, description: rule.description || '' }))));
    if (!rules.some((rule) => rule.id === id)) {
      throw new SfError(t('replacementRulesRuleNotFound', { id, place: this.placeLabel(place) }));
    }
    if (!headless && !(await this.promptConfirm(t('replacementRulesConfirmDelete', { id, place: this.placeLabel(place) }), false))) {
      uxLog('action', this, c.yellow(t('replacementRulesDeleteCancelled')));
      return { outputString: 'Cancelled', deleted: false };
    }
    const location = await this.writePlaceRules(place, rules.filter((rule) => rule.id !== id));
    uxLog('action', this, c.green(t('replacementRulesRuleDeleted', { id, place: location })));
    return { outputString: `Replacement rule ${id} deleted`, deleted: true, id, layer: place.layer, branch: place.branch || null, location };
  }
}
