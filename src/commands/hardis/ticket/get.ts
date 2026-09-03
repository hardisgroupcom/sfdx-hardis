/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
import fs from '../../../common/utils/fsUtils.js';
import { isCI, uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import { TicketProvider, TicketDetailsProviderKey } from '../../../common/ticketProvider/index.js';
import { TicketDetails, renderTicketDetailsMarkdown } from '../../../common/ticketProvider/ticketDetails.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class TicketGet extends SfCommand<any> {
  public static title = 'Get ticket';

  public static description = `
## Command Behavior

**Fetches a single ticket from JIRA, Azure Boards or ServiceNow with everything attached to it, and returns it as structured JSON (and optionally as a markdown extract).**

Where \`collectTicketsInfo\` gathers a shallow summary of every ticket referenced by a Pull Request, this command does the opposite: **one** ticket, in full, so that a human (or an AI agent preparing an implementation) has the complete requirement without opening the ticketing system.

It returns:

- **Header fields:** type, status, priority, assignee, reporter, sprint, story points, labels, components, fix versions, parent, epic, and the key dates.
- **Description and acceptance criteria**, converted from the provider's HTML / ADF to readable plain text.
- **All comments**, in chronological order (paginated on JIRA).
- **Subtasks and linked items**, with their status.
- **Attachments**, downloaded next to the report so images can be looked at and documents opened.
- **Possible manual actions:** the lines of the ticket mentioning an operation that deployable metadata will not carry (permission set assignment, org setting, scheduled job, data load...). Each one that survives the design phase should become an [sfdx-hardis deployment action](${'https://sfdx-hardis.cloudity.com/hardis/project/action/create/'}), so it is replayed in every org rather than done by hand once.

### Provider detection

The ticketing system is deduced from the shape of the identifier, so \`--provider\` is only needed to disambiguate:

| Identifier | Provider | Example |
|------------|----------|---------|
| \`PROJECT-123\` | JIRA | \`--id ACME-4567\` |
| \`1234\` or \`AB-1234\` | Azure Boards | \`--id AB-4567\` |
| \`INC0012345\`, \`CHG...\`, \`RITM...\`, \`DMND...\` | ServiceNow | \`--id INC0012345\` |

### Configuration

The command reuses the ticketing variables sfdx-hardis already documents, read from CI/CD variables or from a local **.env** file:

- **JIRA:** \`JIRA_HOST\` + (\`JIRA_EMAIL\` + \`JIRA_TOKEN\`) or \`JIRA_PAT\` or (\`JIRA_CLIENT_ID\` + \`JIRA_CLIENT_SECRET\`)
- **Azure Boards:** \`SYSTEM_COLLECTIONURI\` + \`SYSTEM_TEAMPROJECT\` + (\`CI_SFDX_HARDIS_AZURE_TOKEN\` or \`SYSTEM_ACCESSTOKEN\`)
- **ServiceNow:** \`SERVICENOW_URL\` + \`SERVICENOW_USERNAME\` + \`SERVICENOW_PASSWORD\`

<details markdown="1">
<summary>Technical explanations</summary>

- **Provider abstraction:** \`TicketProvider.getTicketDetails()\` picks the connector whose identifier pattern matches and whose credentials are configured, then delegates to that provider's \`getTicketDetails()\`. An identifier that matches nothing, or that matches a provider with no credentials, raises an explicit error naming the missing configuration rather than returning an empty result.
- **Text conversion:** provider HTML (JIRA \`renderedFields\`, Azure Boards fields, ServiceNow journals) is converted to plain text with \`sanitize-html\`, and JIRA's Atlassian Document Format is walked as a fallback.
- **Attachment safety:** the download URL of an attachment comes from the ticket payload, which is user-controlled data. Before any credential is sent, the URL is checked to resolve to the same host as the ticketing instance the command authenticated against. The response is read through a size cap (\`--max-attachment-size\`, 20 MB by default), the file name is sanitized and the resolved path is verified to stay inside the target directory.
- **No sub-process:** downloaded content is never handed to an external converter. Text attachments are decoded in-process; images, PDFs and Office documents are saved as-is and reported through \`localPath\`, for the caller to open with its own tooling.
- **Proxy support:** every call goes through the shared proxy-aware HTTP client, so \`HTTP_PROXY\` / \`HTTPS_PROXY\` / \`NO_PROXY\` are honored.

</details>

### Agent Mode

Use \`--agent\` to disable all interactive prompts. In agent mode \`--id\` is required, and nothing is ever prompted.

Combine it with \`--json\` to get the machine-readable payload:

\`\`\`sh
sf hardis ticket get --id ACME-4567 --agent --json
\`\`\`
`;

  public static examples = [
    '$ sf hardis:ticket:get --id ACME-4567',
    '$ sf hardis:ticket:get --id ACME-4567 --agent --json',
    '$ sf hardis:ticket:get --id INC0012345 --output-file docs/INC0012345/ticket-extract.md',
    '$ sf hardis:ticket:get --id AB-4567 --provider azure --attachments-dir ./ticket-attachments',
    '$ sf hardis:ticket:get --id ACME-4567 --skip-attachments --agent --json',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    id: Flags.string({
      char: 'i',
      description: 'Ticket identifier: JIRA key (ACME-123), Azure Boards work item (1234 or AB-1234) or ServiceNow number (INC0012345)',
    }),
    provider: Flags.string({
      char: 'p',
      options: ['jira', 'azure', 'servicenow'],
      description: 'Force the ticketing system instead of deducing it from the identifier',
    }),
    'output-file': Flags.string({
      char: 'f',
      description: 'Write a markdown extract of the ticket at this path (parent folders are created)',
    }),
    'attachments-dir': Flags.string({
      description: 'Folder the attachments are downloaded into. Defaults to a temporary folder, or to <output-file folder>/attachments when --output-file is set',
    }),
    'skip-attachments': Flags.boolean({
      default: false,
      description: 'List the attachments without downloading them',
    }),
    'max-attachment-size': Flags.integer({
      default: 20,
      description: 'Maximum size in MB read from a single attachment. Bigger files are truncated',
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

  // Reading a ticket is independent from any Salesforce project or org
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(TicketGet);
    const agentMode = flags.agent === true;
    const ticketId = await this.resolveTicketId(flags.id, agentMode);
    const outputFile = flags['output-file'] || null;
    const attachmentsDir = flags['attachments-dir'] || (outputFile ? path.join(path.dirname(outputFile), 'attachments') : undefined);

    const details = await TicketProvider.getTicketDetails(ticketId, {
      providerKey: flags.provider as TicketDetailsProviderKey | undefined,
      downloadAttachments: flags['skip-attachments'] !== true,
      attachmentsDir,
      maxAttachmentBytes: flags['max-attachment-size'] * 1024 * 1024,
    });

    if (!details) {
      throw new SfError(t('ticketGetNotFound', { ticketId }));
    }

    let writtenFile: string | null = null;
    if (outputFile) {
      await fs.ensureDir(path.dirname(path.resolve(outputFile)));
      await fs.outputFile(outputFile, renderTicketDetailsMarkdown(details));
      writtenFile = outputFile;
      uxLog('action', this, c.cyan(t('ticketGetExtractWritten', { file: outputFile })));
    }

    this.logSummary(details);

    return {
      outputString: `Fetched ${details.provider} ticket ${details.id}`,
      // TicketDetails is a declared interface, not an index-signature map: cast for the AnyJson result
      ticket: details as unknown as AnyJson,
      outputFile: writtenFile,
    };
  }

  private async resolveTicketId(flagValue: string | undefined, agentMode: boolean): Promise<string> {
    if (flagValue) {
      return flagValue.trim();
    }
    if (isCI || agentMode) {
      throw new SfError(t('ticketGetIdRequired'));
    }
    const answer = await prompts({
      type: 'text',
      message: t('ticketGetPromptId'),
      description: t('ticketGetPromptIdDescription'),
      placeholder: 'ACME-4567',
    });
    const value = (answer?.value || '').trim();
    if (!value) {
      throw new SfError(t('ticketGetIdRequired'));
    }
    return value;
  }

  /** Short console recap: the full payload is in --json, the log only needs to say what was found */
  private logSummary(details: TicketDetails): void {
    uxLog('action', this, c.cyan(`[TicketGet] ${details.id} — ${details.subject}`));
    uxLog(
      'log',
      this,
      c.grey(
        t('ticketGetSummary', {
          status: details.status || '-',
          type: details.type || '-',
          comments: details.comments.length,
          attachments: details.attachments.length,
          links: details.links.length + details.subtasks.length,
        })
      )
    );
    const failedAttachments = details.attachments.filter((attachment) => attachment.error);
    for (const attachment of failedAttachments) {
      uxLog('warning', this, c.yellow(`[TicketGet] ${attachment.filename}: ${attachment.error}`));
    }
    if (details.manualActions.length > 0) {
      uxLog('warning', this, c.yellow('[TicketGet] ' + t('ticketGetManualActionsFound', { count: details.manualActions.length })));
    }
  }
}
