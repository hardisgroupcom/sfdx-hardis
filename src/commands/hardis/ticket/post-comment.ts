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
import { TicketProviderRoot } from '../../../common/ticketProvider/ticketProviderRoot.js';
import { TICKET_ERROR, validateTicketLabel } from '../../../common/ticketProvider/utils/ticketOperations.js';
import {
  NOT_REQUESTED,
  TicketAssignee,
  TicketCommentVisibility,
  TicketStepResult,
  assertProjectAllowed,
  isTicketMarked,
  parseAllowedProjects,
  parseCommentVisibility,
  parseStoryPoints,
  stepFailure,
  toStrictMarkdown,
  withCommentPrefix,
} from '../../../common/ticketProvider/utils/ticketQualify.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

const JIRA_POINTS_FIELD_RE = /^customfield_\d+$/;

/** The qualification options of one run, checked once before the first ticket */
interface QualifySteps {
  providerKey: TicketProviderKey | undefined;
  prefix: string | null;
  skipIfMarked: boolean;
  label: string | null;
  markerLabel: string | null;
  transition: string | null;
  points: number | null;
  pointsField: string | null;
  overwritePoints: boolean;
  mentionAssignee: boolean;
  visibility: TicketCommentVisibility | null;
  allowedProjects: string[] | null;
}

export default class TicketPostComment extends SfCommand<any> {
  public static title = 'Post a comment on tickets';

  public static description = `
## Command Behavior

**Posts a markdown comment on one or several tickets of JIRA, Azure Boards, ServiceNow or Aha!, converted to the format of each ticketing system.**

An AI agent can report what it designed or tested on the ticket it worked on, a CI job can tell what it did, and a developer can comment without opening the ticketing system. The deployment comments sfdx-hardis posts after a deployment go through the same code.

- **Several tickets:** repeat \`--id\` (or separate the identifiers with commas). Each ticket is handled on its own: one failing does not stop the others.
- **Markdown in, native format out:** headings, bold, italic, links, lists, tables and code blocks become an Atlassian document on Jira Cloud, wiki markup on Jira Server / Data Center, HTML on Azure Boards and Aha!, and plain text with the URLs spelled out in a ServiceNow journal.
- **Update instead of adding** (\`--marker\`): a rerun with the same marker replaces the comment it posted before, so a CI job can keep one status comment up to date. ServiceNow journal notes cannot be edited: a new note is added there, with a warning.
- **Report:** a table and a CSV file with the action (created, updated, skipped, refused or failed) and the link of each comment. Exit code 0 when no ticket failed or was refused, 2 when some did, 1 when all did. A skipped ticket is not a failure.

### Qualifying a ticket in the same run (JIRA, Azure Boards)

Options meant for an agent that reviews a backlog. Each ticket goes through the same steps, in this order:

1. **Checks, before any write:** \`--allowed-projects a,b\` leaves a ticket of another project untouched (action \`refused\`, \`errorName: TicketOutOfScope\`). \`--skip-if-marked\` leaves untouched a ticket that carries \`--marker-label\` (default \`--label\`), or a comment of the authenticated account starting with \`--prefix\` (action \`skipped\`, \`errorName: TicketAlreadyMarked\`): it is neither commented nor updated, even with \`--marker\`. Comments of other accounts never count.
2. **Comment**, with \`--prefix\` as its first line (never twice), \`--mention-assignee\` adding a real mention of the assignee read on the ticket (never taken from the text; nothing when unassigned), and \`--visibility role:<role>\` or \`group:<group>\` restricting it on JIRA (refused on Azure Boards).
3. **Label** (\`--label\`), added on top of the existing ones. If it cannot be added, the result is \`failed\` although the comment is saved: add the label only, do not post again.
4. **Status** (\`--transition\`): the target status, by name, untranslated name or id, never the name of the transition.
5. **Story points** (\`--points\`): a filled value is kept unless \`--overwrite-points\`. JIRA needs \`--points-field customfield_NNNNN\`; Azure Boards finds the field on the work item type (StoryPoints, then Effort, then Size), or takes \`--points-field\`. A type without the field is \`skipped\`, not an error.

\`--strict-markdown\` keeps only headings, bullet and numbered lists, paragraphs, bold and inline code: links, images, HTML, code blocks, tables and mentions are posted as literal text, so text quoted from a ticket cannot inject anything. Without it, the full markdown is converted as usual. On Azure Boards the headings keep their markdown level (\`#\` gives \`<h1>\`), with an empty line before each one but the first.

A failed status or points step does not undo the comment. Each result carries \`label\`, \`transition\` and \`points\`: \`{status: done | skipped | failed | not-requested, value, field, reason, error: {name, message}}\`. A failed step names its error: \`TicketTransitionInvalid\` (status unknown for the type of the ticket, or move refused by the workflow), \`TicketPointsInvalid\` (no \`--points-field\` on JIRA, or value refused). On ServiceNow and Aha! these steps fail with \`TicketProviderNotSupported\`.

**Checking the result:** [hardis:ticket:get](${'https://sfdx-hardis.cloudity.com/hardis/ticket/get/'}) returns the comments as flattened plain text, without their HTML or Atlassian formatting: it tells what was posted, not how it renders. Check the rendering (headings, lists, mention, visibility) in the ticketing system itself.

**JIRA Cloud or Server:** JIRA Cloud is recognized by its host (\`atlassian.net\` or \`.jira.com\`). A Cloud site reached through a custom domain is taken for Server / Data Center, and gets wiki markup instead of an Atlassian document.

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
    '$ sf hardis:ticket:post-comment --id AB-1234 --file draft.md --prefix "Automatic qualification" --skip-if-marked --label ia-qualified --transition Ready --points 3 --mention-assignee --allowed-projects "My Project" --agent --json',
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
    'strict-markdown': Flags.boolean({
      default: false,
      description: 'Keep only headings, lists, paragraphs, bold and code; every other construct (link, image, HTML, mention...) is posted as literal text',
    }),
    prefix: Flags.string({
      description: 'First line of the comment, added unless the text already starts with it',
    }),
    'skip-if-marked': Flags.boolean({
      default: false,
      description: 'Leave a ticket untouched (action skipped) when it carries --marker-label or a comment of this account starting with --prefix',
    }),
    'marker-label': Flags.string({
      description: 'Label checked by --skip-if-marked. Defaults to --label',
    }),
    label: Flags.string({
      description: 'Label (Azure Boards tag) added to the ticket once the comment is posted',
    }),
    transition: Flags.string({
      description: 'Status the ticket is moved to once the comment is posted (name, untranslated name or id)',
    }),
    points: Flags.string({
      description: 'Story points written once the comment is posted. A filled value is kept unless --overwrite-points',
    }),
    'points-field': Flags.string({
      description: 'Story points field: customfield_NNNNN on JIRA (required with --points), field reference name on Azure Boards (optional)',
    }),
    'overwrite-points': Flags.boolean({
      default: false,
      description: 'Replace story points that are already filled',
    }),
    'mention-assignee': Flags.boolean({
      default: false,
      description: 'Mention the assignee read on the ticket, under the first line of the comment (JIRA, Azure Boards)',
    }),
    visibility: Flags.string({
      description: 'JIRA only: role:<role> or group:<group> to restrict the comment',
    }),
    'allowed-projects': Flags.string({
      description: 'Comma-separated projects the tickets must belong to: any other one is refused (action refused) and left untouched',
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
    // Every option is checked before the first network call: nothing is written when one of them is wrong
    const label = validateTicketLabel(flags.label);
    const steps: QualifySteps = {
      providerKey: flags.provider as TicketProviderKey | undefined,
      prefix: flags.prefix || null,
      skipIfMarked: flags['skip-if-marked'] === true,
      label,
      markerLabel: validateTicketLabel(flags['marker-label']) ?? label,
      transition: (flags.transition || '').trim() || null,
      points: parseStoryPoints(flags.points),
      pointsField: flags['points-field'] || null,
      overwritePoints: flags['overwrite-points'] === true,
      mentionAssignee: flags['mention-assignee'] === true,
      visibility: parseCommentVisibility(flags.visibility),
      allowedProjects: parseAllowedProjects(flags['allowed-projects']),
    };
    if (steps.skipIfMarked && !steps.prefix && !steps.markerLabel) {
      throw new SfError(t('ticketSkipIfMarkedNeedsMarker'));
    }
    const ticketIds = await this.resolveTicketIds(flags.id, nonInteractive);
    const prefixed = withCommentPrefix(await this.resolveMarkdown(flags, nonInteractive), steps.prefix);
    const strictMarkdown = flags['strict-markdown'] === true;
    const markdown = strictMarkdown ? toStrictMarkdown(prefixed) : prefixed;

    uxLog('action', this, c.cyan(t('ticketPostCommentPosting', { tickets: ticketIds.join(', ') })));
    const results: PostCommentResult[] = [];
    for (const ticketId of ticketIds) {
      const result = await this.postOnTicket(ticketId, markdown, { ...flags, strictMarkdown }, steps);
      if (result.action === 'failed' || result.action === 'refused') {
        uxLog('warning', this, c.yellow(`[TicketPostComment] ${result.ticketId}: ${result.error}`));
      } else if (result.action === 'skipped') {
        uxLog('log', this, c.grey(`[TicketPostComment] ${result.ticketId}: ${result.error}`));
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
    const skipped = results.filter((result) => result.action === 'skipped').length;
    // A ticket outside the allowed projects is a failure of the run, an already marked one is not
    const failed = results.filter((result) => result.action === 'failed' || result.action === 'refused').length;
    const message = skipped > 0 ? t('ticketPostCommentSummaryWithSkipped', { created, updated, skipped, failed }) : t('ticketPostCommentSummary', { created, updated, failed });
    if (failed > 0) {
      uxLog('warning', this, c.yellow(message));
      process.exitCode = failed === results.length ? 1 : 2;
    } else {
      uxLog('success', this, c.green(message));
    }
    return { outputString: message, created, updated, skipped, failed, results: results as unknown as AnyJson };
  }

  /**
   * One ticket: the checks (scope, marker), then the comment, then the label, the status and the
   * points. Never throws: every outcome is a result, so the other tickets are still handled.
   */
  private async postOnTicket(ticketId: string, markdown: string, flags: any, steps: QualifySteps): Promise<PostCommentResult> {
    const notRequested = { label: NOT_REQUESTED, transition: NOT_REQUESTED, points: NOT_REQUESTED };
    const needsRead = steps.allowedProjects !== null || steps.skipIfMarked || steps.mentionAssignee;
    const needsProvider = needsRead || steps.label !== null || steps.transition !== null || steps.points !== null;
    let provider: TicketProviderRoot | null = null;
    let providerLabel = steps.providerKey || '';
    let mention: TicketAssignee | null = null;
    try {
      if (needsProvider) {
        const resolved = await TicketProvider.resolveProvider({ ticketId, providerKey: steps.providerKey });
        provider = resolved.provider;
        providerLabel = resolved.providerClass.providerLabel;
        // JIRA writes points only into a named custom field: refused before the comment, not after
        if (steps.points !== null && resolved.providerClass.providerKey === 'jira' && !JIRA_POINTS_FIELD_RE.test(steps.pointsField || '')) {
          throw new SfError(t('ticketPointsFieldRequired'), TICKET_ERROR.pointsInvalid);
        }
      }
      if (needsRead && provider) {
        const details = await provider.getTicketDetails(ticketId, { downloadAttachments: false, skipComments: !steps.skipIfMarked });
        if (!details) {
          throw new SfError(t('ticketGetNotFound', { ticketId }), TICKET_ERROR.notFound);
        }
        try {
          assertProjectAllowed(details.id, details.project, steps.allowedProjects);
        } catch (e) {
          return { ticketId, provider: providerLabel, action: 'refused', error: (e as Error).message, errorName: TICKET_ERROR.outOfScope, ...notRequested };
        }
        if (steps.skipIfMarked) {
          const myId = steps.prefix ? await this.myAccountId(provider, providerLabel) : null;
          const comments = details.comments.map((comment) => ({ authorId: comment.authorId ?? null, body: comment.body }));
          if (isTicketMarked({ labels: details.labels, comments, myId, prefix: steps.prefix, label: steps.markerLabel })) {
            const error = t('ticketAlreadyMarked', { ticketId: details.id });
            return { ticketId, provider: providerLabel, action: 'skipped', error, errorName: TICKET_ERROR.alreadyMarked, ...notRequested };
          }
        }
        if (steps.mentionAssignee && details.assigneeId) {
          mention = { id: details.assigneeId, displayName: details.assignee || null };
        }
      }
    } catch (e) {
      return { ticketId, provider: providerLabel, action: 'failed', error: (e as Error).message, errorName: (e as Error).name || undefined, ...notRequested };
    }

    const result: PostCommentResult = await TicketProvider.postComment(ticketId, markdown, {
      providerKey: steps.providerKey,
      marker: flags.marker,
      serviceNowField: flags['servicenow-field'],
      strictMarkdown: flags.strictMarkdown === true,
      mention,
      visibility: steps.visibility,
    });
    Object.assign(result, notRequested);
    if (result.action === 'failed' || !provider) {
      return result;
    }
    if (steps.label !== null) {
      try {
        await provider.addTicketLabel(ticketId, steps.label);
        result.label = { status: 'done', value: steps.label };
      } catch (e) {
        // The comment is saved: the caller must add the label only, never post again
        result.label = stepFailure(e);
        result.action = 'failed';
        result.error = t('ticketLabelFailedAfterComment', { ticketId: result.ticketId, label: steps.label, message: (e as Error).message });
        result.errorName = (e as Error).name || undefined;
        return result;
      }
    }
    if (steps.transition !== null) {
      const transition = steps.transition;
      result.transition = await this.runStep(() => provider!.transitionTicket(ticketId, transition).then((status) => ({ status: 'done' as const, value: status })));
    }
    if (steps.points !== null) {
      const points = steps.points;
      result.points = await this.runStep(() =>
        provider!.setTicketPoints(ticketId, points, { field: steps.pointsField, overwrite: steps.overwritePoints })
      );
    }
    return result;
  }

  /** A status or points step never undoes the comment: its failure is reported in the result */
  private async runStep(step: () => Promise<TicketStepResult>): Promise<TicketStepResult> {
    try {
      return await step();
    } catch (e) {
      uxLog('warning', this, c.yellow((e as Error).message));
      return stepFailure(e);
    }
  }

  // The authenticated account does not change during a run: one call per ticketing system
  private accountIds = new Map<string, string | null>();

  private async myAccountId(provider: TicketProviderRoot, providerLabel: string): Promise<string | null> {
    if (!this.accountIds.has(providerLabel)) {
      this.accountIds.set(providerLabel, (await provider.whoAmI()).id);
    }
    return this.accountIds.get(providerLabel) ?? null;
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
