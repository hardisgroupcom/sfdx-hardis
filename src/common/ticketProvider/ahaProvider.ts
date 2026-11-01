import c from 'chalk';
import sortArray from '../utils/sortArray.js';
// Type-only: a value import here would close a runtime cycle index -> provider -> index
import type { Ticket, TicketsFromStringOptions } from './index.js';
import { recordTicketCollectionIssue, TicketProviderRoot } from './ticketProviderRoot.js';
import { extractRegexMatches, uxLog } from '../utils/index.js';
import { PROVIDER_BATCH_PROFILES, mapInAdaptiveBatchesSettled } from '../utils/adaptiveBatch.js';
import { getConfig, getEnvVar } from '../../config/index.js';
import { httpGet, httpPost, httpPut } from '../utils/httpUtils.js';
import { CommonPullRequestInfo } from '../gitProvider/index.js';
import { convertMarkdownToHtml } from '../notifProvider/utils/markdownToHtml.js';
import { PostCommentOptions, PostCommentResult, buildDeploymentCommentMarkdown, hasMarker, htmlMarker } from './utils/ticketComment.js';
import { WebSocketClient } from '../websocketClient.js';
import { t } from '../utils/i18n.js';
import { SfError } from '@salesforce/core';
import {
  TICKET_ERROR,
  TicketErrorContext,
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
  TicketAttachment,
  TicketDetails,
  TicketDetailsOptions,
  capText,
  classifyAttachment,
  detectManualActions,
  htmlToPlainText,
  isSameHost,
  newTicketDetails,
} from './utils/ticketDetails.js';

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
// Fields of each feature read by ticket list
const AHA_SEARCH_FIELDS = 'reference_num,name,url,workflow_kind,workflow_status,assigned_to_user,tags,created_at,updated_at,release';
const AHA_SEARCH_PAGE_SIZE = 100;

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
  public static readonly supportsComments = true;
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
   * Nothing is collected in a project that does not name its Aha! account. A link to a feature of
   * another account is left alone: its reference would be read, then commented on, in the account
   * of the project, where it is another feature or none.
   */
  public static async getTicketsFromString(text: string, options: TicketsFromStringOptions = {}): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    const config = options.config || (await getConfig('project'));
    const host = AhaProvider.getHost(config);
    if (!host) {
      return tickets;
    }
    // Features given as a link: the link is kept as it was written
    for (const match of text.matchAll(AHA_FEATURE_URL_REGEX)) {
      const ticketId = match[2].toUpperCase();
      if (AhaProvider.isSameAccount(match[1], host) && !tickets.some((ticket) => ticket.id === ticketId)) {
        tickets.push({ provider: 'AHA', id: ticketId, url: match[0] });
      }
    }
    // Features given as a bare reference
    const customRegex = getEnvVar('AHA_TICKET_REGEX') || config?.ahaTicketRegex;
    let referenceRegex: RegExp;
    try {
      referenceRegex = new RegExp(customRegex || AHA_DEFAULT_TICKET_REGEX, 'gm');
    } catch (e: any) {
      // A malformed project regex must cost its own tickets, not the whole Pull Request comment
      uxLog('warning', this, c.yellow('[AhaProvider] ' + t('ahaProviderInvalidTicketRegex', { regex: String(customRegex), message: e.message })));
      return sortArray(tickets, { by: ['id'], order: ['asc'] }) as Ticket[];
    }
    // The reference inside a link to another account must not come back as a bare reference
    const ownText = text.replace(AHA_FEATURE_URL_REGEX, (link, linkHost) => (AhaProvider.isSameAccount(linkHost, host) ? link : ' '));
    for (const reference of await extractRegexMatches(referenceRegex, ownText)) {
      const ticketId = reference.trim().toUpperCase();
      if (ticketId && !tickets.some((ticket) => ticket.id === ticketId)) {
        tickets.push({ provider: 'AHA', id: ticketId, url: AhaProvider.featureUrl(host, ticketId) });
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
    let firstErrorMessage = '';
    let authRefused = false;
    // try/finally so the progress bar never stays stuck in the VS Code UI when a fetch throws
    try {
      // One HTTP call per feature, in the adaptive batches of the Aha! ladder, shrunk only when Aha!
      // throttles. A single aggregated warning is displayed after the loop: per-feature failures
      // usually share the same cause (revoked key, workspace the user cannot read).
      const features = await mapInAdaptiveBatchesSettled(ahaTickets, (ticket) => this.fetchFeature(ticket.id, AHA_COLLECT_FIELDS), {
        sizes: PROVIDER_BATCH_PROFILES.aha,
        onBackoff: this.logBackoff,
        onError: (e: any, ticket) => {
          const status = e?.response?.status;
          if (status === 404) {
            // Usually a reference that is not a feature (UTF-8, ISO-27001): it stays a bare link, and
            // the Pull Request comment says nothing of it
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
    details.assigneeId = feature.assigned_to_user?.id ? String(feature.assigned_to_user.id) : null;
    details.reporter = feature.created_by_user?.name || '';
    details.reporterId = feature.created_by_user?.id ? String(feature.created_by_user.id) : null;
    details.project = AhaProvider.projectOfReference(details.id);
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

    const { comments, truncated } = options.skipComments ? { comments: [], truncated: false } : await this.fetchAllComments(details.id);
    details.commentsTruncated = truncated;
    details.comments = comments.map((comment: any) => ({
      author: comment?.user?.name || '',
      authorId: comment?.user?.id ? String(comment.user.id) : null,
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
    const commentMarkdown = await buildDeploymentCommentMarkdown(org, pullRequestInfo);
    // Comments, then tags, each in the adaptive batches of the Aha! ladder: a deployment of many
    // features must slow down when Aha! throttles, not lose the writes that come after
    const commented = await mapInAdaptiveBatchesSettled(
      ahaTickets,
      async (ticket) => {
        await this.postComment(ticket.id, commentMarkdown);
        return true;
      },
      {
        sizes: PROVIDER_BATCH_PROFILES.aha,
        onBackoff: this.logBackoff,
        onError: (e: any, ticket) => uxLog('warning', this, c.yellow('[AhaProvider] ' + t('ahaProviderErrorPostingComment', { ticketId: ticket.id, message: e.message }))),
      }
    );
    const tagged = await mapInAdaptiveBatchesSettled(
      ahaTickets,
      async (ticket) => {
        await this.addTagOnFeature(ticket.id, tag);
        return true;
      },
      {
        sizes: PROVIDER_BATCH_PROFILES.aha,
        onBackoff: this.logBackoff,
        onError: (e: any, ticket) => uxLog('warning', this, c.yellow('[AhaProvider] ' + t('ahaProviderErrorAddingTag', { tag, ticketId: ticket.id, message: e.message }))),
      }
    );
    const commentedTickets = ahaTickets.filter((_ticket, index) => commented[index]);
    const taggedTickets = ahaTickets.filter((_ticket, index) => tagged[index]);
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

  /**
   * Posts a markdown comment on a feature, written as HTML. With a marker, hidden in an HTML
   * comment, the most recent comment holding it is updated instead.
   */
  public async postComment(ticketId: string, markdown: string, options: PostCommentOptions = {}): Promise<PostCommentResult> {
    const reference = (ticketId || '').trim();
    // Aha! comments cannot be restricted: refused by the base check, before any write
    this.validateQualifyOptions({ visibility: options.visibility });
    const html = AhaProvider.withHtmlMention(await convertMarkdownToHtml(markdown), options.mention);
    const body = { comment: { body: html + htmlMarker(options.marker) } };
    const existing = options.marker ? await this.findMarkedComment(reference, options.marker) : null;
    const response = existing
      ? await httpPut(`${this.host}/api/v1/comments/${encodeURIComponent(String(existing.id))}`, body, this.requestConfig())
      : await httpPost(`${this.featureApiUrl(reference)}/comments`, body, this.requestConfig());
    const comment = response?.data?.comment;
    return {
      ticketId: reference,
      provider: AhaProvider.providerLabel,
      action: existing ? 'updated' : 'created',
      commentId: String(comment?.id ?? existing?.id ?? ''),
      url: comment?.url || AhaProvider.featureUrl(this.host, reference),
    };
  }

  /** Aha! keys are upper case: it answers "Record not found" to a lowercase reference */
  public normalizeTicketId(ticketId: string): string {
    return (ticketId || '').trim().toUpperCase();
  }

  /**
   * The neutral criteria become the filters of the features API (q, tag, assigned_to_user,
   * updated_since); the others (status, type, creation day, open only, several labels or projects)
   * are applied to each page. The page token holds the page and the position in it.
   */
  public async searchTickets(criteria: TicketSearchCriteria, options: TicketSearchOptions): Promise<TicketSearchResult> {
    const projects = (criteria.projects || []).map((project) => project.toUpperCase());
    const url = projects.length === 1
      ? `${this.host}/api/v1/products/${encodeURIComponent(projects[0])}/features`
      : `${this.host}/api/v1/features`;
    const params: Record<string, any> = { fields: AHA_SEARCH_FIELDS, per_page: AHA_SEARCH_PAGE_SIZE };
    if (criteria.text) {
      params.q = criteria.text;
    }
    if (criteria.labels?.length === 1) {
      params.tag = criteria.labels[0];
    }
    if (criteria.assignee === 'me') {
      params.assigned_to_user = (await this.whoAmI()).id;
    } else if (criteria.assignee && criteria.assignee !== 'none') {
      params.assigned_to_user = criteria.assignee;
    }
    if (criteria.updatedAfter) {
      params.updated_since = `${criteria.updatedAfter}T00:00:00Z`;
    }
    const [startPage, startSkip] = AhaProvider.parsePageToken(options.pageToken);
    const tickets: TicketSummary[] = [];
    let nextPageToken: string | null = null;
    for (let page = startPage, skip = startSkip; ; page++, skip = 0) {
      const response: any = await this.runOperation({ operation: 'list' }, () =>
        retryReadOn5xx(() => httpGet(url, this.requestConfig({ ...params, page })))
      );
      const matching = (response?.data?.features || []).filter((feature: any) => AhaProvider.matchesCriteria(feature, criteria, projects));
      const available = matching.slice(skip);
      const taken = available.slice(0, options.maxResults - tickets.length);
      tickets.push(...taken.map((feature: any) => this.toTicketSummary(feature)));
      const totalPages = Number(response?.data?.pagination?.total_pages ?? page);
      if (taken.length < available.length) {
        nextPageToken = `${page}.${skip + taken.length}`;
        break;
      }
      if (page >= totalPages || (response?.data?.features || []).length === 0) {
        break;
      }
      if (tickets.length >= options.maxResults) {
        nextPageToken = `${page + 1}.0`;
        break;
      }
    }
    AhaProvider.sortSummaries(tickets, criteria);
    return { tickets, nextPageToken, truncated: nextPageToken !== null };
  }

  /** Adds a tag; the tags already on the feature are kept */
  public async addTicketLabel(ticketId: string, label: string): Promise<void> {
    const reference = this.normalizeTicketId(ticketId);
    await this.runOperation({ operation: 'label', ticketId: reference }, () => this.addTagOnFeature(reference, label));
  }

  public async whoAmI(): Promise<TicketIdentity> {
    const response: any = await this.runOperation({ operation: 'whoami' }, () => retryReadOn5xx(() => httpGet(`${this.host}/api/v1/me`, this.requestConfig())));
    const user = response?.data?.user || {};
    return { id: user.id ? String(user.id) : null, displayName: user.name ?? null, email: user.email ?? null };
  }

  /** Workspaces (products) the API key can see; the key is the reference prefix of their features */
  public async listProjects(): Promise<TicketProjectSummary[]> {
    const response: any = await this.runOperation({ operation: 'meta' }, () =>
      retryReadOn5xx(() => httpGet(`${this.host}/api/v1/products`, this.requestConfig({ per_page: 200 })))
    );
    return (response?.data?.products || []).map((product: any) => ({ key: product?.reference_prefix || '', name: product?.name || '' }));
  }

  /**
   * The statuses of the feature workflow of the workspace. Aha! lists no feature types: the types
   * are the ones its features use (workflow kinds), read on up to 200 features.
   */
  public async getProjectMeta(project: string): Promise<TicketProjectMeta> {
    const product = encodeURIComponent(project.toUpperCase());
    const workflows: any = await this.runOperation({ operation: 'meta' }, () =>
      retryReadOn5xx(() => httpGet(`${this.host}/api/v1/products/${product}/workflows`, this.requestConfig()))
    );
    const featureWorkflow = (workflows?.data?.workflows || []).find((workflow: any) => workflow?.statusable_type === 'Feature');
    const statuses = (featureWorkflow?.workflow_statuses || []).map((status: any) => ({ id: String(status.id), name: status.name }));
    const features: any = await this.runOperation({ operation: 'meta' }, () =>
      retryReadOn5xx(() => httpGet(`${this.host}/api/v1/products/${product}/features`, this.requestConfig({ fields: 'workflow_kind', per_page: 200 })))
    );
    const kinds = new Map<string, string>();
    for (const feature of features?.data?.features || []) {
      if (feature?.workflow_kind?.name) {
        kinds.set(String(feature.workflow_kind.id), feature.workflow_kind.name);
      }
    }
    const names = statuses.map((status: { name: string }) => status.name);
    return {
      project: project.toUpperCase(),
      issueTypes: [...kinds].map(([id, name]) => ({ id, name })),
      statuses,
      statusesByType: Object.fromEntries([...kinds.values()].map((name) => [name, names])),
    };
  }

  /** Moves the feature to the workflow status named (name or id, any case) */
  public async transitionTicket(ticketId: string, status: string): Promise<string> {
    const reference = this.normalizeTicketId(ticketId);
    const response: any = await this.runOperation({ operation: 'transition', ticketId: reference }, () =>
      httpPut(this.featureApiUrl(reference), { feature: { workflow_status: status.trim() } }, this.requestConfig({ fields: 'workflow_status' }))
    );
    const reached = response?.data?.feature?.workflow_status;
    const wanted = status.trim().toLowerCase();
    if (!reached || (String(reached.name || '').toLowerCase() !== wanted && String(reached.id) !== status.trim())) {
      throw new SfError(t('ticketTransitionNotAvailable', { status, ticketId: reference }), TICKET_ERROR.transitionInvalid);
    }
    return reached.name;
  }

  /**
   * Writes the estimate of the feature (original_estimate, in the work units of the workspace), or
   * the custom field named by options.field. A filled value is kept unless options.overwrite.
   */
  public async setTicketPoints(ticketId: string, points: number, options: TicketPointsOptions = {}): Promise<TicketStepResult> {
    const reference = this.normalizeTicketId(ticketId);
    const field = options.field || 'original_estimate';
    const feature: any = await this.runOperation({ operation: 'points', ticketId: reference }, () =>
      retryReadOn5xx(() => this.fetchFeature(reference, field === 'original_estimate' ? 'original_estimate' : 'custom_fields'))
    );
    if (!feature) {
      throw new SfError(t('ticketNotFound', { ticketId: reference }), TICKET_ERROR.notFound);
    }
    const customField = field === 'original_estimate' ? null : (feature.custom_fields || []).find((candidate: any) => candidate?.key === field);
    if (field !== 'original_estimate' && !customField) {
      return { status: 'skipped', value: null, field, reason: 'field-not-on-issue' };
    }
    const current = field === 'original_estimate' ? AhaProvider.estimateOf(feature) : customField.value;
    if (current !== undefined && current !== null && current !== '' && !options.overwrite) {
      return { status: 'skipped', value: current, field, reason: 'already-set' };
    }
    const update = field === 'original_estimate' ? { original_estimate: points } : { custom_fields: { [field]: points } };
    await this.runOperation({ operation: 'points', ticketId: reference }, () => httpPut(this.featureApiUrl(reference), { feature: update }, this.requestConfig({ fields: 'reference_num' })));
    return { status: 'done', value: points, field };
  }

  /**
   * AHA_HOST may be given as a bare account host or as a full URL, with or without a path.
   * Always https: the API key must never leave in clear text because of a scheme typed by hand.
   */
  private static getHost(config: any = {}): string {
    const raw = String(getEnvVar('AHA_HOST') || config?.ahaHost || '').trim();
    if (!raw) {
      return '';
    }
    try {
      return `https://${new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).host}`;
    } catch {
      return '';
    }
  }

  /**
   * True for the host of the project, and for another aha.io host of the same account: Aha! serves
   * an account on its main host (acme.aha.io) and on a regional one (acme.euw4.aha.io).
   */
  private static isSameAccount(otherHost: string, projectHost: string): boolean {
    try {
      const other = otherHost.toLowerCase();
      const project = new URL(projectHost).host.toLowerCase();
      return other === project || (other.endsWith('.aha.io') && project.endsWith('.aha.io') && other.split('.')[0] === project.split('.')[0]);
    } catch {
      return false;
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

  private logBackoff = (size: number, e: unknown, waitMs: number): void => {
    uxLog('log', this, c.grey('[AhaProvider] ' + t('providerThrottledBackoff', { count: size, waitSeconds: Math.round(waitMs / 1000), message: (e as Error)?.message || '' })));
  };

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
    let truncated = false;
    try {
      for (let page = 1; ; page++) {
        const response = await httpGet(`${this.featureApiUrl(reference)}/comments`, this.requestConfig({ page, per_page: AHA_COMMENTS_PAGE_SIZE }));
        const comments = response?.data?.comments || [];
        all.push(...comments);
        const totalPages = response?.data?.pagination?.total_pages ?? page;
        const lastPage = comments.length === 0 || page >= totalPages;
        if (all.length > AHA_COMMENTS_MAX || (all.length === AHA_COMMENTS_MAX && !lastPage)) {
          truncated = true;
          break;
        }
        if (lastPage) {
          break;
        }
      }
    } catch (e: any) {
      // The feature itself was read: return it with the comments collected so far, flagged as incomplete
      uxLog('warning', this, c.yellow('[AhaProvider] ' + t('ahaProviderCommentsError', { ticketId: reference, message: e.message })));
      truncated = true;
    }
    // Aha! lists the newest comment first, a reader expects the conversation in the order it happened
    all.sort((a, b) => String(a?.created_at || '').localeCompare(String(b?.created_at || '')));
    return { comments: all.slice(0, AHA_COMMENTS_MAX), truncated };
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
      const webHost = new URL(feature?.url || '').host;
      if (AhaProvider.isSameAccount(webHost, this.host) && isSameHost(firstUrl, `https://${webHost}`)) {
        return `https://${webHost}`;
      }
    } catch {
      // Not a URL: keep the configured host, and the download is refused
    }
    return this.host;
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

  /** The most recent comment holding the marker, the comments being sorted by creation date */
  private async findMarkedComment(reference: string, marker: string): Promise<any | null> {
    const { comments } = await this.fetchAllComments(reference);
    const marked = comments.filter((comment: any) => hasMarker(comment?.body, marker));
    return marked.length > 0 ? marked[marked.length - 1] : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Aha! formats: search filters, page tokens, error bodies and mentions. They stay here
  // ---------------------------------------------------------------------------------------------

  /** Named errors on every failure of the ticket operations, with the reason Aha! gave */
  private async runOperation<T>(context: Omit<TicketErrorContext, 'providerLabel'>, call: () => Promise<T>): Promise<T> {
    if (!this.isActive) {
      throw new SfError(t('ticketProviderNoCredential', { provider: AhaProvider.providerLabel }), TICKET_ERROR.providerNotConfigured);
    }
    try {
      return await call();
    } catch (e: any) {
      throw toTicketError(e, { providerLabel: AhaProvider.providerLabel, serverMessage: AhaProvider.serverMessageOf(e), ...context });
    }
  }

  /** Aha! answers { errors: { message } } or { error: "..." } */
  private static serverMessageOf(error: any): string | undefined {
    const data = error?.response?.data;
    const message = data?.errors?.message ?? data?.error ?? data?.message;
    return typeof message === 'string' && message ? message : undefined;
  }

  private toTicketSummary(feature: any): TicketSummary {
    const reference = feature?.reference_num || '';
    return {
      id: reference,
      url: feature?.url || AhaProvider.featureUrl(this.host, reference),
      subject: feature?.name || '',
      type: feature?.workflow_kind?.name || '',
      status: feature?.workflow_status?.name || '',
      priority: '',
      assignee: feature?.assigned_to_user?.name || null,
      created: feature?.created_at || '',
      updated: feature?.updated_at || '',
      labels: feature?.tags || [],
      assigneeId: feature?.assigned_to_user?.id ? String(feature.assigned_to_user.id) : null,
      project: AhaProvider.projectOfReference(reference),
      areaPath: feature?.release?.name || null,
    };
  }

  /** PROD-12 -> PROD */
  private static projectOfReference(reference: string): string {
    return /^([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(reference || '')?.[1]?.toUpperCase() || '';
  }

  /** The criteria the features API cannot filter on */
  private static matchesCriteria(feature: any, criteria: TicketSearchCriteria, projects: string[]): boolean {
    const anyOf = (values: string[] | undefined, value: string) => !values?.length || values.some((wanted) => wanted.toLowerCase() === value.toLowerCase());
    if (projects.length > 1 && !projects.includes(AhaProvider.projectOfReference(feature?.reference_num))) {
      return false;
    }
    if (!anyOf(criteria.statuses, feature?.workflow_status?.name || '') || !anyOf(criteria.types, feature?.workflow_kind?.name || '')) {
      return false;
    }
    if (criteria.assignee === 'none' && feature?.assigned_to_user) {
      return false;
    }
    const tags: string[] = feature?.tags || [];
    if (criteria.labels && criteria.labels.length > 1 && !criteria.labels.some((label) => tags.some((tag) => tag.toLowerCase() === label.toLowerCase()))) {
      return false;
    }
    if (criteria.createdAfter && String(feature?.created_at || '').slice(0, 10) < criteria.createdAfter) {
      return false;
    }
    return !(criteria.openOnly && feature?.workflow_status?.complete === true);
  }

  private static sortSummaries(tickets: TicketSummary[], criteria: TicketSearchCriteria): void {
    const key = criteria.orderBy === 'updated' ? 'updated' : 'created';
    tickets.sort((a, b) => (criteria.descending ? -1 : 1) * String(a[key]).localeCompare(String(b[key])));
  }

  /** "3.40": page 3, from its 41st matching feature. Opaque for the caller */
  private static parsePageToken(token: string | null | undefined): [number, number] {
    const match = /^(\d+)\.(\d+)$/.exec(String(token || ''));
    return match ? [Math.max(1, Number(match[1])), Number(match[2])] : [1, 0];
  }

  private static escapeHtml(text: string): string {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** The assignee named after the first block: the Aha! API offers no mention a comment can carry */
  private static withHtmlMention(html: string, assignee: TicketAssignee | null | undefined): string {
    if (!assignee?.displayName) {
      return html;
    }
    const line = `<p>${AhaProvider.escapeHtml(mentionLead())}<strong>${AhaProvider.escapeHtml(assignee.displayName)}</strong></p>`;
    const end = html.search(/<\/(p|h\d|ul|ol)>/);
    if (end < 0) {
      return line + html;
    }
    const close = html.indexOf('>', end) + 1;
    return html.slice(0, close) + line + html.slice(close);
  }
}
