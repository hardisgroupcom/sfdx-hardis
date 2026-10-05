import c from 'chalk';
import sortArray from '../utils/sortArray.js';
// Type-only: a value import here would close a runtime cycle index -> provider -> index
import type { Ticket, TicketsFromStringOptions } from './index.js';
import { recordTicketCollectionIssue, TicketProviderRoot } from './ticketProviderRoot.js';
import { extractRegexMatches, getCurrentGitBranch, uxLog } from '../utils/index.js';
import { PROVIDER_BATCH_PROFILES, mapInAdaptiveBatchesSettled } from '../utils/adaptiveBatch.js';
import { CONSTANTS, getConfig, getEnvVar } from '../../config/index.js';
import { httpGet, httpPost, httpPut } from '../utils/httpUtils.js';
import { CommonPullRequestInfo, GitProvider } from '../gitProvider/index.js';
import { WebSocketClient } from '../websocketClient.js';
import { t } from '../utils/i18n.js';
import {
  TicketAttachment,
  TicketDetails,
  TicketDetailsOptions,
  capText,
  classifyAttachment,
  detectManualActions,
  htmlToPlainText,
  isSameHost,
  newTicketDetails,
} from './ticketDetails.js';

// A feature reference is a workspace prefix and a number (PROD-12). The prefix starts with a letter,
// which keeps a date (2026-09) out, and nothing may follow with a dash: PROD-12-3 is a requirement,
// PROD-E-4 an epic and PROD-R-2 a release, none of them a feature.
const AHA_DEFAULT_TICKET_REGEX = '(?<=[^a-zA-Z0-9_-]|^)([A-Za-z][A-Za-z0-9]{1,9}-\\d{1,6})(?=[^a-zA-Z0-9_-]|$)';
// Link to a feature, on the account host or a regional one (acme.aha.io, acme.euw4.aha.io)
const AHA_FEATURE_URL_REGEX = /https:\/\/([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.aha\.io)\/features\/([A-Za-z][A-Za-z0-9]*-\d+)(?![\w-])/g;
// Fields read for every feature of a Pull Request: the full payload carries scores, releases and
// initiatives that the Pull Request comment has no use for
const AHA_COLLECT_FIELDS = 'name,reference_num,workflow_status,assigned_to_user,created_by_user,description,url';
const AHA_COMMENTS_PAGE_SIZE = 200;
const AHA_COMMENTS_MAX = 2000;
const AHA_REQUEST_TIMEOUT_MS = 60000;

/**
 * Aha! ticketing connector: features of Aha! Roadmaps and Aha! Develop.
 *
 * A feature reference (PROD-12) has the shape of a JIRA key, so this connector only reads the
 * references of a project whose .sfdx-hardis.yml says `ticketingProvider: AHA`.
 */
export class AhaProvider extends TicketProviderRoot {
  public static readonly providerKey = 'aha' as const;
  public static readonly providerLabel = 'Aha!';
  public static readonly supportsTicketDetails = true;
  public static readonly onlyWhenDeclared = true;

  protected host: string;
  protected apiKey: string;

  constructor(config: any = {}) {
    super();
    this.host = AhaProvider.getHost(config);
    this.apiKey = getEnvVar('AHA_API_KEY') || '';
    if (AhaProvider.isAvailable(config)) {
      this.isActive = true;
    }
  }

  public static isAvailable(config: any = {}): boolean {
    return Boolean(AhaProvider.getHost(config)) && Boolean(getEnvVar('AHA_API_KEY'));
  }

  public getLabel(): string {
    return 'sfdx-hardis Aha! connector';
  }

  /** True when the identifier has the shape of a feature reference */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public static matchesTicketId(ticketId: string, _config: any = {}): boolean {
    return /^[A-Za-z][A-Za-z0-9]{1,9}-[0-9]{1,6}$/.test((ticketId || '').trim());
  }

  /**
   * Collects the Aha! features of a commit message, a branch name or a Pull Request body.
   *
   * Links to a feature are always collected. Bare references need the host to be turned into a
   * link, so nothing is made of them in a project that does not name its Aha! account.
   */
  public static async getTicketsFromString(text: string, options: TicketsFromStringOptions = {}): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    const config = options.config || (await getConfig('project'));
    // Features given as a link: the link is kept as it was written
    for (const match of text.matchAll(AHA_FEATURE_URL_REGEX)) {
      const ticketId = match[2].toUpperCase();
      if (!tickets.some((ticket) => ticket.id === ticketId)) {
        tickets.push({ provider: 'AHA', id: ticketId, url: match[0] });
      }
    }
    // Features given as a bare reference: the link needs the host
    const host = AhaProvider.getHost(config);
    if (host) {
      const customRegex = getEnvVar('AHA_TICKET_REGEX') || config?.ahaTicketRegex;
      let referenceRegex: RegExp;
      try {
        referenceRegex = new RegExp(customRegex || AHA_DEFAULT_TICKET_REGEX, 'gm');
      } catch (e: any) {
        // A malformed project regex must cost its own tickets, not the whole Pull Request comment
        uxLog('warning', this, c.yellow('[AhaProvider] ' + t('ahaProviderInvalidTicketRegex', { regex: String(customRegex), message: e.message })));
        return sortArray(tickets, { by: ['id'], order: ['asc'] }) as Ticket[];
      }
      for (const reference of await extractRegexMatches(referenceRegex, text)) {
        const ticketId = reference.trim().toUpperCase();
        if (ticketId && !tickets.some((ticket) => ticket.id === ticketId)) {
          tickets.push({ provider: 'AHA', id: ticketId, url: AhaProvider.featureUrl(host, ticketId) });
        }
      }
    }
    return sortArray(tickets, { by: ['id'], order: ['asc'] }) as Ticket[];
  }

  /**
   * Fills the name, the status and the owner of every Aha! feature of the list.
   *
   * Deliberately shallow: this runs on every ticket of a Pull Request, where getTicketDetails()
   * fetches one feature in full.
   */
  public async collectTicketsInfo(tickets: Ticket[]): Promise<Ticket[]> {
    const ahaTickets = tickets.filter((ticket) => ticket.provider === 'AHA');
    if (ahaTickets.length === 0) {
      return tickets;
    }
    uxLog('action', this, c.cyan('[AhaProvider] ' + t('ahaProviderCollectingTickets', { count: ahaTickets.length, host: this.host })));
    // One HTTP call per feature: show a progress bar instead of flooding the log with one line each
    const showProgress = ahaTickets.length > 1;
    if (showProgress) {
      WebSocketClient.sendProgressStartMessage(t('collectingTicketsInfo', { count: ahaTickets.length }), ahaTickets.length);
    }
    let failedTicketsNumber = 0;
    let notFoundTicketsNumber = 0;
    let firstErrorMessage = '';
    let authRefused = false;
    // try/finally so the progress bar never stays stuck in the VS Code UI when a fetch throws
    try {
      // One HTTP call per feature, in the adaptive batches of the Aha! ladder, shrunk only when Aha!
      // throttles. A single aggregated warning is displayed after the loop: per-feature failures
      // usually share the same cause (revoked key, workspace the user cannot read).
      const features = await mapInAdaptiveBatchesSettled(ahaTickets, (ticket) => this.fetchFeature(ticket.id, AHA_COLLECT_FIELDS), {
        sizes: PROVIDER_BATCH_PROFILES.aha,
        onBackoff: (size, e, waitMs) => uxLog('log', this, c.grey('[AhaProvider] ' + t('providerThrottledBackoff', { count: size, waitSeconds: Math.round(waitMs / 1000), message: (e as Error)?.message || '' }))),
        onError: (e: any, ticket) => {
          const status = e?.response?.status;
          if (status === 404) {
            notFoundTicketsNumber++;
            uxLog('log', this, c.grey('[AhaProvider] ' + t('ahaProviderTicketNotFound', { ticketId: ticket.id })));
            return;
          }
          failedTicketsNumber++;
          firstErrorMessage = firstErrorMessage || e.message;
          authRefused = authRefused || status === 401;
          uxLog('log', this, c.grey('[AhaProvider] ' + t('ahaProviderErrorGettingTicket', { ticketId: ticket.id, message: e.message })));
        },
        onProgress: (done, total) => {
          if (showProgress) {
            WebSocketClient.sendProgressStepMessage(done, total);
          }
        },
      });
      for (const [index, ticket] of ahaTickets.entries()) {
        const feature: any = features[index] ?? null;
        if (!feature) {
          continue;
        }
        ticket.foundOnServer = true;
        ticket.subject = feature.name || '';
        ticket.body = htmlToPlainText(feature.description?.body);
        ticket.status = feature.workflow_status?.id || '';
        ticket.statusLabel = feature.workflow_status?.name || '';
        const assignee = feature.assigned_to_user;
        const reporter = feature.created_by_user;
        if (assignee) {
          ticket.assignee = assignee.id || '';
          ticket.assigneeLabel = assignee.name || '';
        }
        if (reporter) {
          ticket.reporter = reporter.id || '';
          ticket.reporterLabel = reporter.name || '';
        }
        const preferredOwner = assignee || reporter;
        if (preferredOwner) {
          ticket.author = preferredOwner.id || '';
          ticket.authorLabel = preferredOwner.name || '';
        }
        // The link Aha! answers with is the canonical one, whatever host the API was called on
        if (feature.url) {
          ticket.url = feature.url;
        }
        // "other" keeps this per-ticket line out of the VS Code UI, where the progress bar shows instead
        uxLog('other', this, c.grey('[AhaProvider] ' + t('ahaProviderCollectedTicket', { ticketId: ticket.id })));
      }
    } finally {
      if (showProgress) {
        WebSocketClient.sendProgressEndMessage(ahaTickets.length);
      }
    }
    // A reference Aha! does not know is usually not a feature (UTF-8, ISO-27001): it stays a bare
    // link and nothing is reported. When no reference at all is found, the cause is elsewhere: Aha!
    // answers the same 404 for a workspace the user of the API key cannot see.
    if (failedTicketsNumber === 0 && notFoundTicketsNumber === ahaTickets.length) {
      failedTicketsNumber = notFoundTicketsNumber;
      firstErrorMessage = 'Record not found';
    }
    if (authRefused) {
      uxLog('warning', this, c.yellow('[AhaProvider] ' + t('ahaProviderAuthRefused', { host: this.host })));
      recordTicketCollectionIssue(`Aha! refused the API key: details could not be retrieved for ${ahaTickets.length} Aha! feature(s). Check AHA_API_KEY in the CI job.`);
    } else if (failedTicketsNumber > 0) {
      uxLog('warning', this, c.yellow('[AhaProvider] ' + t('ahaProviderTicketsCollectionFailed', {
        failed: failedTicketsNumber,
        total: ahaTickets.length,
        message: firstErrorMessage,
      })));
      recordTicketCollectionIssue(
        `Details could not be retrieved for ${failedTicketsNumber} of ${ahaTickets.length} Aha! feature(s) (first error: ${firstErrorMessage}). Check AHA_HOST, AHA_API_KEY and the workspaces the user can read.`
      );
    }
    return tickets;
  }

  public async getTicketDetails(ticketId: string, options: TicketDetailsOptions = {}): Promise<TicketDetails | null> {
    // Aha! answers "Record not found" to a lowercase reference
    const reference = (ticketId || '').trim().toUpperCase();
    const feature = await this.fetchFeature(reference);
    if (!feature) {
      return null;
    }
    const details = newTicketDetails('AHA', feature.reference_num || reference);
    details.url = feature.url || AhaProvider.featureUrl(this.host, details.id);
    details.subject = feature.name || '';
    details.type = feature.workflow_kind?.name || '';
    details.status = feature.workflow_status?.name || '';
    details.assignee = feature.assigned_to_user?.name || '';
    details.reporter = feature.created_by_user?.name || '';
    details.created = feature.created_at || '';
    details.updated = feature.updated_at || '';
    details.labels = feature.tags || [];
    details.fixVersions = feature.release?.name ? [feature.release.name] : [];
    details.epic = feature.epic_reference_num || '';
    details.parent = feature.epic_reference_num || '';
    details.storyPoints = AhaProvider.estimateOf(feature);
    details.description = capText(htmlToPlainText(feature.description?.body));
    for (const fieldName of ['score', 'progress', 'start_date', 'due_date', 'initiative_reference_num', 'release_reference_num']) {
      const value = feature[fieldName];
      if (value !== undefined && value !== null && value !== '') {
        details.extra[fieldName] = value;
      }
    }
    for (const customField of feature.custom_fields || []) {
      if (customField?.key && customField.value !== undefined && customField.value !== null && typeof customField.value !== 'object') {
        details.extra[customField.key] = customField.value;
      }
    }

    const { comments, truncated } = await this.fetchAllComments(details.id);
    details.commentsTruncated = truncated;
    details.comments = comments.map((comment: any) => ({
      author: comment?.user?.name || '',
      date: comment?.created_at || '',
      body: capText(htmlToPlainText(comment?.body)),
    }));

    details.subtasks = (feature.requirements || []).map((requirement: any) => ({
      relation: 'requirement',
      id: requirement?.reference_num || '',
      title: requirement?.name || '',
      status: requirement?.workflow_status?.name || '',
      url: requirement?.url || '',
    }));

    for (const link of feature.feature_links || []) {
      // A link has two ends, and the feature being read is one of them
      const parentRecord = link?.parent_record;
      const childRecord = link?.child_record;
      const target = parentRecord?.reference_num === details.id ? childRecord : parentRecord;
      if (!target?.reference_num) {
        continue;
      }
      details.links.push({
        relation: link?.link_type || 'linked',
        id: target.reference_num,
        title: target.name || '',
        status: target.workflow_status?.name || '',
        url: target.url || '',
      });
    }
    for (const [relation, record] of [['epic', feature.epic], ['initiative', feature.initiative], ['release', feature.release]] as [string, any][]) {
      if (record?.reference_num) {
        details.links.push({
          relation,
          id: record.reference_num,
          title: record.name || '',
          status: record.workflow_status?.name || '',
          url: record.url || '',
        });
      }
    }

    // Files can be attached to the feature, to its description and to each comment
    details.attachments = [
      ...(feature.attachments || []),
      ...(feature.description?.attachments || []),
      ...comments.flatMap((comment: any) => comment?.attachments || []),
    ].map((attachment: any) => AhaProvider.toTicketAttachment(attachment));
    await this.downloadDetailsAttachments(details, this.attachmentsBaseUrl(feature, details.attachments), this.authHeaders(), options);

    details.manualActions = detectManualActions([
      details.description,
      ...details.comments.map((comment) => comment.body),
      ...details.attachments.map((attachment) => attachment.textContent),
    ]);
    return details;
  }

  /** Posts a comment on every deployed feature, and adds the deployment tag to it */
  public async postDeploymentComments(tickets: Ticket[], org: string, pullRequestInfo: CommonPullRequestInfo | null): Promise<Ticket[]> {
    // The list holds the tickets of every connector, and a feature that was not found is not written to
    const ahaTickets = tickets.filter((ticket) => ticket.provider === 'AHA' && ticket.foundOnServer);
    if (ahaTickets.length === 0) {
      return tickets;
    }
    uxLog('action', this, c.cyan('[AhaProvider] ' + t('ahaProviderPostingComments', { count: ahaTickets.length })));
    const tag = await this.getDeploymentTag();
    const comment = await this.buildDeploymentComment(org, pullRequestInfo);
    const commentedTickets: Ticket[] = [];
    const taggedTickets: Ticket[] = [];
    for (const ticket of ahaTickets) {
      try {
        await httpPost(`${this.featureApiUrl(ticket.id)}/comments`, { comment: { body: comment } }, this.requestConfig());
        commentedTickets.push(ticket);
      } catch (e: any) {
        uxLog('warning', this, c.yellow('[AhaProvider] ' + t('ahaProviderErrorPostingComment', { ticketId: ticket.id, message: e.message })));
      }
      try {
        await this.addTagOnFeature(ticket.id, tag);
        taggedTickets.push(ticket);
      } catch (e: any) {
        uxLog('warning', this, c.yellow('[AhaProvider] ' + t('ahaProviderErrorAddingTag', { tag, ticketId: ticket.id, message: e.message })));
      }
    }
    if (commentedTickets.length > 0) {
      uxLog('log', this, c.grey('[AhaProvider] ' + t('ahaProviderPostedComments', {
        count: commentedTickets.length,
        tickets: commentedTickets.map((ticket) => ticket.id).join(', '),
      })));
    }
    if (taggedTickets.length > 0) {
      uxLog('log', this, c.grey('[AhaProvider] ' + t('ahaProviderAddedTag', {
        tag,
        count: taggedTickets.length,
        tickets: taggedTickets.map((ticket) => ticket.id).join(', '),
      })));
    }
    return tickets;
  }

  /** AHA_HOST may be given as a bare account host or as a full URL, with or without a path */
  private static getHost(config: any = {}): string {
    const raw = String(getEnvVar('AHA_HOST') || config?.ahaHost || '').trim();
    if (!raw) {
      return '';
    }
    const withScheme = raw.startsWith('http') ? raw : `https://${raw}`;
    try {
      return new URL(withScheme).origin;
    } catch {
      return '';
    }
  }

  private static featureUrl(host: string, reference: string): string {
    return `${host}/features/${reference}`;
  }

  /** Aha! estimates are a number and a unit (points or time): keep both when there is a unit */
  private static estimateOf(feature: any): string {
    const estimate = feature?.original_estimate ?? feature?.feature_only_original_estimate;
    if (estimate === undefined || estimate === null || estimate === '') {
      return '';
    }
    if (typeof estimate === 'object') {
      return [estimate.value, estimate.units].filter((part) => part !== undefined && part !== null && part !== '').join(' ');
    }
    return String(estimate);
  }

  private static toTicketAttachment(attachment: any): TicketAttachment {
    const filename = attachment?.file_name || 'attachment';
    const contentType = attachment?.content_type || '';
    return {
      filename,
      contentType,
      size: Number(attachment?.file_size || attachment?.original_file_size || 0),
      created: attachment?.created_at || '',
      author: '',
      url: attachment?.download_url || '',
      kind: classifyAttachment(contentType, filename),
      localPath: null,
      textContent: null,
      truncated: false,
      error: null,
    };
  }

  private static escapeHtml(value: string): string {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private static htmlLink(label: string, url: string): string {
    const safeLabel = AhaProvider.escapeHtml(label);
    return /^https?:\/\//i.test(url || '') ? `<a href="${AhaProvider.escapeHtml(url)}">${safeLabel}</a>` : safeLabel;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private requestConfig(params?: Record<string, any>) {
    return { headers: { ...this.authHeaders(), Accept: 'application/json' }, timeout: AHA_REQUEST_TIMEOUT_MS, params };
  }

  private featureApiUrl(reference: string): string {
    return `${this.host}/api/v1/features/${encodeURIComponent(reference)}`;
  }

  /** Reads one feature. `fields` narrows the answer; without it Aha! returns the whole record */
  private async fetchFeature(reference: string, fields?: string): Promise<any | null> {
    const response = await httpGet(this.featureApiUrl(reference), this.requestConfig(fields ? { fields } : undefined));
    return response?.data?.feature || null;
  }

  private async fetchAllComments(reference: string): Promise<{ comments: any[]; truncated: boolean }> {
    const all: any[] = [];
    try {
      for (let page = 1; ; page++) {
        const response = await httpGet(`${this.featureApiUrl(reference)}/comments`, this.requestConfig({ page, per_page: AHA_COMMENTS_PAGE_SIZE }));
        const comments = response?.data?.comments || [];
        all.push(...comments);
        if (all.length >= AHA_COMMENTS_MAX) {
          return { comments: all.slice(0, AHA_COMMENTS_MAX), truncated: true };
        }
        const totalPages = response?.data?.pagination?.total_pages ?? page;
        if (comments.length === 0 || page >= totalPages) {
          break;
        }
      }
    } catch (e: any) {
      // The feature itself was read: return it with the comments collected so far
      uxLog('warning', this, c.yellow('[AhaProvider] ' + t('ahaProviderCommentsError', { ticketId: reference, message: e.message })));
    }
    // Aha! lists the newest comment first, a reader expects the conversation in the order it happened
    all.sort((a, b) => String(a?.created_at || '').localeCompare(String(b?.created_at || '')));
    return { comments: all, truncated: false };
  }

  /**
   * Host the attachments are downloaded from, which must be the one the API key is sent to.
   *
   * Aha! serves the links of an account on its main host (acme.aha.io) even when the API was called
   * on a regional one (acme.euw4.aha.io). That host is accepted only when it is an aha.io host of
   * the same account, so the key never leaves for a host the project did not configure.
   */
  private attachmentsBaseUrl(feature: any, attachments: TicketAttachment[]): string {
    const firstUrl = attachments.find((attachment) => attachment.url)?.url || '';
    if (!firstUrl || isSameHost(firstUrl, this.host)) {
      return this.host;
    }
    try {
      const webHost = new URL(feature?.url || '').host.toLowerCase();
      const configuredHost = new URL(this.host).host.toLowerCase();
      const sameAccount = webHost.split('.')[0] === configuredHost.split('.')[0];
      if (sameAccount && webHost.endsWith('.aha.io') && configuredHost.endsWith('.aha.io') && isSameHost(firstUrl, `https://${webHost}`)) {
        return `https://${webHost}`;
      }
    } catch {
      // Not a URL: keep the configured host, and the download is refused
    }
    return this.host;
  }

  /** Aha! renders a comment as HTML, so the links hide behind their label like they do in JIRA */
  private async buildDeploymentComment(org: string, pullRequestInfo: CommonPullRequestInfo | null): Promise<string> {
    const orgLabel = org.replace('https://', '').replace('.my.salesforce.com', '');
    const branchName = (await getCurrentGitBranch()) || '';
    const branchUrl = (await GitProvider.getCurrentBranchUrl()) || '';
    let html = `<p>Deployed by ${AhaProvider.htmlLink('sfdx-hardis', `${CONSTANTS.DOC_URL_ROOT}/`)} in <b>${AhaProvider.htmlLink(orgLabel, org)}</b>`;
    if (branchName) {
      html += ` from branch <b>${AhaProvider.htmlLink(branchName, branchUrl)}</b>`;
    }
    html += '</p>';
    if (pullRequestInfo?.webUrl) {
      const author = pullRequestInfo.authorName ? `, by ${AhaProvider.escapeHtml(pullRequestInfo.authorName)}` : '';
      html += `<p>Related PR: ${AhaProvider.htmlLink(pullRequestInfo.title || pullRequestInfo.webUrl, pullRequestInfo.webUrl)}${author}</p>`;
    }
    return html;
  }

  /**
   * Adds a tag to a feature without losing the ones it has.
   *
   * Aha! replaces the whole list on update, so the current tags are read first. A feature that
   * already carries the tag is left alone: deploying the same branch again writes nothing.
   */
  private async addTagOnFeature(reference: string, tag: string): Promise<void> {
    const feature = await this.fetchFeature(reference, 'tags');
    const currentTags: string[] = feature?.tags || [];
    if (currentTags.includes(tag)) {
      return;
    }
    await httpPut(this.featureApiUrl(reference), { feature: { tags: [...currentTags, tag] } }, this.requestConfig({ fields: 'tags' }));
  }
}
