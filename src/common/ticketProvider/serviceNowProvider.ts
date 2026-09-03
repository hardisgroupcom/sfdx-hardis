import c from 'chalk';
// Type-only: a value import here would close a runtime cycle index -> provider -> index
import type { Ticket } from './index.js';
import { TicketProviderRoot } from './ticketProviderRoot.js';
import { uxLog } from '../utils/index.js';
import { getEnvVar } from '../../config/index.js';
import { httpGet } from '../utils/httpUtils.js';
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

const SERVICENOW_NUMBER_REGEX = /\b(INC|PRB|CHG|RITM|REQ|SCTASK|TASK|DMND|STRY|STORY|ENHC|KB)([0-9]{4,})\b/gi;

/**
 * ServiceNow ticketing connector.
 *
 * Reuses the environment variables already documented for `sf hardis misc:servicenow-report`
 * (SERVICENOW_URL / SERVICENOW_USERNAME / SERVICENOW_PASSWORD), so a project that already reports
 * on ServiceNow needs no extra configuration to read a ticket.
 */
export class ServiceNowProvider extends TicketProviderRoot {
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

  /** True when the identifier looks like a ServiceNow record number (prefix + digits) */
  public static matchesTicketId(ticketId: string): boolean {
    return new RegExp(SERVICENOW_NUMBER_REGEX.source, 'i').test((ticketId || '').trim());
  }

  public static tableOfTicketId(ticketId: string): string | null {
    const match = (ticketId || '').trim().toUpperCase().match(/^([A-Z]+)([0-9]{4,})$/);
    if (!match) {
      return null;
    }
    return SERVICENOW_TABLE_BY_PREFIX[match[1]] || null;
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

  public async collectTicketsInfo(tickets: Ticket[]): Promise<Ticket[]> {
    for (const ticket of tickets) {
      const table = ServiceNowProvider.tableOfTicketId(ticket.id);
      if (!table) {
        continue;
      }
      try {
        const record = await this.fetchRecord(table, ticket.id);
        if (record) {
          ticket.foundOnServer = true;
          ticket.subject = ServiceNowProvider.fieldValue(record, 'short_description');
          ticket.status = ServiceNowProvider.fieldValue(record, 'state');
          ticket.statusLabel = ticket.status;
        }
      } catch (e: any) {
        uxLog('log', this, c.grey('[ServiceNowProvider] ' + t('serviceNowRecordError', { ticketId: ticket.id, message: e.message })));
      }
    }
    return tickets;
  }

  public async getTicketDetails(ticketId: string, options: TicketDetailsOptions = {}): Promise<TicketDetails | null> {
    const number = (ticketId || '').trim().toUpperCase();
    const table = ServiceNowProvider.tableOfTicketId(number);
    if (!table) {
      uxLog('warning', this, c.yellow('[ServiceNowProvider] ' + t('serviceNowUnknownPrefix', { ticketId: number })));
      return null;
    }
    const record = await this.fetchRecord(table, number);
    if (!record) {
      return null;
    }
    const sysId = ServiceNowProvider.fieldValue(record, 'sys_id');
    const details = newTicketDetails('SERVICENOW', number);
    details.url = `${this.instanceUrl}/nav_to.do?uri=/${table}.do?sys_id=${sysId}`;
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
}
