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

The payload contains:

- One **entry per configurable key** (monitoring commands and standalone notification types), with translated \`title\` and \`description\`, the default \`frequency\` / scheduling fields (when applicable), and the default per-channel severity thresholds (\`messaging\`, \`email\`, \`api\`).
- The **option lists** the UI can use to populate dropdowns: supported frequencies, weekdays, severity thresholds, and channel names.

This command is **read-only**, requires no Salesforce org, and produces no notifications. It does not read \`.sfdx-hardis.yml\` -- callers are expected to read the user configuration file directly and merge it on top of the returned defaults using the same merge-by-key semantics as the runtime.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:config:monitoring-defaults --agent --json
\`\`\`

In agent mode, the command behaves identically (no interactive prompts exist) and is intended to be paired with \`--json\` for programmatic consumption.

<details markdown="1">
<summary>Technical explanations</summary>

The data is assembled in \`getMonitoringConfigDefaults()\` (\`src/common/monitoring/monitoringDefaults.ts\`):

- Each entry in \`monitoringCommandsDefault\` becomes a \`monitoringCommand\` entry with its scheduling fields and resolved notification thresholds (looked up in \`notificationDefaults\`).
- Each notification type emitted outside of \`monitor:all\` (BACKUP, DEPLOYMENT, RELEASE_NOTES, MONITORING_SUMMARY, etc.) becomes a \`notificationType\` entry with just the routing thresholds.
- Titles and descriptions are resolved via \`t()\` using keys named \`notifTypeTitle<PascalCaseKey>\` and \`notifTypeDesc<PascalCaseKey>\`. The active language is governed by the \`SFDX_HARDIS_LANG\` environment variable.
- Channel thresholds fall back to \`messaging: info\`, \`email: info\`, \`api: log\` when a key has no entry in \`notificationDefaults\`.
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

  public async run(): Promise<AnyJson> {
    await this.parse(ConfigMonitoringDefaults);
    const payload = getMonitoringConfigDefaults();
    uxLog("other", this, JSON.stringify(payload));
    return payload as unknown as AnyJson;
  }
}
