import c from 'chalk';
import sortArray from '../utils/sortArray.js';
// Type-only: a value import here would close a runtime cycle index -> provider -> index
import type { Ticket, TicketsFromStringOptions } from './index.js';
import { recordTicketCollectionIssue, TicketProviderRoot } from './ticketProviderRoot.js';
import { extractRegexMatches, uxLog } from '../utils/index.js';
import { PROVIDER_BATCH_PROFILES, mapInAdaptiveBatchesSettled } from '../utils/adaptiveBatch.js';
import { getConfig, getEnvVar } from '../../config/index.js';
import { httpGet, httpPatch, httpPost } from '../utils/httpUtils.js';
import { CommonPullRequestInfo } from '../gitProvider/index.js';
import { SfError } from '@salesforce/core';
import { WebSocketClient } from '../websocketClient.js';
import { PostCommentOptions, PostCommentResult, buildDeploymentCommentMarkdown, markdownMarkerFooter } from './utils/ticketComment.js';
import { markdownToPlainText } from './utils/markdownToTicketFormats.js';
import { t } from '../utils/i18n.js';
import {
  TICKET_ERROR,
  TicketErrorContext,
  TicketOperation,
  TicketSearchCriteria,
  TicketSearchOptions,
  TicketSearchResult,
  TicketSummary,
  toTicketError,
} from './utils/ticketOperations.js';
import {
  TicketAssignee,
  TicketIdentity,
  TicketPointsOptions,
  TicketProjectMeta,
  TicketProjectSummary,
  TicketStepResult,
  mentionLead,
  retryReadOn5xx,
} from './utils/ticketQualify.js';
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
} from './utils/ticketDetails.js';

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
  public static readonly supportsComments = true;

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
  public static getInstanceUrl(): string {
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

  /**
   * Link to the record form, once its sys_id is known.
   * The form URL is given directly, not wrapped in nav_to.do: the Next Experience UI rewrites
   * nav_to.do?uri=... into /now/nav/ui/classic/params/target/... and encodes the inner "?" twice,
   * which lands on "Page not found". A bare form URL is wrapped by both UIs on their own.
   */
  private static recordUrlBySysId(instanceUrl: string, table: string, sysId: string): string {
    return `${instanceUrl}/${table}.do?sys_id=${sysId}`;
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
  private static journalsFromRecord(record: any): { author: string; authorId?: string | null; date: string; body: string }[] {
    const entries: { author: string; authorId?: string | null; date: string; body: string }[] = [];
    for (const fieldName of ServiceNowProvider.RECORD_JOURNAL_FIELDS) {
      const value = normalizeText(ServiceNowProvider.fieldValue(record, fieldName));
      if (!value) {
        continue;
      }
      // A journal field reads "<date> - <author> (Work notes)\n<text>" for each entry, newest first
      const headers = [...value.matchAll(ServiceNowProvider.JOURNAL_HEADER_RE)];
      if (headers.length === 0) {
        entries.push({ author: '', date: '', body: `[${fieldName}] ${value}` });
        continue;
      }
      headers.forEach((header, index) => {
        const end = index + 1 < headers.length ? headers[index + 1].index : value.length;
        const text = normalizeText(value.slice((header.index ?? 0) + header[0].length, end));
        entries.push({ author: header[2], date: header[1], body: `${text}\n\n[${fieldName}]` });
      });
    }
    return entries.sort((a, b) => a.date.localeCompare(b.date));
  }

  private static readonly JOURNAL_HEADER_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) - (.+?) \([^)\n]+\)\n/gm;

  /** Work notes / comments live in the sys_journal_field table, not on the record itself */
  private async fetchJournals(table: string, sysId: string): Promise<{ author: string; authorId?: string | null; date: string; body: string }[]> {
    try {
      const response = await httpGet(`${this.instanceUrl}/api/now/table/sys_journal_field`, {
        ...this.authConfig(),
        params: {
          sysparm_query: `element_id=${sysId}^ORDERBYsys_created_on`,
          sysparm_limit: 500,
          sysparm_display_value: 'all',
        },
      });
      // The journal field goes last: a comment must start with its own first line, which the
      // --skip-if-marked check of ticket post-comment compares with --prefix
      return (response?.data?.result || []).map((journal: any) => ({
        author: ServiceNowProvider.fieldValue(journal, 'sys_created_by'),
        authorId: ServiceNowProvider.rawFieldValue(journal, 'sys_created_by') || null,
        date: ServiceNowProvider.fieldValue(journal, 'sys_created_on'),
        body: `${normalizeText(ServiceNowProvider.fieldValue(journal, 'value'))}\n\n[${ServiceNowProvider.fieldValue(journal, 'element')}]`,
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
    let failedTicketsNumber = 0;
    let firstErrorMessage = '';
    // try/finally so the progress bar never stays stuck in the VS Code UI when a fetch throws
    try {
      // One HTTP call per ticket, in the adaptive batches of the ServiceNow ladder (a node serves a
      // few REST calls at a time), shrunk only when the instance throttles. A single aggregated warning
      // is displayed after the loop: per-ticket failures usually share the same cause (expired
      // credential, missing ACL) and would flood the log.
      const ticketsWithTable = serviceNowTickets
        .map((ticket) => ({ ticket, table: ServiceNowProvider.tableOfTicketId(ticket.id, config) }))
        .filter((entry): entry is { ticket: Ticket; table: string } => !!entry.table);
      const failedIds = new Set<string>();
      const records = await mapInAdaptiveBatchesSettled(ticketsWithTable, (entry) => this.fetchRecord(entry.table, entry.ticket.id), {
        sizes: PROVIDER_BATCH_PROFILES.serviceNow,
        onBackoff: (size, e, waitMs) => uxLog('log', this, c.grey('[ServiceNowProvider] ' + t('providerThrottledBackoff', { count: size, waitSeconds: Math.round(waitMs / 1000), message: (e as Error)?.message || '' }))),
        onError: (e: any, entry) => {
          failedIds.add(entry.ticket.id);
          failedTicketsNumber++;
          firstErrorMessage = firstErrorMessage || e.message;
          uxLog('log', this, c.grey('[ServiceNowProvider] ' + t('serviceNowRecordError', { ticketId: entry.ticket.id, message: e.message })));
        },
        onProgress: (done, total) => {
          if (showProgress) {
            WebSocketClient.sendProgressStepMessage(done, total);
          }
        },
      });
      for (const [index, { ticket, table }] of ticketsWithTable.entries()) {
        const record = records[index] ?? null;
        {
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
          } else if (!failedIds.has(ticket.id)) {
            // The number matched the shape but no record answers: a typo, or a table the CI user cannot read
            failedTicketsNumber++;
            firstErrorMessage = firstErrorMessage || `no ${table} record numbered ${ticket.id}`;
            uxLog('log', this, c.grey('[ServiceNowProvider] ' + t('serviceNowProviderRecordNotFound', { ticketId: ticket.id, table })));
          }
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
    details.assigneeId = await this.userNameOf(ServiceNowProvider.rawFieldValue(record, 'assigned_to'));
    details.reporter = ServiceNowProvider.fieldValue(record, 'opened_by') || ServiceNowProvider.fieldValue(record, 'sys_created_by');
    details.reporterId = ServiceNowProvider.rawFieldValue(record, 'sys_created_by') || null;
    // The table is the project: it is what ticket list --project and --allowed-projects name
    details.project = table;
    details.labels = await this.tagsOfRecord(table, sysId);
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

    let journals = options.skipComments ? [] : await this.fetchJournals(table, sysId);
    if (journals.length === 0 && !options.skipComments) {
      journals = ServiceNowProvider.journalsFromRecord(record);
      // The record gives the display name of each author only: the entries of the authenticated
      // account get its user name, the id ticket whoami returns, so --skip-if-marked can find them
      if (journals.some((journal) => journal.author)) {
        const me = await this.whoAmI().catch(() => null);
        for (const journal of journals) {
          journal.authorId = me?.displayName && journal.author === me.displayName ? me.id : null;
        }
      }
      // Say it either way: an empty sys_journal_field is indistinguishable from a denied read, and a
      // ticket that silently comes back with no comments is worse than one that says it might have some.
      uxLog('log', this, c.grey('[ServiceNowProvider] ' + t('serviceNowNoJournalEntries', { count: journals.length })));
    }
    details.comments = journals.map((journal) => ({
      author: journal.author,
      authorId: journal.authorId ?? null,
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
    const config = await getConfig('project');
    // Env var wins in both directions, like the deployment tag: a pipeline that must stay read-only
    // on the tickets (the CI user may not write work notes) keeps the ticket list in the Pull
    // Request comments and the notifications, and skips the write
    const postCommentsEnv = getEnvVar('SERVICENOW_POST_DEPLOYMENT_COMMENTS');
    const postComments = postCommentsEnv ? postCommentsEnv !== 'false' : config?.serviceNowPostDeploymentComments !== false;
    if (!postComments) {
      uxLog('log', this, c.grey('[ServiceNowProvider] ' + t('serviceNowProviderCommentsDisabled', { count: serviceNowTickets.length })));
      return tickets;
    }
    uxLog('action', this, c.cyan('[ServiceNowProvider] ' + t('serviceNowProviderPostingComments', { count: serviceNowTickets.length })));
    let commentField: string;
    try {
      commentField = ServiceNowProvider.commentFieldOf(undefined, config);
    } catch (e: any) {
      // A wrong field name in the configuration must not stop the deployment job
      uxLog('warning', this, c.yellow('[ServiceNowProvider] ' + e.message));
      return tickets;
    }
    // Env var wins in both directions: a pipeline must be able to turn off what .sfdx-hardis.yml turned on
    const addTagEnv = getEnvVar('SERVICENOW_ADD_DEPLOYMENT_TAG');
    const addTag = addTagEnv ? addTagEnv === 'true' : config?.serviceNowAddDeploymentTag === true;
    // Only resolved when tagging is on: computing it reads the git branch and the Pull Request
    const tag = addTag ? await this.getDeploymentTag() : '';
    const commentMarkdown = await buildDeploymentCommentMarkdown(org, pullRequestInfo);
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
        await this.writeNote(table, sysId, commentField, commentMarkdown);
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
   * Writes a markdown comment as plain text in a journal field of the record, `work_notes` by
   * default. A journal entry cannot be edited: with a marker, a new note is added, ending with the
   * marker line, and a warning says so.
   */
  public async postComment(ticketId: string, markdown: string, options: PostCommentOptions = {}): Promise<PostCommentResult> {
    // Journal notes cannot be restricted: refused by the base check, before any call
    this.validateQualifyOptions({ visibility: options.visibility });
    const config = await getConfig('project');
    const number = (ticketId || '').trim().toUpperCase();
    const table = ServiceNowProvider.tableOfTicketId(number, config);
    if (!table) {
      throw new SfError(t('ticketDetailsUnknownIdShape', { ticketId: number }));
    }
    const field = ServiceNowProvider.commentFieldOf(options.serviceNowField, config);
    const sysId = await this.resolveSysId(table, number);
    if (!sysId) {
      throw new SfError(t('serviceNowProviderNoSysId', { ticketId: number }));
    }
    if (options.marker) {
      uxLog('warning', this, c.yellow('[ServiceNowProvider] ' + t('ticketCommentServiceNowNotEditable', { ticketId: number })));
    }
    const text = ServiceNowProvider.withMention(markdown, options.mention);
    await this.writeNote(table, sysId, field, text + markdownMarkerFooter(options.marker));
    return {
      ticketId: number,
      provider: ServiceNowProvider.providerLabel,
      action: 'created',
      url: ServiceNowProvider.recordUrlBySysId(this.instanceUrl, table, sysId),
    };
  }

  public normalizeTicketId(ticketId: string): string {
    return (ticketId || '').trim().toUpperCase();
  }

  /**
   * The neutral criteria become an encoded query. The project is the table (incident, rm_story...):
   * one is required, several are searched in `task` with `sys_class_nameIN`. Values holding a
   * character the encoded query reserves (^, and a comma in a list) are refused.
   */
  public async searchTickets(criteria: TicketSearchCriteria, options: TicketSearchOptions): Promise<TicketSearchResult> {
    const projects = criteria.projects || [];
    if (projects.length === 0) {
      throw new SfError(t('ticketSearchProjectRequired', { provider: ServiceNowProvider.providerLabel }), TICKET_ERROR.queryInvalid);
    }
    const table = projects.length === 1 ? ServiceNowProvider.tableName(projects[0]) : 'task';
    const query = await this.toEncodedQuery(table, criteria, projects.length > 1 ? projects.map((project) => ServiceNowProvider.tableName(project)) : []);
    let offset = Number(options.pageToken || 0) || 0;
    const tickets: TicketSummary[] = [];
    let nextPageToken: string | null = null;
    for (;;) {
      const limit = Math.min(options.maxResults - tickets.length, ServiceNowProvider.SEARCH_PAGE_SIZE);
      const response: any = await this.runOperation({ operation: 'list' }, () =>
        retryReadOn5xx(() =>
          httpGet(`${this.instanceUrl}/api/now/table/${table}`, {
            ...this.authConfig(),
            params: { sysparm_query: query, sysparm_limit: limit, sysparm_offset: offset, sysparm_display_value: 'all', sysparm_fields: ServiceNowProvider.SEARCH_FIELDS },
          })
        )
      );
      const records: any[] = response?.data?.result || [];
      tickets.push(...records.map((record) => this.toTicketSummary(record)));
      offset += records.length;
      const total = Number(response?.headers?.['x-total-count'] ?? 0);
      const more = records.length > 0 && (total ? offset < total : records.length === limit);
      if (!more) {
        break;
      }
      if (tickets.length >= options.maxResults) {
        nextPageToken = String(offset);
        break;
      }
    }
    return { tickets, nextPageToken, truncated: nextPageToken !== null };
  }

  /** Tags the record (label_entry), as the deployment tag does */
  public async addTicketLabel(ticketId: string, label: string): Promise<void> {
    const { table, sysId, number } = await this.requireRecord(ticketId, 'label');
    await this.runOperation({ operation: 'label', ticketId: number }, () => this.addTagOnRecord(table, sysId, label));
  }

  /** The id is the user name: it is what sys_created_by holds on every journal entry */
  public async whoAmI(): Promise<TicketIdentity> {
    const response: any = await this.runOperation({ operation: 'whoami' }, () =>
      retryReadOn5xx(() =>
        httpGet(`${this.instanceUrl}/api/now/table/sys_user`, {
          ...this.authConfig(),
          params: { sysparm_query: `user_name=${this.user}`, sysparm_limit: 1, sysparm_fields: 'user_name,name,email' },
        })
      )
    );
    const user = response?.data?.result?.[0] || {};
    return { id: user.user_name || this.user || null, displayName: user.name || null, email: user.email || null };
  }

  /** The projects are the tables a record number maps to */
  public async listProjects(): Promise<TicketProjectSummary[]> {
    const config = await getConfig('project');
    const byTable = new Map<string, string[]>();
    for (const [prefix, table] of Object.entries(ServiceNowProvider.prefixTableMap(config))) {
      byTable.set(table, [...(byTable.get(table) || []), prefix]);
    }
    return [...byTable].map(([table, prefixes]) => ({ key: table, name: `${table} (${prefixes.join(', ')})` }));
  }

  /** The states of the table, from its choice list */
  public async getProjectMeta(project: string): Promise<TicketProjectMeta> {
    const table = ServiceNowProvider.tableName(project);
    const states = await this.statesOf(table, 'meta');
    return {
      project: table,
      issueTypes: [{ id: table, name: table }],
      statuses: states.map((state) => ({ id: state.value, name: state.label })),
      statusesByType: { [table]: states.map((state) => state.label) },
    };
  }

  /** The state of the record, matched on the label or the value of the choice list, without case */
  public async transitionTicket(ticketId: string, status: string): Promise<string> {
    const { table, sysId, number } = await this.requireRecord(ticketId, 'transition');
    const wanted = status.trim().toLowerCase();
    const match = (await this.statesOf(table, 'transition')).find((state) => state.label.toLowerCase() === wanted || state.value.toLowerCase() === wanted);
    if (!match) {
      throw new SfError(t('ticketStateNotAvailable', { status, type: table }), TICKET_ERROR.transitionInvalid);
    }
    await this.runOperation({ operation: 'transition', ticketId: number }, () =>
      httpPatch(`${this.instanceUrl}/api/now/table/${table}/${sysId}`, { state: match.value }, this.authConfig())
    );
    return match.label;
  }

  /** story_points by default (rm_story), or the field named; a record without it is skipped */
  public async setTicketPoints(ticketId: string, points: number, options: TicketPointsOptions = {}): Promise<TicketStepResult> {
    const field = options.field || 'story_points';
    if (!/^[a-z0-9_]+$/.test(field)) {
      throw new SfError(t('ticketPointsRefused', { ticketId, message: field }), TICKET_ERROR.pointsInvalid);
    }
    const { table, sysId, number } = await this.requireRecord(ticketId, 'points');
    const response: any = await this.runOperation({ operation: 'points', ticketId: number }, () =>
      retryReadOn5xx(() => httpGet(`${this.instanceUrl}/api/now/table/${table}/${sysId}`, { ...this.authConfig(), params: { sysparm_fields: field } }))
    );
    const record = response?.data?.result || {};
    if (!(field in record)) {
      return { status: 'skipped', value: null, field, reason: 'field-not-on-issue' };
    }
    // An empty integer field reads "0" or ""
    const current = record[field];
    if (current !== '' && current !== '0' && current !== null && !options.overwrite) {
      return { status: 'skipped', value: current, field, reason: 'already-set' };
    }
    await this.runOperation({ operation: 'points', ticketId: number }, () =>
      httpPatch(`${this.instanceUrl}/api/now/table/${table}/${sysId}`, { [field]: points }, this.authConfig())
    );
    return { status: 'done', value: points, field };
  }

  /**
   * Journal field a comment is written to: the option (the --servicenow-field flag), then
   * SERVICENOW_COMMENT_FIELD, then `serviceNowCommentField`, then `work_notes`.
   */
  private static commentFieldOf(override: string | undefined, config: any): string {
    const field = override || getEnvVar('SERVICENOW_COMMENT_FIELD') || config?.serviceNowCommentField || SERVICENOW_DEFAULT_COMMENT_FIELD;
    // The field name lands in the request body as a key: a column name and nothing else
    if (!/^[a-z0-9_]+$/.test(field)) {
      throw new SfError(t('ticketCommentServiceNowInvalidField', { field: JSON.stringify(field) }));
    }
    return field;
  }

  /**
   * Journal entries are plain text: ServiceNow escapes HTML and renders no markdown in them, so the
   * note spells its links out as `label (url)` instead of hiding them behind a label.
   */
  private async writeNote(table: string, sysId: string, field: string, markdown: string): Promise<void> {
    await httpPatch(`${this.instanceUrl}/api/now/table/${table}/${sysId}`, { [field]: markdownToPlainText(markdown) }, this.authConfig());
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
    const entry = await httpPost(
      `${this.instanceUrl}/api/now/table/label_entry`,
      { label: labelSysId, table, table_key: sysId, title: tag },
      this.authConfig()
    );
    // Without a write ACL on label_entry, ServiceNow saves the entry with these fields blank and
    // answers 201: the record is not tagged, and saying "done" would be false
    const saved = entry?.data?.result || {};
    const valueOf = (field: any) => (typeof field === 'object' && field !== null ? field.value : field);
    if (!valueOf(saved.label) || !valueOf(saved.table_key)) {
      throw new SfError(t('serviceNowTagNotAttached', { tag }));
    }
  }

  // ---------------------------------------------------------------------------------------------
  // ServiceNow formats: encoded queries, choice lists, tags, error bodies and mentions. They stay here
  // ---------------------------------------------------------------------------------------------

  private static readonly SEARCH_PAGE_SIZE = 100;
  private static readonly SEARCH_FIELDS =
    'sys_id,number,short_description,sys_class_name,state,priority,assigned_to,assigned_to.user_name,sys_created_on,sys_updated_on,assignment_group';

  /** A table name and nothing else: it lands in the URL */
  private static tableName(project: string): string {
    const table = String(project || '').trim().toLowerCase();
    if (!/^[a-z0-9_]+$/.test(table)) {
      throw new SfError(t('ticketSearchValueRefused', { provider: ServiceNowProvider.providerLabel, value: project, characters: 'a-z 0-9 _' }), TICKET_ERROR.queryInvalid);
    }
    return table;
  }

  /** ^ separates the conditions of an encoded query, and a comma the values of an IN list */
  private static queryValue(value: string, inList = false): string {
    const text = String(value).trim();
    if (/[\^\r\n]/.test(text) || (inList && text.includes(','))) {
      throw new SfError(t('ticketSearchValueRefused', { provider: ServiceNowProvider.providerLabel, value, characters: inList ? '^ ,' : '^' }), TICKET_ERROR.queryInvalid);
    }
    return text;
  }

  private async toEncodedQuery(table: string, criteria: TicketSearchCriteria, classes: string[]): Promise<string> {
    const conditions: string[] = [];
    const classNames = [...classes, ...(criteria.types || []).map((type) => ServiceNowProvider.tableName(type))];
    if (classNames.length > 0) {
      conditions.push(`sys_class_nameIN${classNames.join(',')}`);
    }
    if (criteria.statuses?.length) {
      // States are numbers behind their labels: the label or the value of the choice list is accepted
      const states = await this.statesOf(table, 'list');
      const values = criteria.statuses.map((status) => {
        const wanted = ServiceNowProvider.queryValue(status, true).toLowerCase();
        return states.find((state) => state.label.toLowerCase() === wanted || state.value.toLowerCase() === wanted)?.value ?? wanted;
      });
      conditions.push(`stateIN${values.join(',')}`);
    }
    if (criteria.assignee === 'me') {
      conditions.push(`assigned_to.user_name=${ServiceNowProvider.queryValue(this.user)}`);
    } else if (criteria.assignee === 'none') {
      conditions.push('assigned_toISEMPTY');
    } else if (criteria.assignee) {
      conditions.push(`assigned_to.user_name=${ServiceNowProvider.queryValue(criteria.assignee)}`);
    }
    if (criteria.labels?.length) {
      const keys = await this.recordsTagged(table, criteria.labels.map((label) => ServiceNowProvider.queryValue(label, true)));
      // No tagged record: a condition no record matches, rather than no condition at all
      conditions.push(`sys_idIN${keys.length > 0 ? keys.join(',') : '-'}`);
    }
    if (criteria.text) {
      const text = ServiceNowProvider.queryValue(criteria.text);
      conditions.push(`short_descriptionLIKE${text}^ORdescriptionLIKE${text}`);
    }
    if (criteria.createdAfter) {
      conditions.push(`sys_created_on>=${criteria.createdAfter} 00:00:00`);
    }
    if (criteria.updatedAfter) {
      conditions.push(`sys_updated_on>=${criteria.updatedAfter} 00:00:00`);
    }
    if (criteria.openOnly) {
      conditions.push('active=true');
    }
    const orderField = criteria.orderBy === 'updated' ? 'sys_updated_on' : 'sys_created_on';
    conditions.push(`${criteria.descending ? 'ORDERBYDESC' : 'ORDERBY'}${orderField}`);
    return conditions.join('^');
  }

  /** sys_ids of the records of the table carrying one of the tags */
  private async recordsTagged(table: string, labels: string[]): Promise<string[]> {
    const tableCondition = table === 'task' ? '' : `^table=${table}`;
    const response: any = await this.runOperation({ operation: 'list' }, () =>
      retryReadOn5xx(() =>
        httpGet(`${this.instanceUrl}/api/now/table/label_entry`, {
          ...this.authConfig(),
          params: { sysparm_query: `label.nameIN${labels.join(',')}${tableCondition}`, sysparm_fields: 'table_key', sysparm_limit: 1000 },
        })
      )
    );
    return [...new Set<string>((response?.data?.result || []).map((entry: any) => String(entry.table_key || '')).filter(Boolean))];
  }

  /** Names of the tags of one record; empty when they cannot be read */
  private async tagsOfRecord(table: string, sysId: string): Promise<string[]> {
    try {
      const response: any = await httpGet(`${this.instanceUrl}/api/now/table/label_entry`, {
        ...this.authConfig(),
        params: { sysparm_query: `table=${table}^table_key=${sysId}`, sysparm_fields: 'label.name', sysparm_limit: 100 },
      });
      return (response?.data?.result || []).map((entry: any) => String(entry['label.name'] || '')).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** The user name behind a sys_user sys_id: the id ticket whoami returns and ticket list --assignee takes */
  private async userNameOf(userSysId: string): Promise<string | null> {
    if (!userSysId) {
      return null;
    }
    try {
      const response: any = await httpGet(`${this.instanceUrl}/api/now/table/sys_user/${userSysId}`, { ...this.authConfig(), params: { sysparm_fields: 'user_name' } });
      return response?.data?.result?.user_name || null;
    } catch {
      return null;
    }
  }

  /** The choices of the state field; a table extending task may only inherit those of task */
  private async statesOf(table: string, operation: TicketOperation): Promise<{ value: string; label: string }[]> {
    for (const name of table === 'task' ? ['task'] : [table, 'task']) {
      const response: any = await this.runOperation({ operation }, () =>
        retryReadOn5xx(() =>
          httpGet(`${this.instanceUrl}/api/now/table/sys_choice`, {
            ...this.authConfig(),
            params: { sysparm_query: `name=${name}^element=state^inactive=false^language=en^ORDERBYsequence`, sysparm_fields: 'value,label' },
          })
        )
      );
      const states = (response?.data?.result || []).map((choice: any) => ({ value: String(choice.value), label: String(choice.label) }));
      if (states.length > 0) {
        return states;
      }
    }
    return [];
  }

  /** Table, sys_id and number of a record, or a named error */
  private async requireRecord(ticketId: string, operation: TicketOperation): Promise<{ table: string; sysId: string; number: string }> {
    const number = this.normalizeTicketId(ticketId);
    const table = ServiceNowProvider.tableOfTicketId(number, await getConfig('project'));
    if (!table) {
      throw new SfError(t('ticketDetailsUnknownIdShape', { ticketId: number }), TICKET_ERROR.notFound);
    }
    const record = await this.runOperation({ operation, ticketId: number }, () => retryReadOn5xx(() => this.fetchRecord(table, number)));
    if (!record) {
      throw new SfError(t('ticketNotFound', { ticketId: number }), TICKET_ERROR.notFound);
    }
    return { table, sysId: ServiceNowProvider.rawFieldValue(record, 'sys_id'), number };
  }

  private toTicketSummary(record: any): TicketSummary {
    const table = ServiceNowProvider.rawFieldValue(record, 'sys_class_name');
    // Raw dates are UTC, written "YYYY-MM-DD HH:mm:ss"
    const isoOf = (field: string) => {
      const raw = ServiceNowProvider.rawFieldValue(record, field);
      return raw ? `${raw.replace(' ', 'T')}Z` : '';
    };
    return {
      id: ServiceNowProvider.rawFieldValue(record, 'number'),
      url: ServiceNowProvider.recordUrlBySysId(this.instanceUrl, table, ServiceNowProvider.rawFieldValue(record, 'sys_id')),
      subject: ServiceNowProvider.fieldValue(record, 'short_description'),
      type: table,
      status: ServiceNowProvider.fieldValue(record, 'state'),
      priority: ServiceNowProvider.fieldValue(record, 'priority'),
      assignee: ServiceNowProvider.fieldValue(record, 'assigned_to') || null,
      created: isoOf('sys_created_on'),
      updated: isoOf('sys_updated_on'),
      labels: [],
      assigneeId: ServiceNowProvider.rawFieldValue(record, 'assigned_to.user_name') || null,
      project: table,
      areaPath: ServiceNowProvider.fieldValue(record, 'assignment_group') || null,
    };
  }

  /** Named errors on every failure of the ticket operations, with the reason ServiceNow gave */
  private async runOperation<T>(context: Omit<TicketErrorContext, 'providerLabel'>, call: () => Promise<T>): Promise<T> {
    if (!this.isActive) {
      throw new SfError(t('ticketProviderNoCredential', { provider: ServiceNowProvider.providerLabel }), TICKET_ERROR.providerNotConfigured);
    }
    try {
      return await call();
    } catch (e: any) {
      const error = e?.response?.data?.error;
      const serverMessage = [error?.message, error?.detail].filter((part) => typeof part === 'string' && part).join(': ') || undefined;
      throw toTicketError(e, { providerLabel: ServiceNowProvider.providerLabel, serverMessage, ...context });
    }
  }

  /** Journal notes are plain text: the assignee is named after the first block, as text */
  private static withMention(markdown: string, assignee: TicketAssignee | null | undefined): string {
    if (!assignee?.displayName) {
      return markdown;
    }
    const blocks = markdown.split('\n\n');
    blocks.splice(1, 0, `${mentionLead()}${assignee.displayName}`);
    return blocks.join('\n\n');
  }
}
