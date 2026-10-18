/* jscpd:ignore-start */
import { Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { ReplacementCommandBase } from '../../../../common/replacementRules/command/replacementCommandBase.js';
import { validateReplacementRule } from '../../../../common/replacementRules/config/ruleConfig.js';
import { checkRulePlace } from '../../../../common/replacementRules/config/ruleUpdateUtils.js';
import {
  applyRuleFields,
  buildRuleFieldsFromFlags,
  readRuleFromFlags,
  replacementRuleFieldFlags,
  replacementRuleLayerFlags,
} from '../../../../common/replacementRules/command/ruleFlags.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');
/* jscpd:ignore-end */

export default class ReplacementCreate extends ReplacementCommandBase {
  public static title = 'Create replacement rule (Beta)';

  public static description = `
## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Adds a replacement rule: a change applied to the metadata files right before each deployment, for the org the deployment goes to.**

A rule does one of three things:

- \`xml-value\`: writes the target org's value in an XML element, whatever git holds (for example the endpoint of a Named Credential).
- \`xml-remove\`: removes an XML element before deploying (for example one user permission of a Profile: \`Profile/userPermissions[name=ViewSetup]\`).
- \`text\`: finds and replaces a text or a regular expression in any file (Apex, LWC, JSON...).

Its value is the same for every org (\`--value\`), one per target branch with a \`default\` (\`--value-for uat=... --value-for default=...\`), or a secret read from a CI/CD variable (\`--secret NAME\`: NAME_<BRANCH> is read first, then NAME). Secret values are never written anywhere and are masked in every log.

The rule is stored in one place:

- \`project\`: \`config/.sfdx-hardis.yml\`
- \`branch\`: \`config/branches/.sfdx-hardis.<branch>.yml\`, applied only when deploying to that branch
- \`issue\`: the "sfdx-hardis Replacement Rules" issue of the git provider (work item on Azure DevOps, Pull Request on Bitbucket), applied at the next deployment job without any commit. It is read only when its author has write access to the repository, and its rules cannot use \`secret\`

See [Replacement rules](https://sfdx-hardis.cloudity.com/salesforce-devops-config-replacement-rules/) for the full reference.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:replacement:create --agent --layer project --id payment-api-endpoint --type xml-value --files "**/namedCredentials/Payment_API.namedCredential-meta.xml" --xml-path NamedCredential/endpoint --value-for main=https://pay.example.com --value-for default=https://pay-sandbox.example.com
\`\`\`

Required in agent mode: \`--layer\` (and \`--branch\` with \`--layer branch\`), then either \`--rule-file\` / \`--rule\` (whole rule as JSON) or the field flags with at least \`--id\`, \`--type\` and \`--files\`. Every prompt is skipped.

<details markdown="1">
<summary>Technical explanations</summary>

- Project and branch rules are written under the \`replacementRules\` key with \`js-yaml\`, keeping every other key.
- Issue rules are the YAML block of the issue body (\`getDashboardBody\` / \`updateDashboardBody\` of the git provider); the issue is created when missing.
- The rule is validated before being written (\`validateReplacementRule\`): an id already used in the same place is refused, use \`hardis:project:replacement:update\`.
</details>
`;

  public static examples = [
    '$ sf hardis:project:replacement:create',
    '$ sf hardis:project:replacement:create --agent --layer project --id payment-api-endpoint --type xml-value --files "**/namedCredentials/Payment_API.namedCredential-meta.xml" --xml-path NamedCredential/endpoint --value-for main=https://pay.example.com --value-for default=https://pay-sandbox.example.com',
    '$ sf hardis:project:replacement:create --agent --layer project --id payment-api-password --type xml-value --files "**/namedCredentials/Payment_API.namedCredential-meta.xml" --xml-path NamedCredential/password --secret PAYMENT_API_PASSWORD',
    '$ sf hardis:project:replacement:create --agent --layer project --id remove-view-setup-in-production --type xml-remove --files "**/profiles/*.profile-meta.xml" --xml-path "Profile/userPermissions[name=ViewSetup]" --include-branches main',
    '$ sf hardis:project:replacement:create --agent --layer branch --branch uat --id uat-hide-case-actions --type xml-remove --files "**/layouts/Case-*.layout-meta.xml" --xml-path Layout/platformActionList',
    '$ sf hardis:project:replacement:create --agent --layer issue --rule-file ./rule.json',
  ];

  public static flags: any = {
    ...replacementRuleLayerFlags(),
    id: Flags.string({ description: 'Id of the rule: lowercase letters, digits and "-"' }),
    ...replacementRuleFieldFlags(),
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
    const { flags } = await this.parse(ReplacementCreate);
    const headless = flags.agent === true || isCI;
    const place = await this.resolvePlace(flags, headless);

    let rule = await readRuleFromFlags(flags);
    if (!rule) {
      const { fields, removedValueKeys, hasFields } = buildRuleFieldsFromFlags(flags);
      if (hasFields || headless) {
        rule = applyRuleFields({ id: this.requireFlag(flags.id, 'id') }, fields, removedValueKeys);
      } else {
        rule = await this.promptNewRule(flags.id);
      }
    } else if (flags.id) {
      rule.id = flags.id;
    }

    const error = validateReplacementRule(rule) || checkRulePlace(rule, place);
    if (error) {
      throw new SfError(t('replacementRulesInvalidRule', { id: rule.id || '', reason: error }));
    }
    const rules = await this.readPlaceRules(place);
    if (rules.some((existing) => existing.id === rule.id)) {
      throw new SfError(t('replacementRulesIdAlreadyExists', { id: rule.id, place: this.placeLabel(place) }));
    }
    const location = await this.writePlaceRules(place, [...rules, rule]);
    uxLog('action', this, c.green(t('replacementRulesRuleSaved', { id: rule.id, place: location })));
    this.logRuleSummary(rule);
    return { outputString: `Replacement rule ${rule.id} created`, rule: rule as any, layer: place.layer, branch: place.branch || null, location };
  }
}
