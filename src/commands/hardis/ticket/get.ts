/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
import fs from '../../../common/utils/fsUtils.js';
import { isCI, uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import { TicketProvider, TicketProviderKey, ticketDetailsProviderKeys } from '../../../common/ticketProvider/index.js';
import { TicketDetails, renderTicketDetailsMarkdown } from '../../../common/ticketProvider/utils/ticketDetails.js';
import { TICKET_ERROR } from '../../../common/ticketProvider/utils/ticketOperations.js';
import { assertProjectAllowed, isTicketMarked, parseAllowedProjects } from '../../../common/ticketProvider/utils/ticketQualify.js';
import { t } from '../../../common/utils/i18n.js';

interface FetchOptions {
  providerKey: TicketProviderKey | undefined;
  downloadAttachments: boolean;
  attachmentsDir: string | undefined;
  maxAttachmentBytes: number;
  allowedProjects: string[] | null;
  marker: string | null;
  markerLabel: string | null;
  skipComments: boolean;
}

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class TicketGet extends SfCommand<any> {
  public static title = 'Get ticket';

  public static description = `
## Command Behavior

**Fetches a single ticket from JIRA, Azure Boards, ServiceNow or Aha! with everything attached to it, and returns it as structured JSON (and optionally as a markdown extract).**

Where \`collectTicketsInfo\` gathers a shallow summary of every ticket referenced by a Pull Request, this command does the opposite: **one** ticket, in full, so that a human (or an AI agent preparing an implementation) has the complete requirement without opening the ticketing system.

It returns:

- **Header fields:** type, status, priority, assignee, reporter, sprint, story points, labels, components, fix versions, parent, epic, and the key dates.
- **Description and acceptance criteria**, converted from the provider's HTML / ADF to readable plain text.
- **All comments**, in chronological order (paginated on JIRA and Aha!).
- **Subtasks and linked items**, with their status.
- **Attachments**, downloaded next to the report so images can be looked at and documents opened.
- **Possible manual actions:** the lines of the ticket mentioning an operation that deployable metadata will not carry (permission set assignment, org setting, scheduled job, data load...). Each one that survives the design phase should become an [sfdx-hardis deployment action](${'https://sfdx-hardis.cloudity.com/hardis/project/action/create/'}), so it is replayed in every org rather than done by hand once.

### Several tickets, identifiers, scope and marker

- \`--id a,b,c\` reads several tickets in one run (one start of the CLI for the whole batch). The JSON then holds \`tickets\`: one entry per identifier, in the order asked, either \`{id, status: "ok", ticket}\` or \`{id, status: "failed", error: {name, message}}\`. A failure never stops the others; the command fails only when no ticket could be read. With a single identifier the output stays \`ticket\`. \`--output-file\` needs a single identifier.
- \`project\`, \`assigneeId\`, \`reporterId\` and \`comments[].authorId\` carry the account ids, the same ones \`ticket whoami\` returns (JIRA Cloud \`accountId\`, JIRA Server / Data Center user name, Azure Boards identity id). On Azure Boards \`project\` is the team project of the work item itself, which may differ from the project of the repository.
- \`--allowed-projects a,b\` fails with \`TicketOutOfScope\` when the ticket belongs to another project (per ticket in a batch).
- \`--marker "<prefix>"\` and \`--marker-label <label>\` fill \`markedByMe\`: true when the ticket carries the label, or when the authenticated account already posted a comment starting with the prefix (emoji and whitespace ignored). Comments of other accounts never count. Without these flags \`markedByMe\` is null.
- \`--skip-comments\` does not return the comments (faster on long tickets). With \`--marker\` they are still read for the check.

### Provider detection

The ticketing system is deduced from the shape of the identifier, so \`--provider\` is only needed to disambiguate:

| Identifier | Provider | Example |
|------------|----------|---------|
| \`PROJECT-123\` | JIRA, or Aha! when \`ticketingProvider\` is \`AHA\` | \`--id ACME-4567\` |
| \`1234\` or \`AB-1234\` | Azure Boards | \`--id AB-4567\` |
| \`INC0012345\`, \`CHG...\`, \`RITM...\`, \`DMND...\` | ServiceNow | \`--id INC0012345\` |

### Configuration

The command reuses the ticketing variables sfdx-hardis already documents, read from CI/CD variables or from a local **.env** file:

- **JIRA:** \`JIRA_HOST\` + (\`JIRA_EMAIL\` + \`JIRA_TOKEN\`) or \`JIRA_PAT\` or (\`JIRA_CLIENT_ID\` + \`JIRA_CLIENT_SECRET\`)
- **Azure Boards:** a token only - \`CI_SFDX_HARDIS_AZURE_TOKEN\`, \`SYSTEM_ACCESSTOKEN\` or \`AZURE_DEVOPS_EXT_PAT\`. The organization and the project are read from the git remote of the current repository; set \`SYSTEM_COLLECTIONURI\` and \`SYSTEM_TEAMPROJECT\` only to override that (on a CI agent, Azure Pipelines already provides them).
- **ServiceNow:** \`SERVICENOW_URL\` + \`SERVICENOW_USERNAME\` + \`SERVICENOW_PASSWORD\`
- **Aha!:** \`AHA_HOST\` + \`AHA_API_KEY\`. An Aha! feature reference has the shape of a JIRA key: it is read from Aha! when \`ticketingProvider\` is \`AHA\` in **.sfdx-hardis.yml** or with \`--provider aha\`, and from JIRA otherwise.

<details markdown="1">
<summary>Technical explanations</summary>

- **Provider abstraction:** every connector is declared in the same \`allTicketProviders\` list, with the same static surface (\`providerKey\`, \`providerLabel\`, \`isAvailable\`, \`matchesTicketId\`, \`getTicketsFromString\`, \`supportsTicketDetails\`). \`TicketProvider.getTicketDetails()\` picks the connector that supports a deep fetch, whose identifier pattern matches, and whose credentials are configured, then delegates to that provider's \`getTicketDetails()\`. A matching connector may first complete its own configuration: Azure Boards parses \`origin\` with \`parseAzureRepoUrl()\` and fills the organization and project it finds there, so only a token has to be supplied locally. Values already set always win, and the git remote is only read when the identifier could belong to Azure Boards. An identifier that matches nothing, or that matches a provider with no credentials, raises an explicit error naming the missing configuration rather than returning an empty result.
- **Text conversion:** provider HTML (JIRA \`renderedFields\`, Azure Boards fields, ServiceNow journals, Aha! descriptions and comments) is converted to plain text with \`sanitize-html\`, and JIRA's Atlassian Document Format is walked as a fallback.
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
    '$ sf hardis:ticket:get --id PROD-12 --provider aha --agent --json',
    '$ sf hardis:ticket:get --id ACME-4567 --skip-attachments --agent --json',
    '$ sf hardis:ticket:get --id ACME-1,ACME-2,ACME-3 --allowed-projects ACME --marker "Automatic qualification" --marker-label ia-qualified --skip-attachments --agent --json',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    id: Flags.string({
      char: 'i',
      description: 'Ticket identifier: JIRA key or Aha! feature (ACME-123), Azure Boards work item (1234 or AB-1234) or ServiceNow number (INC0012345). Separate several identifiers with commas',
    }),
    provider: Flags.string({
      char: 'p',
      options: ticketDetailsProviderKeys(),
      description: 'Force the ticketing system instead of deducing it from the identifier',
    }),
    'output-file': Flags.string({
      char: 'f',
      description: 'Write a markdown extract of the ticket at this path (parent folders are created)',
    }),
    'attachments-dir': Flags.string({
      description: 'Folder the attachments are downloaded into. Defaults to a temporary folder, or to <output-file folder>/attachments when --output-file is set',
    }),
    'allowed-projects': Flags.string({
      description: 'Comma-separated projects the ticket must belong to (TicketOutOfScope otherwise)',
    }),
    marker: Flags.string({
      description: 'Comment prefix: markedByMe is true when the authenticated account already posted a comment starting with it',
    }),
    'marker-label': Flags.string({
      description: 'Label (Azure Boards tag): markedByMe is true when the ticket carries it',
    }),
    'skip-comments': Flags.boolean({
      default: false,
      description: 'Do not return the comments (faster on long tickets)',
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
    const ticketIds = (await this.resolveTicketId(flags.id, agentMode))
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const outputFile = flags['output-file'] || null;
    if (ticketIds.length > 1 && outputFile) {
      throw new SfError(t('ticketGetOutputFileSingleId'));
    }
    const attachmentsDir = flags['attachments-dir'] || (outputFile ? path.join(path.dirname(outputFile), 'attachments') : undefined);
    const fetchOptions: FetchOptions = {
      providerKey: flags.provider as TicketProviderKey | undefined,
      downloadAttachments: flags['skip-attachments'] !== true,
      attachmentsDir,
      maxAttachmentBytes: flags['max-attachment-size'] * 1024 * 1024,
      allowedProjects: parseAllowedProjects(flags['allowed-projects']),
      marker: flags.marker || null,
      markerLabel: flags['marker-label'] || null,
      skipComments: flags['skip-comments'] === true,
    };

    // Several identifiers: one start of the CLI for the whole batch, and a failure never stops the others
    if (ticketIds.length > 1) {
      const tickets: AnyJson[] = [];
      for (const id of ticketIds) {
        try {
          const ticket = await this.fetchTicket(id, fetchOptions);
          this.logSummary(ticket);
          tickets.push({ id, status: 'ok', ticket: ticket as unknown as AnyJson });
        } catch (e) {
          uxLog('warning', this, c.yellow(`[TicketGet] ${id}: ${(e as Error).message}`));
          tickets.push({ id, status: 'failed', error: { name: (e as Error).name || 'Error', message: (e as Error).message } });
        }
      }
      const fetched = tickets.filter((ticket: any) => ticket.status === 'ok').length;
      if (fetched === 0) {
        process.exitCode = 1;
      }
      return { outputString: t('ticketGetBatchSummary', { fetched, total: ticketIds.length }), tickets };
    }

    const ticketId = ticketIds[0] || '';
    const details = await this.fetchTicket(ticketId, fetchOptions);

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

  /** One ticket, with the scope check and the marker; every failure carries a stable name when it has one */
  private async fetchTicket(ticketId: string, options: FetchOptions): Promise<TicketDetails> {
    const details = await TicketProvider.getTicketDetails(ticketId, {
      providerKey: options.providerKey,
      downloadAttachments: options.downloadAttachments,
      attachmentsDir: options.attachmentsDir,
      maxAttachmentBytes: options.maxAttachmentBytes,
      // The prefix check needs the comments even when they are not returned
      skipComments: options.skipComments && !options.marker,
    });
    if (!details) {
      throw new SfError(t('ticketGetNotFound', { ticketId }), TICKET_ERROR.notFound);
    }
    assertProjectAllowed(details.id, details.project, options.allowedProjects);
    if (options.marker || options.markerLabel) {
      const myId = options.marker ? await this.myAccountId(ticketId, options.providerKey) : null;
      details.markedByMe = isTicketMarked({
        labels: details.labels,
        comments: details.comments.map((comment) => ({ authorId: comment.authorId ?? null, body: comment.body })),
        myId,
        prefix: options.marker,
        label: options.markerLabel,
      });
    }
    if (options.skipComments) {
      details.comments = [];
    }
    return details;
  }

  // The authenticated account does not change during a run: one call per ticketing system
  private accountIds = new Map<string, string | null>();

  private async myAccountId(ticketId: string, providerKey: TicketProviderKey | undefined): Promise<string | null> {
    const { provider, providerClass } = await TicketProvider.resolveProvider({ ticketId, providerKey });
    if (!this.accountIds.has(providerClass.providerKey)) {
      this.accountIds.set(providerClass.providerKey, (await provider.whoAmI()).id);
    }
    return this.accountIds.get(providerClass.providerKey) ?? null;
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
    uxLog('action', this, c.cyan(`[TicketGet] ${details.id} - ${details.subject}`));
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
