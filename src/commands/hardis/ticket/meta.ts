/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';
import { TicketProvider, TicketProviderKey, ticketDetailsProviderKeys } from '../../../common/ticketProvider/index.js';
import { assertProjectAllowed, isProjectAllowed, parseAllowedProjects } from '../../../common/ticketProvider/utils/ticketQualify.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

const MODE_FLAGS = ['project', 'projects'];

export default class TicketMeta extends SfCommand<any> {
  public static title = 'Describe a ticketing project';

  public static description = `
## Command Behavior

**Lists what a ticketing project accepts - issue types, statuses, and the statuses of each type - or the projects the credentials can see, so that a script can be configured without guessing names.**

- \`--project <P>\` returns \`issueTypes\`, \`statuses\` (each status once) and \`statusesByType\` (type name -> its status names). Statuses come with their id: on JIRA a query is safer with ids, since the names returned are translated.
- \`--projects\` returns the projects the credentials can see (\`key\` and \`name\`; on Azure Boards both are the team project name). Use it when the project of the repository is not the one that holds the work items.
- \`--allowed-projects a,b\` refuses a \`--project\` outside that list with \`TicketOutOfScope\`, and leaves the other projects out of \`--projects\`.

### Supported ticketing systems

JIRA Cloud, JIRA Server / Data Center, Azure Boards, ServiceNow (a project is a table: incident, rm_story...) and Aha! (a project is a workspace, named by the prefix of its features).

### Errors

\`TicketProviderNotConfigured\`, \`TicketProviderNotSupported\`, \`TicketOutOfScope\`, \`TicketRateLimited\`.

<details markdown="1">
<summary>Technical explanations</summary>

- **JIRA:** \`/project/{key}/statuses\` (statuses per issue type); projects from \`/project/search\` on Cloud, \`/project\` on Server / Data Center.
- **Azure Boards:** work item types of the project (disabled types are left out) with their states; a type that comes without states is completed by \`workitemtypes/{type}/states\`. Projects from \`_apis/projects\` (200 at most).
- **ServiceNow:** the projects are the tables a record number maps to (built-in prefixes and \`SERVICENOW_TABLE_PREFIXES\`); the statuses are the \`state\` choices of the table (\`sys_choice\`), or those of \`task\` when the table has none of its own. The type is the table itself.
- **Aha!:** workspaces from \`/api/v1/products\`; statuses from the feature workflow of the workspace (\`/products/{key}/workflows\`). Aha! lists no feature types: the types are the workflow kinds its features use, read on up to 200 features.
- A read answered 5xx is retried once.

</details>

### Agent Mode

The command never prompts. One of \`--project\` or \`--projects\` is required:

\`\`\`sh
sf hardis ticket meta --project ACME --agent --json
sf hardis ticket meta --projects --provider azure --agent --json
\`\`\`
`;

  public static examples = [
    // JIRA
    '$ sf hardis:ticket:meta --project ACME',
    '$ sf hardis:ticket:meta --projects --provider jira --agent --json',
    // Azure Boards
    '$ sf hardis:ticket:meta --projects --provider azure --agent --json',
    '$ sf hardis:ticket:meta --project "My Project" --provider azure --allowed-projects "My Project" --agent --json',
    // ServiceNow (tables, and the states of one)
    '$ sf hardis:ticket:meta --projects --provider servicenow --agent --json',
    '$ sf hardis:ticket:meta --project incident --provider servicenow --agent --json',
    // Aha! (workspaces, and the feature statuses of one)
    '$ sf hardis:ticket:meta --projects --provider aha --agent --json',
    '$ sf hardis:ticket:meta --project PROD --provider aha --agent --json',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    project: Flags.string({
      exactlyOne: MODE_FLAGS,
      description: 'Project to describe (its key, or its name when the ticketing system has no key)',
    }),
    projects: Flags.boolean({
      exactlyOne: MODE_FLAGS,
      description: 'List the projects the credentials can see instead',
    }),
    'allowed-projects': Flags.string({
      description: 'Comma-separated projects --project must belong to',
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
    const { flags } = await this.parse(TicketMeta);
    const allowedProjects = parseAllowedProjects(flags['allowed-projects']);
    const project = (flags.project || '').trim();
    if (project) {
      assertProjectAllowed(project, project, allowedProjects);
    }
    const { provider, providerClass } = await TicketProvider.resolveProvider({
      providerKey: flags.provider as TicketProviderKey | undefined,
    });
    if (!project) {
      // --allowed-projects bounds the listing too: a project outside it is not even named
      const projects = (await provider.listProjects()).filter(
        (candidate) => isProjectAllowed(candidate.key, allowedProjects) || isProjectAllowed(candidate.name, allowedProjects)
      );
      uxLog('action', this, c.cyan(t('ticketMetaProjectsDone', { count: projects.length })));
      return { provider: providerClass.providerKey, projects } as unknown as AnyJson;
    }
    const meta = await provider.getProjectMeta(project);
    uxLog('action', this, c.cyan(t('ticketMetaDone', { project, types: meta.issueTypes.length, statuses: meta.statuses.length })));
    return { provider: providerClass.providerKey, ...meta } as unknown as AnyJson;
  }
}
