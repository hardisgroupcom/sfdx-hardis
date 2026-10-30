/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';
import { TicketProvider, TicketProviderKey, ticketDetailsProviderKeys } from '../../../common/ticketProvider/index.js';
import { assertProjectAllowed, parseAllowedProjects } from '../../../common/ticketProvider/utils/ticketQualify.js';
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
- \`--allowed-projects a,b\` refuses a \`--project\` outside that list with \`TicketOutOfScope\`.

### Supported ticketing systems

JIRA Cloud, JIRA Server / Data Center and Azure Boards. ServiceNow fails with \`TicketProviderNotSupported\`.

### Errors

\`TicketProviderNotConfigured\`, \`TicketProviderNotSupported\`, \`TicketOutOfScope\`, \`TicketRateLimited\`.

<details markdown="1">
<summary>Technical explanations</summary>

- **JIRA:** \`/project/{key}/statuses\` (statuses per issue type); projects from \`/project/search\` on Cloud, \`/project\` on Server / Data Center.
- **Azure Boards:** work item types of the project (disabled types are left out) with their states; a type that comes without states is completed by \`workitemtypes/{type}/states\`. Projects from \`_apis/projects\` (200 at most).
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
    '$ sf hardis:ticket:meta --project ACME',
    '$ sf hardis:ticket:meta --projects --provider azure --agent --json',
    '$ sf hardis:ticket:meta --project "My Project" --provider azure --allowed-projects "My Project" --agent --json',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    project: Flags.string({
      exactlyOne: MODE_FLAGS,
      description: 'Project to describe (JIRA project key, or Azure Boards team project)',
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
      const projects = await provider.listProjects();
      uxLog('action', this, c.cyan(t('ticketMetaProjectsDone', { count: projects.length })));
      return { provider: providerClass.providerKey, projects } as unknown as AnyJson;
    }
    const meta = await provider.getProjectMeta(project);
    uxLog('action', this, c.cyan(t('ticketMetaDone', { project, types: meta.issueTypes.length, statuses: meta.statuses.length })));
    return { provider: providerClass.providerKey, ...meta } as unknown as AnyJson;
  }
}
