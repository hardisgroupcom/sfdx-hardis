/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from '../../../common/utils/fsUtils.js';
import { isCI, uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import { uxLogTableWithReport } from '../../../common/utils/filesUtils.js';
import { TicketProvider, TicketProviderKey, ticketCommentProviderKeys } from '../../../common/ticketProvider/index.js';
import { PostCommentResult, assertValidMarker } from '../../../common/ticketProvider/utils/ticketComment.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class TicketPostComment extends SfCommand<any> {
  public static title = 'Post a comment on tickets';

  public static description = `
## Command Behavior

**Posts a markdown comment on one or several tickets of JIRA, Azure Boards, ServiceNow or Aha!, converted to the format of each ticketing system.**

An AI agent can report what it designed or tested on the ticket it worked on, a CI job can tell what it did, and a developer can comment without opening the ticketing system. The deployment comments sfdx-hardis posts after a deployment go through the same code.

- **Several tickets:** repeat \`--id\` (or separate the identifiers with commas). Each ticket is handled on its own: one failing does not stop the others.
- **Markdown in, native format out:** headings, bold, italic, links, lists, tables and code blocks become an Atlassian document on Jira Cloud, wiki markup on Jira Server / Data Center, HTML on Azure Boards and Aha!, and plain text with the URLs spelled out in a ServiceNow journal.
- **Update instead of adding** (\`--marker\`): a rerun with the same marker replaces the comment it posted before, so a CI job can keep one status comment up to date. ServiceNow journal notes cannot be edited: a new note is added there, with a warning.
- **Report:** a table and a CSV file with the action (created, updated or failed) and the link of each comment. Exit code 0 when every comment was posted, 2 when some failed, 1 when all failed.

### Provider detection

The ticketing system is deduced from the shape of the identifier, as [hardis:ticket:get](${'https://sfdx-hardis.cloudity.com/hardis/ticket/get/'}) does, so \`--provider\` is only needed to disambiguate:

| Identifier | Provider | Example |
|------------|----------|---------|
| \`PROJECT-123\` | JIRA, or Aha! when \`ticketingProvider\` is \`AHA\` | \`--id ACME-4567\` |
| \`1234\` or \`AB-1234\` | Azure Boards | \`--id AB-4567\` |
| \`INC0012345\`, \`CHG...\`, \`RITM...\`, \`DMND...\` | ServiceNow | \`--id INC0012345\` |

### Configuration

The ticketing variables sfdx-hardis already documents, from CI/CD variables or a local **.env** file:

- **JIRA:** \`JIRA_HOST\` + (\`JIRA_EMAIL\` + \`JIRA_TOKEN\`) or \`JIRA_PAT\` or (\`JIRA_CLIENT_ID\` + \`JIRA_CLIENT_SECRET\`)
- **Azure Boards:** a token (\`CI_SFDX_HARDIS_AZURE_TOKEN\`, \`SYSTEM_ACCESSTOKEN\` or \`AZURE_DEVOPS_EXT_PAT\`). The organization and the project are read from the git remote, or from \`SYSTEM_COLLECTIONURI\` and \`SYSTEM_TEAMPROJECT\`.
- **ServiceNow:** \`SERVICENOW_URL\` + \`SERVICENOW_USERNAME\` + \`SERVICENOW_PASSWORD\`. The note goes to \`work_notes\` by default: \`--servicenow-field\`, then \`SERVICENOW_COMMENT_FIELD\`, then the \`serviceNowCommentField\` configuration choose another journal field, such as \`comments\`.
- **Aha!:** \`AHA_HOST\` + \`AHA_API_KEY\`

<details markdown="1">
<summary>Technical explanations</summary>

- **One posting path:** every connector implements \`postComment(ticketId, markdown, options)\`, and its deployment comments call it too. \`TicketProvider.postComment()\` picks the connector with the same routing as \`TicketProvider.getTicketDetails()\`.
- **Conversion:** the markdown is read with \`marked\`. Azure Boards and Aha! get its sanitized HTML. The Atlassian document, the wiki markup and the plain text are built from the same tokens, so a comment reads the same everywhere.
- **Marker:** \`sfdx-hardis:<marker>\` is written in the comment, hidden in the title of an empty element on Azure Boards and Aha! (Azure Boards strips HTML comments), as a last line in code format on JIRA and ServiceNow, which have no hidden text. A rerun reads the comments of the ticket and updates the most recent one holding the marker. A marker holds letters, digits, \`_\`, \`.\`, \`:\` and \`-\`, 80 characters at most.
- **Proxy support:** the HTTP calls go through the shared proxy-aware client (\`HTTP_PROXY\`, \`HTTPS_PROXY\`, \`NO_PROXY\`).

</details>

### Agent Mode

Use \`--agent\` to disable all interactive prompts. \`--id\` and \`--message\` (or \`--file\`) are then required.

\`\`\`sh
sf hardis:ticket:post-comment --id ACME-4567 --file docs/ACME-4567/design.md --marker design --agent --json
\`\`\`

The same applies in CI.
`;

  public static examples = [
    '$ sf hardis:ticket:post-comment --id ACME-4567 --message "The fix is deployed in UAT, please test it"',
    '$ sf hardis:ticket:post-comment --id ACME-4567 --id ACME-4568 --file release-notes.md',
    '$ sf hardis:ticket:post-comment --id AB-1234 --file test-report.md --marker test-report',
    '$ sf hardis:ticket:post-comment --id INC0012345 --message "Fixed in the last release" --servicenow-field comments',
    '$ sf hardis:ticket:post-comment --id ACME-4567 --file docs/ACME-4567/design.md --marker design --agent',
  ];

  public static flags: any = {
    id: Flags.string({
      char: 'i',
      multiple: true,
      description: 'Ticket to comment on: JIRA key or Aha! feature (ACME-123), Azure Boards work item (1234 or AB-1234) or ServiceNow number (INC0012345). Repeat it, or separate the identifiers with commas',
    }),
    message: Flags.string({
      char: 'm',
      description: 'Comment to post, in markdown',
    }),
    file: Flags.string({
      char: 'f',
      description: 'Markdown file holding the comment to post, instead of --message',
    }),
    marker: Flags.string({
      description: 'Key of the comment: a rerun with the same marker updates the comment it posted before instead of adding one',
    }),
    provider: Flags.string({
      char: 'p',
      options: ticketCommentProviderKeys(),
      description: 'Force the ticketing system instead of deducing it from the identifier',
    }),
    'servicenow-field': Flags.string({
      description: 'ServiceNow journal field written to (work_notes by default, comments for a note the requester reads)',
    }),
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
  };

  // Commenting a ticket is independent from any Salesforce project or org
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(TicketPostComment);
    const nonInteractive = flags.agent === true || isCI;
    assertValidMarker(flags.marker);
    const ticketIds = await this.resolveTicketIds(flags.id, nonInteractive);
    const markdown = await this.resolveMarkdown(flags, nonInteractive);

    uxLog('action', this, c.cyan(t('ticketPostCommentPosting', { tickets: ticketIds.join(', ') })));
    const results: PostCommentResult[] = [];
    for (const ticketId of ticketIds) {
      const result = await TicketProvider.postComment(ticketId, markdown, {
        providerKey: flags.provider as TicketProviderKey | undefined,
        marker: flags.marker,
        serviceNowField: flags['servicenow-field'],
      });
      if (result.action === 'failed') {
        uxLog('warning', this, c.yellow(`[TicketPostComment] ${result.ticketId}: ${result.error}`));
      }
      results.push(result);
    }

    // Every row gets every column: the report header is built from the first row
    const rows = results.map((result) => ({
      ticketId: result.ticketId,
      provider: result.provider,
      action: result.action,
      url: result.url ?? '',
      error: result.error ?? '',
    }));
    await uxLogTableWithReport(this, rows, ['ticketId', 'provider', 'action', 'url', 'error'], {
      fileNamePrefix: 'ticket-post-comment',
      fileTitle: t('ticketPostCommentReport'),
    });
    const created = results.filter((result) => result.action === 'created').length;
    const updated = results.filter((result) => result.action === 'updated').length;
    const failed = results.filter((result) => result.action === 'failed').length;
    const message = t('ticketPostCommentSummary', { created, updated, failed });
    if (failed > 0) {
      uxLog('warning', this, c.yellow(message));
      process.exitCode = failed === results.length ? 1 : 2;
    } else {
      uxLog('success', this, c.green(message));
    }
    return { outputString: message, created, updated, failed, results: results as unknown as AnyJson };
  }

  /** --id, repeated or comma separated, else a prompt in interactive sessions. */
  private async resolveTicketIds(flagValues: string[] | undefined, nonInteractive: boolean): Promise<string[]> {
    let values = flagValues ?? [];
    if (values.length === 0) {
      if (nonInteractive) {
        throw new SfError(t('ticketPostCommentIdRequired'));
      }
      const answer = await prompts({
        type: 'text',
        name: 'value',
        message: t('ticketPostCommentPromptId'),
        description: t('ticketPostCommentPromptIdDescription'),
        placeholder: 'ACME-4567',
      });
      values = [String(answer?.value || '')];
    }
    const ticketIds = [...new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))];
    if (ticketIds.length === 0) {
      throw new SfError(t('ticketPostCommentIdRequired'));
    }
    return ticketIds;
  }

  /** --message or --file, else a prompt in interactive sessions. */
  private async resolveMarkdown(flags: any, nonInteractive: boolean): Promise<string> {
    if (flags.message !== undefined && flags.file) {
      throw new SfError(t('ticketPostCommentOneInputOnly'));
    }
    let markdown: string;
    if (flags.file) {
      if (!(await fs.pathExists(flags.file))) {
        throw new SfError(t('testCasesFileNotFound', { file: flags.file }));
      }
      markdown = (await fs.readFile(flags.file, 'utf8')).replace(/^\ufeff/, '');
    } else if (flags.message !== undefined) {
      markdown = flags.message;
    } else {
      if (nonInteractive) {
        throw new SfError(t('ticketPostCommentMessageRequired'));
      }
      const answer = await prompts({
        type: 'text',
        name: 'value',
        message: t('ticketPostCommentPromptMessage'),
        description: t('ticketPostCommentPromptMessageDescription'),
      });
      markdown = String(answer?.value || '');
    }
    if (!markdown.trim()) {
      throw new SfError(t('ticketPostCommentEmpty'));
    }
    return markdown;
  }
}
