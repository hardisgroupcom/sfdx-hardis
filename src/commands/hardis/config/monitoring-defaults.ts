import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { uxLog } from '../../../common/utils/index.js';
import { getMonitoringConfigDefaults } from '../../../common/monitoring/monitoringDefaults.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ConfigMonitoringDefaults extends SfCommand<any> {
  public static title = 'Get monitoring & notification defaults';

  public static description = `Returns the hardcoded default monitoring and notification configuration baked into sfdx-hardis.

## Command Behavior

**Exposes the built-in defaults consumed by \`hardis:org:monitor:all\` so configuration UIs (e.g. the [VS Code sfdx-hardis extension](${'https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis'})) can build configuration screens without duplicating the data.**

The payload contains two independent lists plus shared metadata:

- \`monitoringCommands[]\` -- one entry per scheduled command in \`monitor:all\`. Each entry has a translated \`title\` and \`description\`, a \`category\` foreign key, an \`icon\` string (SLDS, e.g. \`utility:dashboard\`), the default \`frequency\` / scheduling fields, and a \`notificationTypes\` array of notification type keys the command can emit (a single command can emit multiple types, e.g. \`APEX_FLOW_ERRORS\` emits both \`APEX_ERROR\` and \`FLOW_ERROR\`). Routing thresholds are NOT carried here -- they live on \`notificationConfig[]\`.
- \`notificationConfig[]\` -- one entry per notification type sfdx-hardis can emit (whether or not a scheduled command emits it). Each entry has a translated \`title\` and \`description\`, a \`category\` foreign key, an \`icon\` string (SLDS, e.g. \`utility:dashboard\`), the default per-channel severity thresholds (\`messaging\`, \`email\`, \`api\`), and an \`availableThresholds\` array listing the only thresholds that can actually fire for this type (sorted from most restrictive to least restrictive, terminated by \`off\`). Configuration UIs should drive their per-channel threshold selectors from this per-type \`availableThresholds\` list rather than from the global \`options.thresholds\` -- any value outside the list is implicitly equivalent to one that is. This is the single source of truth for notification routing.
- \`categories[]\` -- the seven categories used to group both lists in configuration UIs (\`orgActivity\`, \`apexTestsSecurity\`, \`userActivity\`, \`technicalDebt\`, \`orgInfo\`, \`licensesPackages\`, \`other\`), each with a translated \`title\`, \`description\`, and a stable \`order\`.
- \`options\` -- the lists the UI can use to populate dropdowns: supported frequencies, weekdays, severity thresholds, and channel names.

This command is **read-only**, requires no Salesforce org, and produces no notifications. It does not read \`.sfdx-hardis.yml\` -- callers are expected to read the user configuration file directly and merge \`monitoringCommands:\` onto the defaults' \`monitoringCommands[]\` and \`notificationConfig:\` onto the defaults' \`notificationConfig[]\`, both by \`key\`.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:config:monitoring-defaults --agent --json
\`\`\`

In agent mode, the command behaves identically (no interactive prompts exist) and is intended to be paired with \`--json\` for programmatic consumption.

<details markdown="1">
<summary>Technical explanations</summary>

The data is assembled in \`getMonitoringConfigDefaults()\` (\`src/common/monitoring/monitoringDefaults.ts\`):

- Each entry in \`monitoringCommandsDefault\` becomes a \`monitoringCommands[]\` entry. Its category and icon are inherited from the first notification type it emits (via \`notificationTypesDefault\` in \`src/common/notifProvider/types.ts\`), unless the command entry declares its own \`category\` / \`icon\` (used by aggregate commands like \`APEX_FLOW_ERRORS\`).
- Every key in \`notificationTypesDefault\` becomes a \`notificationConfig[]\` entry. \`notificationTypesDefault\` is the single source of truth for per-type metadata -- it carries \`category\`, \`icon\` (SLDS), \`emittedSeverities\` (which drives the \`availableThresholds\` array), and \`defaults\` (per-channel routing thresholds). When a channel is missing from a type's \`defaults\` block, fallbacks of \`messaging: info\`, \`email: info\`, \`api: log\` apply. Defaults are clamped through \`clampThresholdToAvailable()\` so the payload never reports a threshold a channel cannot honour at runtime.
- Titles and descriptions are resolved via \`t()\` using keys named \`notifTypeTitle<PascalCaseKey>\` / \`notifTypeDesc<PascalCaseKey>\` for both lists and \`notifCategoryTitle<PascalCaseKey>\` / \`notifCategoryDesc<PascalCaseKey>\` for categories. The active language is governed by the \`SFDX_HARDIS_LANG\` environment variable.
</details>
`;

  public static examples = [
    '$ sf hardis:config:monitoring-defaults --json',
    '$ sf hardis:config:monitoring-defaults --agent --json',
  ];

  public static flags: any = {
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
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    /* jscpd:ignore-end */
  };

  public static requiresProject = false;
  public static disableWebsocket = true;

  public async run(): Promise<AnyJson> {
    await this.parse(ConfigMonitoringDefaults);
    const payload = getMonitoringConfigDefaults();
    uxLog("other", this, JSON.stringify(payload));
    return payload as unknown as AnyJson;
  }
}
