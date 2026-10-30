/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';
import { TicketProvider, TicketProviderKey, ticketDetailsProviderKeys } from '../../../common/ticketProvider/index.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class TicketWhoami extends SfCommand<any> {
  public static title = 'Show the ticketing account';

  public static description = `
## Command Behavior

**Shows the account the configured credentials authenticate as on the ticketing system, so that a script can check its setup before a run.**

- Returns the account id, the display name and the e-mail address (null when the system hides it).
- The id is the one \`ticket get\` returns in \`assigneeId\`, \`reporterId\` and \`comments[].authorId\`: comparing them tells which comments the authenticated account wrote.
- Without \`--provider\`, the only configured ticketing system is used.

### Supported ticketing systems

| Provider | Supported | Id returned |
|----------|-----------|-------------|
| JIRA Cloud | Yes | \`accountId\` |
| JIRA Server / Data Center | Yes | user name |
| Azure Boards | Yes | identity id (GUID) |
| ServiceNow | No: fails with \`TicketProviderNotSupported\` | |

### Errors

\`TicketProviderNotConfigured\` (no usable credential, or the credential is refused), \`TicketProviderNotSupported\`, \`TicketRateLimited\`.

<details markdown="1">
<summary>Technical explanations</summary>

- **JIRA:** \`jira.js\` \`myself.getCurrentUser\` (\`/rest/api/3/myself\` on Cloud, \`/rest/api/2/myself\` on Server / Data Center).
- **Azure Boards:** \`connectionData\` of the organization (\`azure-devops-node-api\` \`WebApi.connect\`), field \`authenticatedUser\`.
- A read answered 5xx is retried once.

</details>

### Agent Mode

The command never prompts:

\`\`\`sh
sf hardis ticket whoami --provider azure --agent --json
\`\`\`
`;

  public static examples = [
    '$ sf hardis:ticket:whoami',
    '$ sf hardis:ticket:whoami --provider jira --agent --json',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    provider: Flags.string({
      char: 'p',
      options: ticketDetailsProviderKeys(),
      description: 'Ticketing system to query. Defaults to the only one configured',
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

  // Independent from any Salesforce project or org
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(TicketWhoami);
    const { provider, providerClass } = await TicketProvider.resolveProvider({
      providerKey: flags.provider as TicketProviderKey | undefined,
    });
    const identity = await provider.whoAmI();
    uxLog('action', this, c.cyan(t('ticketWhoamiDone', { name: identity.displayName || identity.id || '-', provider: providerClass.providerLabel })));
    return { provider: providerClass.providerKey, ...identity } as unknown as AnyJson;
  }
}
