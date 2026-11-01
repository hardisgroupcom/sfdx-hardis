/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
import fs from '../../../common/utils/fsUtils.js';
import { uxLog } from '../../../common/utils/index.js';
import { uxLogTableWithReport } from '../../../common/utils/filesUtils.js';
import { TicketProvider, TicketProviderKey, ticketDetailsProviderKeys } from '../../../common/ticketProvider/index.js';
import {
  TICKET_ERROR,
  TICKET_SEARCH_ORDER_FIELDS,
  TicketSearchCriteria,
  TicketSearchOrderField,
  TicketSearchResult,
  hasSearchFilter,
  parseSearchDate,
} from '../../../common/ticketProvider/utils/ticketOperations.js';
import { isProjectAllowed, parseAllowedProjects, scopeSearchProjects } from '../../../common/ticketProvider/utils/ticketQualify.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

/** JSON result of the command. Key names and order are part of the contract: do not change them */
export function buildTicketListResult(providerKey: string, criteria: TicketSearchCriteria, search: TicketSearchResult) {
  return {
    provider: providerKey,
    criteria,
    totalFetched: search.tickets.length,
    nextPageToken: search.nextPageToken,
    truncated: search.truncated,
    tickets: search.tickets,
    // Added last, so the keys above keep their order: set when nothing matched
    warning: search.warning || null,
  };
}

/** "a, b,,c" -> ["a", "b", "c"]; undefined when the flag is absent */
function splitList(value: string | undefined): string[] | undefined {
  const values = String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export default class TicketList extends SfCommand<any> {
  public static title = 'List tickets';

  public static description = `
## Command Behavior

**Lists the tickets matching some criteria, so that an agent or a script can process a whole backlog without typing the tickets one by one.**

- The criteria are the same on every ticketing system: \`--project\`, \`--status\`, \`--type\`, \`--assignee\` (\`me\`, \`none\` or an account), \`--label\`, \`--text\`, \`--created-after\`, \`--updated-after\` (YYYY-MM-DD) and \`--open-only\`. A flag taking several values takes them comma separated, and matches any of them. Different flags all apply.
- sfdx-hardis converts the criteria to the query language of the ticketing system, quoting every value, so a criterion is never read as query syntax. You never write the query yourself.
- At least one criterion is required: a search without any would read every ticket.
- \`--allowed-projects a,b\` bounds the search to those projects: without \`--project\`, the search reads all of them; a \`--project\` outside them is refused with \`TicketOutOfScope\`; any result outside them is dropped.
- \`--order-by created|updated\` (created by default) and \`--descending\` sort the tickets.
- When nothing matches, the JSON carries a \`warning\`. An empty result is often a wrong project: the project of the repository may only hold the code. \`sf hardis ticket meta --projects\` lists the visible projects, and \`sf hardis ticket meta --project <P>\` the types and statuses to filter on.
- Without \`--provider\`, the only configured ticketing system is queried; when several are configured, \`--provider\` is required. In an Azure DevOps pipeline, the \`SYSTEM_*\` variables make Azure Boards count as configured: a team using another ticketing system there should always pass \`--provider\`.
- \`--max-results\` caps the number of tickets fetched (50 by default). The command never fetches more than that silently.
- When more tickets match, the output says \`truncated: true\` and gives a \`nextPageToken\`. Pass it to \`--page-token\`, with the same criteria, to read the next page. The token is **opaque**: relay it as is, never parse or build it.
- Each ticket comes with its key, URL, summary, type, status, priority, assignee (name and \`assigneeId\`), project, area path (when the ticketing system has one), creation and update dates (ISO 8601, UTC) and labels.

### Supported ticketing systems

| Provider | Supported |
|----------|-----------|
| JIRA Cloud | Yes |
| JIRA Server / Data Center | Yes (offset pagination, carried by the page token) |
| Azure Boards | Yes (one page of \`--max-results\`, no page token) |
| ServiceNow, Aha! | No: fails with \`TicketProviderNotSupported\` |

### Errors

Failures carry a stable name, to branch on in a script: \`TicketProviderNotConfigured\` (no usable credential), \`TicketProviderNotSupported\`, \`TicketQueryInvalid\` (no criterion, a wrong date, or a search the ticketing system rejected: its message is kept), \`TicketOutOfScope\`, \`TicketRateLimited\` (HTTP 429).

### Configuration

The credentials of [sf hardis ticket get](${'https://sfdx-hardis.cloudity.com/hardis/ticket/get/'}), from CI/CD variables or a local **.env** file.

<details markdown="1">
<summary>Technical explanations</summary>

- **Provider abstraction:** the command builds a neutral \`TicketSearchCriteria\` and calls the \`searchTickets()\` method of the provider. Each provider converts the criteria to its query language in its own class: no query language appears in the command.
- **JIRA:** the criteria become JQL (\`project in (...)\`, \`status in (...)\`, \`issuetype in (...)\`, \`assignee = currentUser()\` or \`is EMPTY\`, \`labels in (...)\`, \`text ~\`, \`created >=\`, \`updated >=\`, \`statusCategory != Done\`). Cloud calls \`/search/jql\` through \`jira.js\` \`issueSearch.searchForIssuesUsingJqlEnhancedSearchPost\` (the former \`/rest/api/3/search\` was removed from Jira Cloud, HTTP 410), whose cursor gives no exact total, so \`totalFetched\` counts the tickets actually fetched. Server / Data Center has no \`/search/jql\`: the command calls \`/rest/api/2/search\` and carries \`startAt\` in the opaque page token. JIRA Cloud is recognized by its host (\`atlassian.net\` or \`.jira.com\`). The assignee account is the \`accountId\` on Cloud, the user name on Server / Data Center.
- **Azure Boards:** the criteria become a WIQL statement on \`System.TeamProject\` (the configured team project when no project is given), \`System.State\`, \`System.WorkItemType\`, \`System.AssignedTo\` (\`@Me\`; another assignee is matched by display name or email), \`System.Tags\`, \`System.Title\` / \`System.Description\`, \`System.CreatedDate\` and \`System.ChangedDate\`. WIQL has no status category: \`--open-only\` leaves out the states Done, Closed, Completed, Resolved and Removed. \`wit/wiql\` with \`$top\`, then \`workitemsbatch\` for the fields. A read answered 5xx is retried once.

</details>

### Agent Mode

The command never prompts. Pass at least one criterion, and \`--agent --json\` to get the machine-readable result:

\`\`\`sh
sf hardis ticket list --project ACME --open-only --agent --json
\`\`\`
`;

  public static examples = [
    '$ sf hardis:ticket:list --project ACME --type Bug --open-only',
    '$ sf hardis:ticket:list --project ACME --max-results 100 --agent --json',
    '$ sf hardis:ticket:list --project ACME --page-token <nextPageToken of the previous page> --agent --json',
    '$ sf hardis:ticket:list --project ACME --status "To Do,In Progress" --output-file docs/backlog.json',
    '$ sf hardis:ticket:list --assignee me --allowed-projects ACME,OPS --agent --json',
    '$ sf hardis:ticket:list --provider azure --status New --project "My Project" --order-by updated --descending --agent --json',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    project: Flags.string({
      description: 'Projects the tickets belong to, comma separated',
    }),
    status: Flags.string({
      description: 'Status names, comma separated: any of them',
    }),
    type: Flags.string({
      description: 'Ticket types (Bug, Story...), comma separated: any of them',
    }),
    assignee: Flags.string({
      description: 'me (the authenticated account), none (unassigned), or the account of the assignee',
    }),
    label: Flags.string({
      description: 'Labels, comma separated: any of them',
    }),
    text: Flags.string({
      description: 'Words searched in the summary and the description',
    }),
    'created-after': Flags.string({
      description: 'YYYY-MM-DD: tickets created on or after that day',
    }),
    'updated-after': Flags.string({
      description: 'YYYY-MM-DD: tickets updated on or after that day',
    }),
    'open-only': Flags.boolean({
      default: false,
      description: 'Leave out the tickets in a done status (done, closed, resolved...)',
    }),
    'order-by': Flags.string({
      options: [...TICKET_SEARCH_ORDER_FIELDS],
      default: 'created',
      description: 'Sort on the creation or the update date',
    }),
    descending: Flags.boolean({
      default: false,
      description: 'Newest first',
    }),
    'allowed-projects': Flags.string({
      description: 'Comma-separated projects the search is bounded to',
    }),
    provider: Flags.string({
      char: 'p',
      options: ticketDetailsProviderKeys(),
      description: 'Ticketing system to query. Defaults to the only one configured',
    }),
    'max-results': Flags.integer({
      default: 50,
      min: 1,
      description: 'Maximum number of tickets fetched',
    }),
    'page-token': Flags.string({
      description: 'nextPageToken returned by the previous page, relayed as is',
    }),
    'output-file': Flags.string({
      char: 'f',
      description: 'Also write the JSON result at this path (parent folders are created). JSON, not the markdown of ticket get: a list is read by a program',
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

  // Listing tickets is independent from any Salesforce project or org
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(TicketList);
    const allowedProjects = parseAllowedProjects(flags['allowed-projects']);
    const criteria = this.buildCriteria(flags, allowedProjects);
    // No --provider: the only configured connector is taken (a connector that cannot search then
    // answers TicketProviderNotSupported, which is the truth), several configured ones require --provider
    const { provider, providerClass } = await TicketProvider.resolveProvider({
      providerKey: flags.provider as TicketProviderKey | undefined,
    });
    const search = await provider.searchTickets(criteria, {
      maxResults: flags['max-results'],
      pageToken: flags['page-token'] || null,
    });
    // Filtered again, whatever the provider did with the projects
    search.tickets = search.tickets.filter((ticket) => isProjectAllowed(ticket.project, allowedProjects));
    if (search.tickets.length === 0) {
      search.warning = t('ticketListNoResult', { scope: (criteria.projects || []).join(', ') || '-' });
    }
    const result = buildTicketListResult(providerClass.providerKey, criteria, search);

    uxLog('action', this, c.cyan(t('ticketListDone', { count: result.totalFetched })));
    if (result.tickets.length > 0) {
      await uxLogTableWithReport(this, result.tickets, ['id', 'type', 'status', 'priority', 'assignee', 'subject'], {
        fileNamePrefix: 'ticket-list',
      });
    }
    if (result.warning) {
      uxLog('warning', this, c.yellow(result.warning));
    }
    if (result.truncated) {
      uxLog('warning', this, c.yellow(t('ticketListMore')));
      uxLog('log', this, c.grey(String(result.nextPageToken)));
    }
    if (flags['output-file']) {
      await fs.ensureDir(path.dirname(path.resolve(flags['output-file'])));
      await fs.outputFile(flags['output-file'], JSON.stringify(result, null, 2));
      uxLog('log', this, c.grey(t('ticketListWritten', { file: flags['output-file'] })));
    }
    return result as unknown as AnyJson;
  }

  /** The neutral criteria every provider converts to its own query; checked before any call */
  private buildCriteria(flags: any, allowedProjects: string[] | null): TicketSearchCriteria {
    const criteria: TicketSearchCriteria = {
      projects: scopeSearchProjects(splitList(flags.project) ?? null, allowedProjects),
      statuses: splitList(flags.status),
      types: splitList(flags.type),
      assignee: (flags.assignee || '').trim() || null,
      labels: splitList(flags.label),
      text: (flags.text || '').trim() || null,
      createdAfter: parseSearchDate(flags['created-after'], '--created-after'),
      updatedAfter: parseSearchDate(flags['updated-after'], '--updated-after'),
      openOnly: flags['open-only'] === true,
      orderBy: (flags['order-by'] || 'created') as TicketSearchOrderField,
      descending: flags.descending === true,
    };
    if (!hasSearchFilter(criteria)) {
      throw new SfError(t('ticketListNoCriteria'), TICKET_ERROR.queryInvalid);
    }
    return criteria;
  }
}
