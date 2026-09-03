import c from 'chalk';
import sortArray from '../utils/sortArray.js';
// Type-only: a value import here would close a runtime cycle index -> provider -> index
import type { Ticket, TicketsFromStringOptions } from './index.js';
import { recordTicketCollectionIssue, TicketProviderRoot } from './ticketProviderRoot.js';
import { extractRegexMatches, getCurrentGitBranch, uxLog } from '../utils/index.js';
import { getConfig, getEnvVar } from '../../config/index.js';
import { httpGet, httpPatch, httpPost } from '../utils/httpUtils.js';
import { CommonPullRequestInfo, GitProvider } from '../gitProvider/index.js';
import { WebSocketClient } from '../websocketClient.js';
import { t } from '../utils/i18n.js';
import {
  TicketDetails,
  TicketDetailsOptions,
  TicketRelatedItem,
  classifyAttachment,
  detectManualActions,
  htmlToPlainText,
  newTicketDetails,
  normalizeText,
  capText,
} from './ticketDetails.js';

// Record number prefix -> ServiceNow table. A record number carries its table, so a ticket id is
// enough to know where to query, without asking the user.
const SERVICENOW_TABLE_BY_PREFIX: Record<string, string> = {
  INC: 'incident',
  PRB: 'problem',
  CHG: 'change_request',
  RITM: 'sc_req_item',
  REQ: 'sc_request',
  SCTASK: 'sc_task',
  TASK: 'task',
  DMND: 'dmn_demand',
  STRY: 'rm_story',
  STORY: 'rm_story',
  ENHC: 'rm_enhancement',
  KB: 'kb_knowledge',
};

/**
 * Prefixes scanned by default in commit messages, branch names and Pull Request bodies.
 *
 * Deliberately narrower than the table mapping above: TASK, REQ, STORY and KB are ordinary words
 * followed by digits, and a false positive here does not merely add a line to a Pull Request
 * comment - it writes a work note on a real, unrelated ServiceNow record at the next deployment.
 * A project working in those tables declares them in SERVICENOW_TABLE_PREFIXES, or writes its own
 * SERVICENOW_TICKET_REGEX; either one is an explicit decision.
 *
 * `sf hardis ticket get --id TASK0001234` still works: routing an identifier the user typed reads
 * the full mapping, where only the automatic scanning is restricted.
 */
const SERVICENOW_DEFAULT_SCAN_PREFIXES = ['INC', 'PRB', 'CHG', 'RITM', 'SCTASK', 'DMND', 'STRY', 'ENHC'];

// Journal field a deployment note is written into. work_notes is the internal one: a deployment is
// an implementation detail the requester of an incident has no use for.
const SERVICENOW_DEFAULT_COMMENT_FIELD = 'work_notes';

/**
 * ServiceNow ticketing connector.
 *
 * Reuses the environment variables already documented for `sf hardis misc:servicenow-report`
 * (SERVICENOW_URL / SERVICENOW_USERNAME / SERVICENOW_PASSWORD), so a project that already reports
 * on ServiceNow needs no extra configuration to read a ticket.
 */
export class ServiceNowProvider extends TicketProviderRoot {
  public static readonly providerKey = 'servicenow' as const;
  public static readonly providerLabel = 'ServiceNow';
  public static readonly supportsTicketDetails = true;

  protected instanceUrl: string;
  protected user: string;
  protected password: string;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: any = {}) {
    super();
    this.instanceUrl = ServiceNowProvider.getInstanceUrl();
    this.user = getEnvVar('SERVICENOW_USERNAME') || '';
    this.password = getEnvVar('SERVICENOW_PASSWORD') || '';
    if (this.instanceUrl && this.user && this.password) {
      this.isActive = true;
    }
  }

  /** SERVICENOW_URL may be given as a bare instance host or as a full URL, with or without a trailing slash */
  private static getInstanceUrl(): string {
    const raw = getEnvVar('SERVICENOW_URL') || '';
    if (!raw) {
      return '';
    }
    const withScheme = raw.startsWith('http') ? raw : `https://${raw}`;
    return withScheme.replace(/\/+$/, '');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public static isAvailable(_config: any): boolean {
    return Boolean(getEnvVar('SERVICENOW_URL') && getEnvVar('SERVICENOW_USERNAME') && getEnvVar('SERVICENOW_PASSWORD'));
  }

  public getLabel(): string {
    return 'sfdx-hardis ServiceNow connector';
  }

  /**
   * Record number prefix -> table, with the project's own tables merged in.
   *
   * SERVICENOW_TABLE_PREFIXES (or the `serviceNowTablePrefixes` property) takes the form
   * `PREFIX:table,PREFIX:table`, so a scoped application (`STRY:x_acme_story`) is reachable without
   * a code change. A prefix declared there overrides the built-in mapping of the same name.
   */
  private static prefixTableMap(config: any = {}): Record<string, string> {
    return { ...SERVICENOW_TABLE_BY_PREFIX, ...ServiceNowProvider.declaredPrefixTables(config) };
  }

  /** Only what the project itself declared, which is also what it opts into scanning */
  private static declaredPrefixTables(config: any = {}): Record<string, string> {
    const declared: Record<string, string> = {};
    const raw = getEnvVar('SERVICENOW_TABLE_PREFIXES') || config?.serviceNowTablePrefixes || '';
    for (const entry of String(raw).split(',')) {
      const [prefix, table] = entry.split(':').map((part) => (part || '').trim());
      if (prefix && table) {
        declared[prefix.toUpperCase()] = table;
      }
    }
    return declared;
  }

  /**
   * The prefixes scanned automatically: the safe defaults, plus every prefix the project declared.
   *
   * A prefix is included because it was declared, not because it is unknown: `TASK:task` is a
   * project saying it works in that table, and that is exactly the opt-in the default list is
   * missing.
   */
  private static scanPrefixes(config: any = {}): string[] {
    const declared = Object.keys(ServiceNowProvider.declaredPrefixTables(config));
    return [...new Set([...SERVICENOW_DEFAULT_SCAN_PREFIXES, ...declared])];
  }

  /** A prefix comes from user configuration, so it cannot be dropped into a regex as it is */
  private static escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Regex matching the given prefixes, built from the mapping so a custom table is detected too.
   *
   * The whole record number is capture group 1, and the prefix alternation is a non-capturing
   * group: extractRegexMatches() only keeps group 1, and that is also the convention a project
   * writing its own SERVICENOW_TICKET_REGEX has to follow.
   */
  private static numberRegexSource(prefixes: string[]): string {
    // Longest first, so SCTASK is not consumed as the shorter TASK
    const sorted = [...prefixes].sort((a, b) => b.length - a.length).map((prefix) => ServiceNowProvider.escapeRegex(prefix));
    return `\\b((?:${sorted.join('|')})[0-9]{4,})\\b`;
  }

  /**
   * True when the identifier looks like a ServiceNow record number (prefix + digits).
   *
   * Reads the full mapping, not the narrower scan list: this routes an identifier a user typed,
   * where getTicketsFromString() decides what to pick up on its own.
   *
   * Never throws: a prefix holding a regex metacharacter would otherwise break the routing of
   * every connector, since TicketProvider.getTicketDetails() filters them all through this call.
   */
  public static matchesTicketId(ticketId: string, config: any = {}): boolean {
    try {
      const prefixes = Object.keys(ServiceNowProvider.prefixTableMap(config));
      return new RegExp(`^(?:${ServiceNowProvider.numberRegexSource(prefixes)})$`, 'i').test((ticketId || '').trim());
    } catch {
      return false;
    }
  }

  public static tableOfTicketId(ticketId: string, config: any = {}): string | null {
    const match = (ticketId || '').trim().toUpperCase().match(/^([A-Z_]+)([0-9]{4,})$/);
    if (!match) {
      return null;
    }
    return ServiceNowProvider.prefixTableMap(config)[match[1]] || null;
  }

  /**
   * Collects the ServiceNow record numbers of a commit message, a branch name or a Pull Request
   * body.
   *
   * Nothing is returned when the connector is not configured, and only the prefixes of
   * SERVICENOW_DEFAULT_SCAN_PREFIXES are looked for: what is collected here ends up commented on
   * at the next deployment, so a match has to be a deliberate reference, not a coincidence.
   * `INC0012345` inside a ServiceNow URL is matched by the same pass, and duplicates are collapsed
   * on the record number.
   */
  public static async getTicketsFromString(text: string, options: TicketsFromStringOptions = {}): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    const config = options.config || (await getConfig('project'));
    if (!this.isAvailable(config)) {
      return tickets;
    }
    const instanceUrl = ServiceNowProvider.getInstanceUrl();
    const customRegex = getEnvVar('SERVICENOW_TICKET_REGEX') || config?.serviceNowTicketRegex;
    let numberRegex: RegExp;
    try {
      numberRegex = new RegExp(customRegex || ServiceNowProvider.numberRegexSource(ServiceNowProvider.scanPrefixes(config)), 'gim');
    } catch (e: any) {
      // A malformed project regex must cost its own tickets, not the whole Pull Request comment
      uxLog('warning', this, c.yellow('[ServiceNowProvider] ' + t('serviceNowInvalidTicketRegex', { regex: String(customRegex), message: e.message })));
      return tickets;
    }
    const matches = await extractRegexMatches(numberRegex, text);
    for (const match of matches) {
      const ticketId = match.trim().toUpperCase();
      const table = ServiceNowProvider.tableOfTicketId(ticketId, config);
      if (!table) {
        // A custom SERVICENOW_TICKET_REGEX can match a prefix no table is declared for: without a
        // table the record cannot be read, so say which mapping is missing rather than emit a dead link
        uxLog('log', this, c.grey('[ServiceNowProvider] ' + t('serviceNowUnknownPrefix', { ticketId })));
        continue;
      }
      if (tickets.some((ticket) => ticket.id === ticketId)) {
        continue;
      }
      tickets.push({
        provider: 'SERVICENOW',
        id: ticketId,
        url: ServiceNowProvider.recordUrlByNumber(instanceUrl, table, ticketId),
      });
    }
    return sortArray(tickets, { by: ['id'], order: ['asc'] }) as Ticket[];
  }

  /** Link usable before the record has been read: ServiceNow resolves the form from the number */
  private static recordUrlByNumber(instanceUrl: string, table: string, number: string): string {
    return `${instanceUrl}/${table}.do?sysparm_query=number=${number}`;
  }

  /** Link to the record form, once its sys_id is known */
  private static recordUrlBySysId(instanceUrl: string, table: string, sysId: string): string {
    return `${instanceUrl}/nav_to.do?uri=/${table}.do?sys_id=${sysId}`;
  }

  private authConfig() {
    return { auth: { username: this.user, password: this.password }, timeout: 60000 };
  }

  /** Basic auth header, needed to download attachments outside of the JSON Table API */
  private authHeaders(): Record<string, string> {
    return {
      Authorization: 'Basic ' + Buffer.from(`${this.user}:${this.password}`).toString('base64'),
    };
  }

  /**
   * Fetches one record by its number. `sysparm_display_value=all` returns both the raw value and the
   * human label of every field, so reference fields read as names rather than sys_ids.
   */
  private async fetchRecord(table: string, number: string): Promise<any | null> {
    const url = `${this.instanceUrl}/api/now/table/${table}`;
    const response = await httpGet(url, {
      ...this.authConfig(),
      params: {
        sysparm_query: `number=${number}`,
        sysparm_limit: 1,
        sysparm_display_value: 'all',
      },
    });
    const results = response?.data?.result || [];
    return results.length ? results[0] : null;
  }

  /** Field values come back as { value, display_value } with sysparm_display_value=all */
  private static fieldValue(record: any, fieldName: string): string {
    const field = record?.[fieldName];
    if (field === undefined || field === null) {
      return '';
    }
    if (typeof field === 'object') {
      return String(field.display_value ?? field.value ?? '');
    }
    return String(field);
  }

  /** sys_id is needed to write on the record, and never has a display value distinct from its value */
  private static rawFieldValue(record: any, fieldName: string): string {
    const field = record?.[fieldName];
    if (field === undefined || field === null) {
      return '';
    }
    if (typeof field === 'object') {
      return String(field.value ?? field.display_value ?? '');
    }
    return String(field);
  }

  // Journal fields that some instances expose on the record itself. Read only as a fallback: they
  // carry no author nor date, where sys_journal_field carries one entry per comment.
  private static readonly RECORD_JOURNAL_FIELDS = ['comments', 'work_notes', 'close_notes', 'resolution_notes'];

  /**
   * Comments and work notes read from the record itself.
   *
   * Used when sys_journal_field yields nothing: that table is ACL-restricted on many instances, and
   * ServiceNow answers a denied read with an empty result rather than a 403 - so without this
   * fallback a ticket full of comments comes back looking like a ticket with none.
   */
  private static journalsFromRecord(record: any): { author: string; date: string; body: string }[] {
    const entries: { author: string; date: string; body: string }[] = [];
    for (const fieldName of ServiceNowProvider.RECORD_JOURNAL_FIELDS) {
      const value = normalizeText(ServiceNowProvider.fieldValue(record, fieldName));
      if (value) {
        entries.push({ author: '', date: '', body: `[${fieldName}] ${value}` });
      }
    }
    return entries;
  }

  /** Work notes / comments live in the sys_journal_field table, not on the record itself */
  private async fetchJournals(table: string, sysId: string): Promise<{ author: string; date: string; body: string }[]> {
    try {
      const response = await httpGet(`${this.instanceUrl}/api/now/table/sys_journal_field`, {
        ...this.authConfig(),
        params: {
          sysparm_query: `element_id=${sysId}^ORDERBYsys_created_on`,
          sysparm_limit: 500,
          sysparm_display_value: 'all',
        },
      });
      return (response?.data?.result || []).map((journal: any) => ({
        author: ServiceNowProvider.fieldValue(journal, 'sys_created_by'),
        date: ServiceNowProvider.fieldValue(journal, 'sys_created_on'),
        body: `[${ServiceNowProvider.fieldValue(journal, 'element')}] ${normalizeText(ServiceNowProvider.fieldValue(journal, 'value'))}`,
      }));
    } catch (e: any) {
      uxLog('warning', this, c.yellow('[ServiceNowProvider] ' + t('serviceNowJournalsError', { message: e.message })));
      return [];
    }
  }

  private async fetchAttachmentsMeta(table: string, sysId: string): Promise<any[]> {
    try {
      const response = await httpGet(`${this.instanceUrl}/api/now/attachment`, {
        ...this.authConfig(),
        params: { sysparm_query: `table_name=${table}^table_sys_id=${sysId}`, sysparm_limit: 100 },
      });
      return response?.data?.result || [];
    } catch (e: any) {
      uxLog('warning', this, c.yellow('[ServiceNowProvider] ' + t('serviceNowAttachmentsError', { message: e.message })));
      return [];
    }
  }

  /**
   * Fills the subject, the state and the assignment of every ServiceNow ticket of the list.
   *
   * Deliberately shallow: this runs on every ticket of a Pull Request, where getTicketDetails()
   * fetches one ticket in full. The sys_id read here is kept on the ticket, so posting the
   * deployment note later does not need a second lookup.
   */
  public async collectTicketsInfo(tickets: Ticket[]): Promise<Ticket[]> {
    const serviceNowTickets = tickets.filter((ticket) => ticket.provider === 'SERVICENOW');
    if (serviceNowTickets.length === 0) {
      return tickets;
    }
    uxLog(
      'action',
      this,
      c.cyan('[ServiceNowProvider] ' + t('serviceNowProviderCollectingTickets', {
        count: serviceNowTickets.length,
        instanceUrl: this.instanceUrl,
      }))
    );
    const config = await getConfig('project');
    // One HTTP call per ticket: show a progress bar instead of flooding the log with one line each
    const showProgress = serviceNowTickets.length > 1;
    if (showProgress) {
      WebSocketClient.sendProgressStartMessage(t('collectingTicketsInfo', { count: serviceNowTickets.length }), serviceNowTickets.length);
    }
    let collectedTicketsNumber = 0;
    let failedTicketsNumber = 0;
    let firstErrorMessage = '';
    // try/finally so the progress bar never stays stuck in the VS Code UI when a fetch throws
    try {
      for (const ticket of serviceNowTickets) {
        const table = ServiceNowProvider.tableOfTicketId(ticket.id, config);
        if (!table) {
          continue;
        }
        try {
          const record = await this.fetchRecord(table, ticket.id);
          if (record) {
            const sysId = ServiceNowProvider.rawFieldValue(record, 'sys_id');
            ticket.foundOnServer = true;
            ticket.providerRecordId = sysId;
            ticket.subject = ServiceNowProvider.fieldValue(record, 'short_description');
            ticket.status = ServiceNowProvider.rawFieldValue(record, 'state');
            ticket.statusLabel = ServiceNowProvider.fieldValue(record, 'state');
            const assignee = ServiceNowProvider.fieldValue(record, 'assigned_to');
            const reporter = ServiceNowProvider.fieldValue(record, 'opened_by') || ServiceNowProvider.fieldValue(record, 'sys_created_by');
            if (assignee) {
              ticket.assignee = ServiceNowProvider.rawFieldValue(record, 'assigned_to');
              ticket.assigneeLabel = assignee;
            }
            if (reporter) {
              ticket.reporter = ServiceNowProvider.rawFieldValue(record, 'opened_by') || reporter;
              ticket.reporterLabel = reporter;
            }
            ticket.author = ticket.assignee || ticket.reporter;
            ticket.authorLabel = assignee || reporter;
            if (sysId) {
              ticket.url = ServiceNowProvider.recordUrlBySysId(this.instanceUrl, table, sysId);
            }
            // "other" keeps this per-ticket line out of the VS Code UI, where the progress bar shows instead
            uxLog('other', this, c.grey('[ServiceNowProvider] ' + t('serviceNowProviderCollectedTicket', { ticketId: ticket.id })));
          } else {
            // The number matched the shape but no record answers: a typo, or a table the CI user cannot read
            failedTicketsNumber++;
            firstErrorMessage = firstErrorMessage || `no ${table} record numbered ${ticket.id}`;
            uxLog('log', this, c.grey('[ServiceNowProvider] ' + t('serviceNowProviderRecordNotFound', { ticketId: ticket.id, table })));
          }
        } catch (e: any) {
          // A single aggregated warning is displayed after the loop: per-ticket failures usually
          // share the same cause (expired credential, missing ACL) and would flood the log.
          failedTicketsNumber++;
          firstErrorMessage = firstErrorMessage || e.message;
          uxLog('log', this, c.grey('[ServiceNowProvider] ' + t('serviceNowRecordError', { ticketId: ticket.id, message: e.message })));
        }
        collectedTicketsNumber++;
        if (showProgress) {
          WebSocketClient.sendProgressStepMessage(collectedTicketsNumber, serviceNowTickets.length);
        }
      }
    } finally {
      if (showProgress) {
        WebSocketClient.sendProgressEndMessage(serviceNowTickets.length);
      }
    }
    if (failedTicketsNumber > 0) {
      uxLog('warning', this, c.yellow('[ServiceNowProvider] ' + t('serviceNowProviderTicketsCollectionFailed', {
        failed: failedTicketsNumber,
        total: serviceNowTickets.length,
        message: firstErrorMessage,
      })));
      recordTicketCollectionIssue(
        `Details could not be retrieved for ${failedTicketsNumber} of ${serviceNowTickets.length} ServiceNow ticket(s) (first error: ${firstErrorMessage}). Check the ServiceNow credentials and ACLs of the CI job.`
      );
    }
    return tickets;
  }

  public async getTicketDetails(ticketId: string, options: TicketDetailsOptions = {}): Promise<TicketDetails | null> {
    const number = (ticketId || '').trim().toUpperCase();
    const config = await getConfig('project');
    const table = ServiceNowProvider.tableOfTicketId(number, config);
    if (!table) {
      uxLog('warning', this, c.yellow('[ServiceNowProvider] ' + t('serviceNowUnknownPrefix', { ticketId: number })));
      return null;
    }
    const record = await this.fetchRecord(table, number);
    if (!record) {
      return null;
    }
    const sysId = ServiceNowProvider.rawFieldValue(record, 'sys_id');
    const details = newTicketDetails('SERVICENOW', number);
    details.url = ServiceNowProvider.recordUrlBySysId(this.instanceUrl, table, sysId);
    details.subject = ServiceNowProvider.fieldValue(record, 'short_description');
    details.type = table;
    details.status = ServiceNowProvider.fieldValue(record, 'state');
    details.priority = ServiceNowProvider.fieldValue(record, 'priority');
    details.assignee = ServiceNowProvider.fieldValue(record, 'assigned_to');
    details.reporter = ServiceNowProvider.fieldValue(record, 'opened_by') || ServiceNowProvider.fieldValue(record, 'sys_created_by');
    details.created = ServiceNowProvider.fieldValue(record, 'sys_created_on');
    details.updated = ServiceNowProvider.fieldValue(record, 'sys_updated_on');
    details.resolved = ServiceNowProvider.fieldValue(record, 'closed_at') || ServiceNowProvider.fieldValue(record, 'resolved_at');
    details.parent = ServiceNowProvider.fieldValue(record, 'parent');
    const descriptionRaw = ServiceNowProvider.fieldValue(record, 'description');
    details.description = capText(/<[a-z][\s\S]*>/i.test(descriptionRaw) ? htmlToPlainText(descriptionRaw) : normalizeText(descriptionRaw));
    details.acceptanceCriteria = capText(normalizeText(ServiceNowProvider.fieldValue(record, 'acceptance_criteria')));
    for (const fieldName of ['category', 'subcategory', 'assignment_group', 'cmdb_ci', 'business_service', 'impact', 'urgency', 'approval']) {
      const value = ServiceNowProvider.fieldValue(record, fieldName);
      if (value) {
        details.extra[fieldName] = value;
      }
    }

    let journals = await this.fetchJournals(table, sysId);
    if (journals.length === 0) {
      journals = ServiceNowProvider.journalsFromRecord(record);
      // Say it either way: an empty sys_journal_field is indistinguishable from a denied read, and a
      // ticket that silently comes back with no comments is worse than one that says it might have some.
      uxLog('log', this, c.grey('[ServiceNowProvider] ' + t('serviceNowNoJournalEntries', { count: journals.length })));
    }
    details.comments = journals.map((journal) => ({
      author: journal.author,
      date: journal.date,
      body: capText(journal.body),
    }));

    if (details.parent) {
      const parentItem: TicketRelatedItem = { relation: 'parent', id: details.parent, title: '', status: '', url: '' };
      details.links.push(parentItem);
    }

    const attachmentsMeta = await this.fetchAttachmentsMeta(table, sysId);
    details.attachments = attachmentsMeta.map((attachment: any) => ({
      filename: attachment.file_name || 'attachment',
      contentType: attachment.content_type || '',
      size: Number(attachment.size_bytes || 0),
      created: attachment.sys_created_on || '',
      author: attachment.sys_created_by || '',
      url: attachment.download_link || `${this.instanceUrl}/api/now/attachment/${attachment.sys_id}/file`,
      kind: classifyAttachment(attachment.content_type || '', attachment.file_name || ''),
      localPath: null,
      textContent: null,
      truncated: false,
      error: null,
    }));

    await this.downloadDetailsAttachments(details, this.instanceUrl, this.authHeaders(), options);

    details.manualActions = detectManualActions([
      details.description,
      details.acceptanceCriteria,
      ...details.comments.map((comment) => comment.body),
      ...details.attachments.map((attachment) => attachment.textContent),
    ]);
    return details;
  }

  /**
   * Writes a deployment note in the journal of every deployed ticket, and optionally tags them.
   *
   * The note goes to `work_notes` by default, the internal journal: on an incident, `comments` is
   * read by the person who reported it, and a Salesforce deployment is not addressed to them. Set
   * SERVICENOW_COMMENT_FIELD to write elsewhere.
   *
   * Tagging is opt-in (SERVICENOW_ADD_DEPLOYMENT_TAG), where JIRA and Azure Boards tag by default:
   * a ServiceNow tag is a record of the global `label` table, so creating one on every deployment
   * is a write no project should get without asking for it.
   */
  public async postDeploymentComments(tickets: Ticket[], org: string, pullRequestInfo: CommonPullRequestInfo | null): Promise<Ticket[]> {
    const serviceNowTickets = tickets.filter((ticket) => ticket.provider === 'SERVICENOW' && ticket.foundOnServer);
    if (serviceNowTickets.length === 0) {
      return tickets;
    }
    uxLog('action', this, c.cyan('[ServiceNowProvider] ' + t('serviceNowProviderPostingComments', { count: serviceNowTickets.length })));
    const config = await getConfig('project');
    const commentField = getEnvVar('SERVICENOW_COMMENT_FIELD') || config?.serviceNowCommentField || SERVICENOW_DEFAULT_COMMENT_FIELD;
    // Env var wins in both directions: a pipeline must be able to turn off what .sfdx-hardis.yml turned on
    const addTagEnv = getEnvVar('SERVICENOW_ADD_DEPLOYMENT_TAG');
    const addTag = addTagEnv ? addTagEnv === 'true' : config?.serviceNowAddDeploymentTag === true;
    // Only resolved when tagging is on: computing it reads the git branch and the Pull Request
    const tag = addTag ? await this.getDeploymentTag() : '';
    const commentText = await this.buildDeploymentComment(org, pullRequestInfo);
    const commentedTickets: Ticket[] = [];
    const taggedTickets: Ticket[] = [];
    for (const ticket of serviceNowTickets) {
      const table = ServiceNowProvider.tableOfTicketId(ticket.id, config);
      if (!table) {
        continue;
      }
      const sysId = ticket.providerRecordId || (await this.resolveSysId(table, ticket.id));
      if (!sysId) {
        uxLog('warning', this, c.yellow('[ServiceNowProvider] ' + t('serviceNowProviderNoSysId', { ticketId: ticket.id })));
        continue;
      }
      try {
        await httpPatch(`${this.instanceUrl}/api/now/table/${table}/${sysId}`, { [commentField]: commentText }, this.authConfig());
        commentedTickets.push(ticket);
      } catch (e: any) {
        uxLog('warning', this, c.yellow('[ServiceNowProvider] ' + t('serviceNowProviderErrorPostingComment', { ticketId: ticket.id, message: e.message })));
      }
      if (addTag) {
        try {
          await this.addTagOnRecord(table, sysId, tag);
          taggedTickets.push(ticket);
        } catch (e: any) {
          uxLog('warning', this, c.yellow('[ServiceNowProvider] ' + t('serviceNowProviderErrorAddingTag', { tag, ticketId: ticket.id, message: e.message })));
        }
      }
    }
    if (commentedTickets.length > 0) {
      uxLog('log', this, c.grey('[ServiceNowProvider] ' + t('serviceNowProviderPostedComments', {
        count: commentedTickets.length,
        field: commentField,
        tickets: commentedTickets.map((ticket) => ticket.id).join(', '),
      })));
    }
    if (taggedTickets.length > 0) {
      uxLog('log', this, c.grey('[ServiceNowProvider] ' + t('serviceNowProviderAddedTag', {
        tag,
        count: taggedTickets.length,
        tickets: taggedTickets.map((ticket) => ticket.id).join(', '),
      })));
    }
    return tickets;
  }

  /**
   * Journal entries are plain text: ServiceNow escapes HTML and renders no markdown in them, so the
   * note spells its links out instead of hiding them behind a label.
   */
  private async buildDeploymentComment(org: string, pullRequestInfo: CommonPullRequestInfo | null): Promise<string> {
    const orgLabel = org.replace('https://', '').replace('.my.salesforce.com', '');
    const branchName = (await getCurrentGitBranch()) || '';
    const branchUrl = (await GitProvider.getCurrentBranchUrl()) || '';
    const lines = [`Deployed by sfdx-hardis in Salesforce org ${orgLabel}${org ? ` (${org})` : ''}`];
    if (branchName) {
      lines.push(`Branch: ${branchName}${branchUrl ? ` (${branchUrl})` : ''}`);
    }
    if (pullRequestInfo?.webUrl) {
      const author = pullRequestInfo.authorName ? ` by ${pullRequestInfo.authorName}` : '';
      lines.push(`Pull Request: ${pullRequestInfo.title} (${pullRequestInfo.webUrl})${author}`);
    }
    return lines.join('\n');
  }

  /** Only needed when the note is posted without a prior collectTicketsInfo() on the same ticket */
  private async resolveSysId(table: string, number: string): Promise<string> {
    try {
      const record = await this.fetchRecord(table, number);
      return record ? ServiceNowProvider.rawFieldValue(record, 'sys_id') : '';
    } catch (e: any) {
      uxLog('log', this, c.grey('[ServiceNowProvider] ' + t('serviceNowRecordError', { ticketId: number, message: e.message })));
      return '';
    }
  }

  /**
   * Tags a record the way the ServiceNow UI does: a row in `label_entry` pointing at a `label`
   * record. The label is created on first use, so the deployment tag does not have to be declared
   * by hand in the instance.
   */
  private async addTagOnRecord(table: string, sysId: string, tag: string): Promise<void> {
    const existing = await httpGet(`${this.instanceUrl}/api/now/table/label`, {
      ...this.authConfig(),
      params: { sysparm_query: `name=${tag}`, sysparm_limit: 1, sysparm_fields: 'sys_id' },
    });
    let labelSysId = existing?.data?.result?.[0]?.sys_id || '';
    if (!labelSysId) {
      const created = await httpPost(`${this.instanceUrl}/api/now/table/label`, { name: tag, viewable_by: 'everyone' }, this.authConfig());
      labelSysId = created?.data?.result?.sys_id || '';
    }
    if (!labelSysId) {
      throw new Error(`the label ${tag} could not be resolved nor created`);
    }
    // Idempotent: re-deploying the same branch must not stack duplicate entries on the record
    const alreadyTagged = await httpGet(`${this.instanceUrl}/api/now/table/label_entry`, {
      ...this.authConfig(),
      params: { sysparm_query: `label=${labelSysId}^table=${table}^table_key=${sysId}`, sysparm_limit: 1, sysparm_fields: 'sys_id' },
    });
    if (alreadyTagged?.data?.result?.length) {
      return;
    }
    await httpPost(
      `${this.instanceUrl}/api/now/table/label_entry`,
      { label: labelSysId, table, table_key: sysId, title: tag },
      this.authConfig()
    );
  }
}
