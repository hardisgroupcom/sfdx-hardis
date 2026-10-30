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
import { TICKET_ERROR, TicketSearchResult } from '../../../common/ticketProvider/utils/ticketOperations.js';
import { parseAllowedProjects } from '../../../common/ticketProvider/utils/ticketQualify.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

/** JSON result of the command. Key names and order are part of the contract: do not change them */
export function buildTicketListResult(providerKey: string, query: string, search: TicketSearchResult) {
  return {
    provider: providerKey,
    query,
    totalFetched: search.tickets.length,
    nextPageToken: search.nextPageToken,
    truncated: search.truncated,
    tickets: search.tickets,
    // Added last, so the keys above keep their order: set when nothing matched
    warning: search.warning || null,
  };
}

export default class TicketList extends SfCommand<any> {
  public static title = 'List tickets';

  public static description = `
## Command Behavior

**Lists the tickets matching a query, so that an agent or a script can process a whole backlog without typing the tickets one by one.**

- The query is **yours**: JQL on JIRA, a WIQL **condition** on Azure Boards (the part after \`WHERE\`, without \`SELECT\`, \`FROM\` or \`ORDER BY\`). An empty query is refused, since it would match every ticket.
- \`--allowed-projects a,b\` bounds the query to those projects: the JQL becomes \`project in ("a", "b") AND (<query>)\`, and the WIQL condition is wrapped the same way with \`[System.TeamProject] IN (...)\`. Unbalanced quotes or parentheses are refused with \`TicketQueryInvalid\`, so the query cannot escape the bound, and any result outside the projects is dropped. On Azure Boards the query is always bounded: to \`--allowed-projects\`, or else to the configured team project.
- When nothing matches, the JSON carries a \`warning\`. On Azure Boards an empty result is often a wrong project: the project of the repository may only hold the code.
- Without \`--provider\`, the only configured ticketing system is queried; when several are configured, \`--provider\` is required. In an Azure DevOps pipeline, the \`SYSTEM_*\` variables make Azure Boards count as configured: a JIRA team running there should always pass \`--provider jira\`.
- \`--max-results\` caps the number of tickets fetched (50 by default). The command never fetches more than that silently.
- When more tickets match, the output says \`truncated: true\` and gives a \`nextPageToken\`. Pass it to \`--page-token\` to read the next page. The token is **opaque**: relay it as is, never parse or build it.
- Each ticket comes with its key, URL, summary, type, status, priority, assignee (name and \`assigneeId\`), project, area path (Azure Boards), creation and update dates (ISO 8601, UTC) and labels.

### Supported ticketing systems

| Provider | Supported |
|----------|-----------|
| JIRA Cloud | Yes |
| JIRA Server / Data Center | Yes (offset pagination, carried by the page token) |
| Azure Boards | Yes (WIQL condition, one page of \`--max-results\`, no page token) |
| ServiceNow | No: fails with \`TicketProviderNotSupported\` |

### Errors

Failures carry a stable name, to branch on in a script: \`TicketProviderNotConfigured\` (no usable credential), \`TicketProviderNotSupported\`, \`TicketQueryInvalid\` (the query was rejected: the server message is kept), \`TicketRateLimited\` (HTTP 429).

### Configuration

JIRA: \`JIRA_HOST\` + (\`JIRA_EMAIL\` + \`JIRA_TOKEN\`) or \`JIRA_PAT\` or (\`JIRA_CLIENT_ID\` + \`JIRA_CLIENT_SECRET\`), from CI/CD variables or a local **.env** file.

<details markdown="1">
<summary>Technical explanations</summary>

- **Endpoint:** the search goes through \`jira.js\` \`issueSearch.searchForIssuesUsingJqlEnhancedSearchPost\`, which calls \`/search/jql\`. The former \`/rest/api/3/search\` was removed from Jira Cloud (HTTP 410), and its offset pagination (\`startAt\` / \`total\`) was replaced by a cursor. That cursor model gives no exact total, so \`totalFetched\` counts the tickets actually fetched.
- **Server / Data Center:** \`/search/jql\` does not exist there: the command calls \`/rest/api/2/search\` and carries \`startAt\` in the opaque page token. JIRA Cloud is recognized by its host (\`atlassian.net\` or \`.jira.com\`): a Cloud site reached through a custom domain is taken for Server / Data Center.
- **Azure Boards:** \`wit/wiql\` with \`$top\`, then \`workitemsbatch\` for the fields. A read answered 5xx is retried once.
- **Credentials:** the call goes through the existing JIRA connector, so the credential fallback (Basic, PAT, OAuth2 client credentials) applies.

</details>

### Agent Mode

The command never prompts. \`--query\` is always required. Use \`--agent --json\` to get the machine-readable result:

\`\`\`sh
sf hardis ticket list --query "project = ACME AND statusCategory != Done" --agent --json
\`\`\`
`;

  public static examples = [
    '$ sf hardis:ticket:list --query "project = ACME AND issuetype = Bug AND statusCategory != Done"',
    '$ sf hardis:ticket:list --query "project = ACME" --max-results 100 --agent --json',
    '$ sf hardis:ticket:list --query "project = ACME" --page-token <nextPageToken of the previous page> --agent --json',
    '$ sf hardis:ticket:list --query "project = ACME" --output-file docs/backlog.json',
    '$ sf hardis:ticket:list --query "assignee = currentUser()" --allowed-projects ACME,OPS --agent --json',
    '$ sf hardis:ticket:list --provider azure --query "[System.State] = \'New\'" --allowed-projects "My Project" --agent --json',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    query: Flags.string({
      char: 'q',
      required: true,
      description: 'JQL on JIRA, WIQL condition on Azure Boards',
    }),
    'allowed-projects': Flags.string({
      description: 'Comma-separated projects the query is bounded to',
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
    const query = (flags.query || '').trim();
    if (!query) {
      throw new SfError(t('ticketListQueryEmpty'), TICKET_ERROR.queryInvalid);
    }
    // No --provider: the only configured connector is taken (an Azure-only setup then answers
    // TicketProviderNotSupported, which is the truth), several configured ones require --provider
    const { provider, providerClass } = await TicketProvider.resolveProvider({
      providerKey: flags.provider as TicketProviderKey | undefined,
    });
    const providerKey = providerClass.providerKey;
    const search = await provider.searchTickets(query, {
      maxResults: flags['max-results'],
      pageToken: flags['page-token'] || null,
      allowedProjects: parseAllowedProjects(flags['allowed-projects']),
    });
    const result = buildTicketListResult(providerKey, query, search);

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
}
