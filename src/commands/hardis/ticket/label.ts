/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';
import { TicketProvider, TicketProviderKey, ticketDetailsProviderKeys } from '../../../common/ticketProvider/index.js';
import { TICKET_ERROR, validateTicketLabel } from '../../../common/ticketProvider/utils/ticketOperations.js';
import { assertProjectAllowed, parseAllowedProjects } from '../../../common/ticketProvider/utils/ticketQualify.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class TicketLabel extends SfCommand<any> {
  public static title = 'Label a ticket';

  public static description = `
## Command Behavior

**Adds a label to a ticket (a tag on Azure Boards), without posting anything else, so that a script can flag a ticket it could not process.**

- The label is added on top of the existing ones; a label already there (any case on Azure Boards) is left as is.
- JIRA refuses labels containing spaces: such a label is refused before any call.
- \`--allowed-projects a,b\` reads the ticket first and fails with \`TicketOutOfScope\`, writing nothing, when it belongs to another project.

### Errors

\`TicketProviderNotConfigured\`, \`TicketProviderNotSupported\` (ServiceNow), \`TicketNotFound\`, \`TicketOutOfScope\`, \`TicketRateLimited\`.

<details markdown="1">
<summary>Technical explanations</summary>

- **JIRA:** \`issues.editIssue\` with \`update.labels.add\`, the step \`ticket comment\` and \`ticket attach\` already use.
- **Azure Boards:** JSON patch of \`System.Tags\`, guarded by a \`test\` on the revision read just before.

</details>

### Agent Mode

The command never prompts. \`--id\` and \`--label\` are required:

\`\`\`sh
sf hardis ticket label --id ACME-123 --label ia-qualif-erreur --allowed-projects ACME --agent --json
\`\`\`
`;

  public static examples = [
    '$ sf hardis:ticket:label --id ACME-123 --label ia-qualif-erreur',
    '$ sf hardis:ticket:label --id AB-4567 --label ia-qualif-erreur --allowed-projects "My Project" --agent --json',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    id: Flags.string({
      char: 'i',
      required: true,
      description: 'Ticket identifier (JIRA key such as ACME-123, or Azure Boards work item such as 1234 or AB-1234)',
    }),
    label: Flags.string({
      required: true,
      description: 'Label (Azure Boards tag) added to the ticket',
    }),
    'allowed-projects': Flags.string({
      description: 'Comma-separated projects the ticket must belong to (TicketOutOfScope otherwise)',
    }),
    provider: Flags.string({
      char: 'p',
      options: ticketDetailsProviderKeys(),
      description: 'Force the ticketing system instead of deducing it from the identifier',
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
    const { flags } = await this.parse(TicketLabel);
    const ticketId = flags.id.trim();
    const label = validateTicketLabel(flags.label);
    if (label === null) {
      throw new SfError(t('ticketLabelInvalid', { label: flags.label }));
    }
    const allowedProjects = parseAllowedProjects(flags['allowed-projects']);
    const { provider, providerClass } = await TicketProvider.resolveProvider({
      ticketId,
      providerKey: flags.provider as TicketProviderKey | undefined,
    });
    const ticketKey = provider.normalizeTicketId(ticketId);
    if (allowedProjects) {
      const details = await provider.getTicketDetails(ticketId, { downloadAttachments: false, skipComments: true });
      if (!details) {
        throw new SfError(t('ticketNotFound', { ticketId: ticketKey }), TICKET_ERROR.notFound);
      }
      assertProjectAllowed(ticketKey, details.project, allowedProjects);
    }
    await provider.addTicketLabel(ticketKey, label);
    uxLog('action', this, c.cyan(t('ticketLabelDone', { label, ticketId: ticketKey })));
    return { provider: providerClass.providerKey, ticket: ticketKey, label: { status: 'done', value: label } } as unknown as AnyJson;
  }
}
