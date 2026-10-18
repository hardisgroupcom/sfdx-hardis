/* jscpd:ignore-start */
import { Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { ReplacementCommandBase } from '../../../../common/replacementRules/replacementCommandBase.js';
import { upsertRuleInList } from '../../../../common/replacementRules/ruleConfig.js';
import { checkRuleUpdate, listKnownRuleIds } from '../../../../common/replacementRules/ruleUpdateUtils.js';
import {
  applyRuleFields,
  buildRuleFieldsFromFlags,
  readRuleFromFlags,
  replacementRuleFieldFlags,
  replacementRuleLayerFlags,
} from '../../../../common/replacementRules/ruleFlags.js';
import { ReplacementRule } from '../../../../common/replacementRules/types.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');
/* jscpd:ignore-end */

export default class ReplacementUpdate extends ReplacementCommandBase {
  public static title = 'Update replacement rule (Beta)';

  public static description = `
## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Changes a replacement rule in one place (project config, branch config file or git provider issue).**

- With \`--rule-file\` or \`--rule\`, the rule stored in that place is replaced by the given one.
- With field flags, only those fields change. Setting one value source (\`--value\`, \`--value-for\`, \`--secret\`) removes the other ones; \`--value-for uat=\` removes the value of one target; \`--unset <field>\` removes a field.
- When the rule is not stored in that place yet, an override is created there: it changes only the given fields of the rule defined in a lower place. Places merge in this order: built-in rules, project, branch file of the target, issue.
- Built-in rules (ids starting with \`builtin-\`) can only be turned on or off: \`--id builtin-flow-ends --enabled false\`.

See [Replacement rules](https://sfdx-hardis.cloudity.com/salesforce-devops-config-replacement-rules/) for the full reference.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:replacement:update --agent --layer issue --id partner-site-admin --value-for preprod=site.admin@example.com.preprod
sf hardis:project:replacement:update --agent --layer project --id builtin-flow-schedule-day-of-month --enabled false
\`\`\`

Required in agent mode: \`--layer\` (and \`--branch\` with \`--layer branch\`), \`--id\`, and \`--rule-file\` / \`--rule\` or at least one field flag. Every prompt is skipped.

<details markdown="1">
<summary>Technical explanations</summary>

- A full rule (one with a \`type\`) is validated before being written; an override must target a rule that exists in another place or in the built-in list.
- Project and branch rules are written with \`js-yaml\`, keeping every other key; issue rules are the YAML block of the issue body.
</details>
`;

  public static examples = [
    '$ sf hardis:project:replacement:update',
    '$ sf hardis:project:replacement:update --agent --layer project --id payment-api-endpoint --value-for preprod=https://pay-staging.example.com',
    '$ sf hardis:project:replacement:update --agent --layer issue --id payment-api-endpoint --enabled false',
    '$ sf hardis:project:replacement:update --agent --layer project --id builtin-flow-ends --enabled false',
    '$ sf hardis:project:replacement:update --agent --layer project --id payment-api-endpoint --rule-file ./rule.json',
  ];

  public static flags: any = {
    ...replacementRuleLayerFlags(),
    id: Flags.string({ description: 'Id of the rule to change' }),
    ...replacementRuleFieldFlags(),
    unset: Flags.string({ multiple: true, description: 'Field to remove from the stored rule (can be repeated), for example includeTargetBranches' }),
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
    const { flags } = await this.parse(ReplacementUpdate);
    const headless = flags.agent === true || isCI;
    const place = await this.resolvePlace(flags, headless);
    const id: string = headless
      ? this.requireFlag(flags.id, 'id')
      : flags.id || (await this.promptSelect(t('replacementRulesSelectRuleToUpdate'), (await listKnownRuleIds()).map((ruleId) => ({ title: ruleId, value: ruleId }))));

    const rules = await this.readPlaceRules(place);
    const existing = rules.find((rule) => rule.id === id);
    let updated: ReplacementRule;
    const wholeRule = await readRuleFromFlags(flags);
    const { fields, removedValueKeys, hasFields } = buildRuleFieldsFromFlags(flags);
    if (wholeRule) {
      updated = { ...wholeRule, id };
    } else if (hasFields || (flags.unset || []).length > 0) {
      updated = applyRuleFields(existing || { id }, fields, removedValueKeys, flags.unset || []);
    } else if (headless) {
      throw new SfError(t('replacementRulesNothingToUpdate'));
    } else {
      updated = await this.promptRuleChanges(existing || { id });
    }

    const problem = await checkRuleUpdate(updated, place);
    if (problem) {
      throw new SfError(t('replacementRulesInvalidRule', { id, reason: problem }));
    }
    const location = await this.writePlaceRules(place, upsertRuleInList(rules, updated, 'replace'));
    uxLog('action', this, c.green(t('replacementRulesRuleSaved', { id, place: location })));
    this.logRuleSummary(updated);
    return { outputString: `Replacement rule ${id} updated`, rule: updated as any, layer: place.layer, branch: place.branch || null, location };
  }

  /** Change the fields of a stored rule one at a time, until the user is done */
  private async promptRuleChanges(rule: ReplacementRule): Promise<ReplacementRule> {
    const updated: ReplacementRule = { ...rule };
    for (; ;) {
      const field = await this.promptSelect(t('replacementRulesSelectFieldToChange', { id: rule.id }), [
        { title: t('replacementRulesFieldEnabled', { state: updated.enabled === false ? 'off' : 'on' }), value: 'enabled' },
        { title: t('replacementRulesFieldValue'), value: 'value' },
        { title: t('replacementRulesFieldDescription'), value: 'description' },
        { title: t('replacementRulesFieldFiles'), value: 'files' },
        { title: t('replacementRulesFieldTarget'), value: 'target' },
        { title: t('replacementRulesFieldDone'), value: 'done' },
      ]);
      if (!field || field === 'done') {
        return updated;
      }
      if (field === 'enabled') {
        updated.enabled = await this.promptConfirm(t('replacementRulesEnableRule', { id: rule.id }), updated.enabled !== false);
      } else if (field === 'value') {
        await this.promptValueSource(updated);
      } else if (field === 'description') {
        updated.description = await this.promptText(t('replacementRulesEnterDescription'), updated.description || '');
      } else if (field === 'files') {
        updated.files = (await this.promptText(t('replacementRulesEnterFiles'), Array.isArray(updated.files) ? updated.files.join(',') : updated.files || '')).trim();
      } else if (field === 'target') {
        if (updated.type === 'text') {
          updated.find = await this.promptText(t('replacementRulesEnterFind'), updated.find || '');
          updated.regex = await this.promptConfirm(t('replacementRulesFindIsRegex'), updated.regex === true);
        } else {
          updated.xmlPath = (await this.promptText(t('replacementRulesEnterXmlPath'), updated.xmlPath || '')).trim();
        }
      }
    }
  }
}
