import { Version2Client, Version3Client, Version3Models } from "jira.js";
import type { Config } from "jira.js";
import { recordTicketCollectionIssue, TicketProviderRoot } from "./ticketProviderRoot.js";
import c from "chalk";
import sortArray from '../utils/sortArray.js';
// Type-only: a value import here would close a runtime cycle index -> provider -> index
import type { Ticket, TicketsFromStringOptions } from "./index.js";
import { extractRegexMatches, uxLog } from "../utils/index.js";
import { PROVIDER_BATCH_PROFILES, mapInAdaptiveBatchesSettled } from '../utils/adaptiveBatch.js';
import { SfError } from "@salesforce/core";
import { getConfig, getEnvVar } from "../../config/index.js";
import { CommonPullRequestInfo } from "../gitProvider/index.js";
import { t } from '../utils/i18n.js';
import { httpGet, httpPost } from "../utils/httpUtils.js";
import { WebSocketClient } from "../websocketClient.js";
import {
  PostCommentOptions,
  PostCommentResult,
  buildDeploymentCommentMarkdown,
  hasMarker,
  markdownMarkerFooter,
} from "./utils/ticketComment.js";
import { markdownToAdf, markdownToJiraWiki } from "./utils/markdownToTicketFormats.js";
import {
  TicketDetails,
  TicketDetailsOptions,
  capText,
  classifyAttachment,
  detectManualActions,
  htmlToPlainText,
  newTicketDetails,
  normalizeText,
} from "./utils/ticketDetails.js";
import {
  TICKET_ERROR,
  TicketErrorContext,
  TicketSearchOptions,
  TicketSearchResult,
  TicketSummary,
  toIsoDateTime,
  toTicketError,
} from "./utils/ticketOperations.js";
import {
  TicketIdentity,
  TicketPointsOptions,
  TicketProjectMeta,
  TicketProjectSummary,
  TicketStepResult,
  isProjectAllowed,
  retryReadOn5xx,
  scopeJql,
  withAdfMention,
  withWikiMention,
} from "./utils/ticketQualify.js";

// One way of authenticating to JIRA. The client is built lazily, so that a refused credential can
// be replaced by the next one without paying for the ones that are never used.
type JiraAuth = {
  logMessage: string;
  label: string;
  buildClient: () => Promise<Version2Client | Version3Client | null>;
  // Same credential expressed as a raw header, for the calls jira.js does not cover (binary
  // attachment download). Absent when the header can only be known after the client is built.
  headers?: () => Record<string, string>;
};

/** Host of the links built for JIRA identifiers when no JIRA host is configured */
export const JIRA_HOST_PLACEHOLDER = "https://define.JIRA_HOST.in.cicd.variables/";

export class JiraProvider extends TicketProviderRoot {
  public static readonly providerKey = "jira" as const;
  public static readonly providerLabel = "JIRA";
  public static readonly supportsTicketDetails = true;
  public static readonly supportsComments = true;

  // Version3Client for Jira Cloud, Version2Client for Jira Server / Data Center
  private jiraClient: Version2Client | Version3Client | null = null;
  private jiraHost: string | null = null;
  // A refused credential answers with a login page instead of JSON on some Server/DC instances
  private static readonly LOGIN_PAGE_ERROR = "JIRA answered with an HTML login page instead of JSON";

  /** A JIRA Server behind an SSO proxy answers 200 with its HTML login page: detect that shape */
  private static containsHtmlLoginPage(value: any): boolean {
    return /<!doctype html>/i.test(typeof value === "string" ? value : JSON.stringify(value ?? ""));
  }

  // Credentials not tried yet, in order of relevance for the host: consumed by useNextAuth()
  private nextAuths: JiraAuth[] = [];
  // Set as soon as a call answers: the current credential is the right one, stop switching
  private authValidated = false;

  // Jira Cloud caps a search page at 100 issues when fields are requested
  private static readonly SEARCH_PAGE_SIZE = 100;
  private static readonly SEARCH_FIELDS = ["summary", "issuetype", "status", "priority", "assignee", "created", "updated", "labels", "project"];
  private static readonly KEY_PROJECT_RE = /^([A-Z][A-Z0-9_]+)-\d+$/;
  private static readonly POINTS_FIELD_RE = /^customfield_\d+$/;

  /** Cloud users carry accountId; Server / Data Center users carry name (or key) instead */
  public static identityOf(user: any): string | null {
    return user?.accountId ?? user?.name ?? user?.key ?? null;
  }

  /** Project key of an issue key (ACME-12 -> ACME) */
  public static projectOfKey(key: string): string {
    return JiraProvider.KEY_PROJECT_RE.exec((key || "").toUpperCase())?.[1] || "";
  }
  // Raw header form of the credential currently in use, for the binary attachment downloads that
  // jira.js does not expose. Null when the active credential cannot be replayed as a header.
  private activeAuthHeaders: Record<string, string> | null = null;

  constructor(config: any) {
    super();
    const rawHost = getEnvVar("JIRA_HOST") || config.jiraHost || "";
    const sanitizedHost = rawHost.startsWith("http") ? rawHost : `https://${rawHost}`;
    this.jiraHost = sanitizedHost.replace(/\/$/, "");
    // Client Credentials (Jira Cloud only - uses Atlassian OAuth2 API)
    const clientCredentialsAuth: JiraAuth | null = getEnvVar("JIRA_CLIENT_ID") && getEnvVar("JIRA_CLIENT_SECRET")
      ? {
        logMessage: t('jiraProviderAuthClientCredentials'),
        label: "JIRA_CLIENT_ID + JIRA_CLIENT_SECRET",
        buildClient: () => this.buildClientCredentialsClient(),
      }
      : null;
    // Basic Auth (email + API token for Cloud, username + password for Server/DC)
    const basicAuth = getEnvVar("JIRA_EMAIL") && getEnvVar("JIRA_TOKEN")
      ? {
        logMessage: t('jiraProviderAuthEmailToken'),
        label: "JIRA_EMAIL + JIRA_TOKEN",
        buildClient: async () => this.createJiraClient({ basic: { email: getEnvVar("JIRA_EMAIL") || "", apiToken: getEnvVar("JIRA_TOKEN") || "" } }),
        headers: () => ({
          Authorization: "Basic " + Buffer.from(`${getEnvVar("JIRA_EMAIL") || ""}:${getEnvVar("JIRA_TOKEN") || ""}`).toString("base64"),
        }),
      }
      : null;
    // Personal access token, sent as a Bearer header
    const patAuth = getEnvVar("JIRA_PAT")
      ? {
        logMessage: t('jiraProviderAuthPat'),
        label: "JIRA_PAT",
        buildClient: async () => this.createJiraClient({ oauth2: { accessToken: getEnvVar("JIRA_PAT") || "" } }),
        headers: () => ({ Authorization: `Bearer ${getEnvVar("JIRA_PAT") || ""}` }),
      }
      : null;
    // Every credential found in the variables is kept, so that a refused one can be replaced by the
    // next one. Jira Server / Data Center answers 401 when a Personal Access Token is sent with
    // Basic Auth: it only accepts it as a Bearer header, so JIRA_PAT is tried first there. Jira
    // Cloud API tokens are made for Basic Auth, so that one keeps the priority on Cloud hosts.
    const hostAuths = this.isJiraCloud() ? [basicAuth, patAuth] : [patAuth, basicAuth];
    for (const auth of [clientCredentialsAuth, ...hostAuths]) {
      if (auth) {
        this.nextAuths.push(auth);
        this.isActive = true;
      }
    }
  }

  /** JIRA host as every caller expects it: `https://` added when missing, no trailing slash. Empty when unset. */
  public static normalizeHost(rawHost: unknown): string {
    const host = String(rawHost ?? "").trim();
    return host ? (host.startsWith("http") ? host : `https://${host}`).replace(/\/+$/, "") : "";
  }

  /**
   * REST base URL and headers of the first configured credential, for callers that send their own
   * calls (the Xray test cases provider), so JIRA is configured once. Client credentials go
   * through the Atlassian API gateway. Null when no credential is configured.
   */
  public async getRestAccess(): Promise<{ label: string; baseUrl: string; headers: Record<string, string> } | null> {
    if (getEnvVar("JIRA_CLIENT_ID") && getEnvVar("JIRA_CLIENT_SECRET")) {
      const accessToken = await this.getOAuthToken();
      const cloudId = await this.getCloudId(accessToken);
      return {
        label: "JIRA_CLIENT_ID + JIRA_CLIENT_SECRET",
        baseUrl: `https://api.atlassian.com/ex/jira/${cloudId}`,
        headers: { Authorization: `Bearer ${accessToken}` },
      };
    }
    const auth = this.nextAuths.find((candidate) => candidate.headers);
    return auth?.headers ? { label: auth.label, baseUrl: this.jiraHost || "", headers: auth.headers() } : null;
  }

  /** Activates the next credential that has not been tried yet */
  private async useNextAuth(): Promise<void> {
    const auth = this.nextAuths.shift();
    if (!auth) {
      return;
    }
    uxLog("log", this, c.grey('[JiraProvider] ' + auth.logMessage));
    this.activeAuthHeaders = auth.headers ? auth.headers() : null;
    try {
      this.jiraClient = await auth.buildClient();
    } catch (e: any) {
      // jira.js validates the host when the client is built, and throws if it is malformed.
      // Recoverable (the next credential is tried), so warning level.
      uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderClientBuildError', { label: auth.label, message: e.message })));
      this.jiraClient = null;
    }
  }

  /**
   * Client Credentials OAuth2 flow (Jira Cloud only): the access token and the cloud id have to be
   * resolved from the Atlassian API before the client can be built.
   */
  private async buildClientCredentialsClient(): Promise<Version3Client | null> {
    try {
      const accessToken = await this.getOAuthToken();
      const cloudId = await this.getCloudId(accessToken);
      if (!cloudId) {
        // Recoverable (the next credential is tried), so warning level
        uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderCloudIdNotResolved')));
        return null;
      }
      // Client Credentials always target Jira Cloud via the Atlassian API gateway
      return new Version3Client({
        host: `https://api.atlassian.com/ex/jira/${cloudId}`,
        authentication: { oauth2: { accessToken: accessToken } },
      });
    } catch (e: any) {
      // Recoverable (the next credential is tried), so warning level
      uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderOauthInitError', { message: e.message })));
      return null;
    }
  }

  /**
   * Runs a JIRA API call. If the credentials are refused, retries with the next available one and
   * keeps it for all the following calls (same fallback as the VsCode extension).
   */
  private async runJiraCall<T>(call: (client: Version2Client) => Promise<T>): Promise<T> {
    for (;;) {
      const client = await this.getJiraClient();
      if (!client) {
        throw new SfError("No JIRA credential left to try");
      }
      try {
        const result = await call(client as Version2Client);
        // A JIRA Server behind an SSO proxy answers 200 with its login page rather than a 401:
        // the credential is refused too, so raise it as such to let the next one be tried.
        // Only sniffed until a credential is validated: a ticket whose text legitimately
        // contains an HTML doctype must not burn the working credential, and serializing
        // every payload of the run would be wasted work.
        if (!this.authValidated && JiraProvider.containsHtmlLoginPage(result)) {
          throw new SfError(JiraProvider.LOGIN_PAGE_ERROR);
        }
        this.authValidated = true;
        return result;
      } catch (e) {
        // Only a 401 means the credential itself is refused: a 403 or a 404 is about permissions
        // or a missing ticket, and another credential would not do better.
        const status = (e as any)?.response?.status;
        const isAuthError = status === 401
          || (e as Error).message?.includes("status code 401")
          || (e as Error).message === JiraProvider.LOGIN_PAGE_ERROR;
        if (this.authValidated || !isAuthError || this.nextAuths.length === 0) {
          throw e;
        }
        uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderAuthFallback', {
          next: this.nextAuths[0].label,
          message: (e as Error).message,
        })));
        this.jiraClient = null; // Next loop turn activates the next credential
      }
    }
  }

  /**
   * Detects whether the configured JIRA host is Jira Cloud.
   * Jira Cloud instances use atlassian.net or .jira.com domains.
   * Jira Server / Data Center uses custom/on-premise domains.
   */
  private isJiraCloud(): boolean {
    return (this.jiraHost || "").includes("atlassian.net") || (this.jiraHost || "").includes(".jira.com");
  }

  /**
   * Creates the appropriate JIRA client based on the hosting type:
   * - Version3Client for Jira Cloud (REST API v3 with ADF support)
   * - Version2Client for Jira Server / Data Center (REST API v2 with plain text)
   */
  private createJiraClient(
    authConfig: { oauth2: { accessToken: string } } | { basic: { email: string; apiToken: string } },
  ): Version2Client | Version3Client {
    const host = (this.jiraHost || "").replace(/\/$/, "");
    // jira.js types Config as a union discriminated on the authentication method, so an object
    // whose "authentication" property is itself a union matches no variant: build one variant at a
    // time. Passing only an accessToken keeps the plain "Authorization: Bearer" behavior, without
    // the automatic cloudId resolution that a refreshToken or a cloudId would turn on.
    const clientConfig: Config =
      "oauth2" in authConfig
        ? { host, authentication: { oauth2: authConfig.oauth2 } }
        : { host, authentication: { basic: authConfig.basic } };
    if (this.isJiraCloud()) {
      return new Version3Client(clientConfig);
    }
    // Jira Server / Data Center only supports REST API v2
    return new Version2Client(clientConfig);
  }

  public static isAvailable(config: any): boolean {
    if (
      // Client Credentials
      (getEnvVar("JIRA_HOST") || config.jiraHost) &&
      getEnvVar("JIRA_CLIENT_ID") &&
      getEnvVar("JIRA_CLIENT_SECRET")
    ) {
      return true;
    }
    if (
      // Basic auth
      (getEnvVar("JIRA_HOST") || config.jiraHost) &&
      getEnvVar("JIRA_TOKEN") &&
      getEnvVar("JIRA_EMAIL")
    ) {
      return true;
    }
    if (
      // Personal Access Token
      (getEnvVar("JIRA_HOST") || config.jiraHost) &&
      getEnvVar("JIRA_PAT")
    ) {
      return true;
    }
    return false;
  }

  public getLabel(): string {
    return "sfdx-hardis JIRA connector";
  }

  private async getJiraClient(): Promise<Version2Client | Version3Client | null> {
    if (!this.isActive) {
      return null;
    }
    // Take the credentials one after the other until one of them gives a client
    while (!this.jiraClient && this.nextAuths.length > 0) {
      await this.useNextAuth();
    }
    return this.jiraClient;
  }

  private async getOAuthToken(): Promise<string> {
    const clientId = getEnvVar("JIRA_CLIENT_ID") || "";
    const clientSecret = getEnvVar("JIRA_CLIENT_SECRET") || "";

    const tokenResponse = await httpPost("https://api.atlassian.com/oauth/token", {
      audience: "api.atlassian.com",
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    return tokenResponse.data.access_token;
  }

  private async getCloudId(accessToken: string): Promise<string> {
    const resourcesResponse = await httpGet("https://api.atlassian.com/oauth/token/accessible-resources", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    let cloudId = "";
    for (const resource of resourcesResponse.data) {
      if (this.jiraHost?.includes(resource.url) || resource.url.includes(this.jiraHost || "")) {
        cloudId = resource.id;
        break;
      }
    }

    if (!cloudId && resourcesResponse.data.length > 0) {
      cloudId = resourcesResponse.data[0].id; // Fallback to first available resource
      // Without this warning, the 404 answered by the API gateway for every ticket looks unexplained
      uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderHostResourceMismatch', { host: this.jiraHost, url: resourcesResponse.data[0].url })));
    }
    return cloudId;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public static async getTicketsFromString(text: string, options: TicketsFromStringOptions = {}): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    // Extract JIRA tickets using URL references
    const jiraUrlRegex = /(https:\/\/.*(jira|atlassian\.net).*\/[A-Z0-9]+-\d+\b)/g;
    const jiraMatches = await extractRegexMatches(jiraUrlRegex, text);
    for (const jiraTicketUrl of jiraMatches) {
      const pattern = /https:\/\/.*\/([A-Z0-9]+-\d+\b)/;
      const match = jiraTicketUrl.match(pattern);
      if (match) {
        const ticketId = match[1];
        if (!tickets.some((ticket) => ticket.url === jiraTicketUrl || ticket.id === ticketId)) {
          tickets.push({
            provider: "JIRA",
            url: jiraTicketUrl,
            id: ticketId,
          });
        }
      }
    }
    // Extract JIRA tickets using Identifiers
    const config = options.config || (await getConfig("project"));
    const jiraBaseUrl = getEnvVar("JIRA_HOST") || config.jiraHost || JIRA_HOST_PLACEHOLDER;
    const sanitizedBaseUrl = jiraBaseUrl.startsWith("http") ? jiraBaseUrl : `https://${jiraBaseUrl}`;
    const jiraRegex = getEnvVar("JIRA_TICKET_REGEX") || config.jiraTicketRegex || "(?<=[^a-zA-Z0-9_-]|^)([A-Za-z0-9]{2,10}-\\d{1,6})(?=[^a-zA-Z0-9_-]|$)";
    const jiraRefRegex = new RegExp(jiraRegex, "gm");
    const jiraRefs = await extractRegexMatches(jiraRefRegex, text);
    const jiraBaseUrlBrowse = sanitizedBaseUrl.replace(/\/$/, "") + "/browse/";
    for (const jiraRef of jiraRefs) {
      const jiraTicketUrl = jiraBaseUrlBrowse + jiraRef;
      if (!tickets.some((ticket) => ticket.url === jiraTicketUrl || ticket.id === jiraRef)) {
        tickets.push({
          provider: "JIRA",
          url: jiraTicketUrl,
          id: jiraRef,
        });
      }
    }

    const ticketsSorted: Ticket[] = sortArray(tickets, { by: ["id"], order: ["asc"] });
    return ticketsSorted;
  }

  public async collectTicketsInfo(tickets: Ticket[]) {
    const activeClient = await this.getJiraClient();
    const jiraTicketsNumber = tickets.filter((ticket) => ticket.provider === "JIRA").length;
    if (!activeClient) {
      // No credential could even build a client: say it, else the tickets would just come back
      // without title nor status and nothing would tell why.
      if (jiraTicketsNumber > 0) {
        uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderNoUsableCredential')));
        recordTicketCollectionIssue(`No usable JIRA credential: details could not be retrieved for ${jiraTicketsNumber} JIRA ticket(s). Check the JIRA authentication of the CI job.`);
      }
      return tickets;
    }
    if (jiraTicketsNumber > 0) {
      uxLog(
        "action",
        this,
        c.cyan('[JiraProvider] ' + t('jiraProviderCollectingTickets', { jiraTicketsNumber, jiraHost: this.jiraHost })),
      );
    }
    // One HTTP call per ticket: show a progress bar instead of flooding the log with one line each
    const showProgress = jiraTicketsNumber > 1;
    if (showProgress) {
      WebSocketClient.sendProgressStartMessage(t('collectingTicketsInfo', { count: jiraTicketsNumber }), jiraTicketsNumber);
    }
    let failedTicketsNumber = 0;
    let firstErrorMessage = '';
    // One HTTP call per ticket, in the adaptive batches of the Jira ladder (Cloud or Server), shrunk
    // only when Jira throttles. A single aggregated warning is displayed after the loop: per-ticket
    // failures usually share the same cause (expired token, missing permission) and would flood the log.
    const jiraTickets = tickets.filter((ticket) => ticket.provider === "JIRA");
    const failedIds = new Set<string>();
    const infos = await mapInAdaptiveBatchesSettled(jiraTickets, (ticket) => this.runJiraCall((client) => client.issues.getIssue({ issueIdOrKey: ticket.id })), {
      sizes: this.isJiraCloud() ? PROVIDER_BATCH_PROFILES.jiraCloud : PROVIDER_BATCH_PROFILES.jiraServer,
      onBackoff: (size, e, waitMs) => uxLog("log", this, c.grey('[JiraApi] ' + t('providerThrottledBackoff', { count: size, waitSeconds: Math.round(waitMs / 1000), message: (e as Error)?.message || '' }))),
      onError: (e, ticket) => {
        uxLog("log", this, c.grey('[JiraApi] ' + t('jiraApiErrorGettingTicket', { ticketId: ticket.id, message: (e as Error).message })));
        failedIds.add(ticket.id);
        failedTicketsNumber++;
        firstErrorMessage = firstErrorMessage || (e as Error).message;
      },
      onProgress: (done, total) => {
        if (showProgress) {
          WebSocketClient.sendProgressStepMessage(done, total);
        }
      },
    });
    const infoById = new Map(jiraTickets.map((ticket, index) => [ticket.id, infos[index] ?? null]));
    for (const ticket of tickets) {
      if (ticket.provider === "JIRA") {
        const ticketInfo: any = infoById.get(ticket.id) ?? null;
        const errorCaught = failedIds.has(ticket.id);
        if (ticketInfo) {
          // Description is ADF Document on Cloud (v3) or plain string on Server/DC (v2)
          const body = this.getPlainTextFromDescription(ticketInfo?.fields?.description);
          ticket.foundOnServer = true;
          ticket.subject = ticketInfo?.fields?.summary || "";
          ticket.body = body;
          ticket.status = ticketInfo.fields?.status?.id || "";
          ticket.statusLabel = ticketInfo.fields?.status?.name || "";
          const assignee = ticketInfo.fields?.assignee as any;
          const reporter = ticketInfo.fields?.reporter as any;
          if (assignee) {
            ticket.assignee = assignee.accountId || assignee.name || "";
            ticket.assigneeLabel = assignee.displayName || "";
          }
          if (reporter) {
            ticket.reporter = reporter.accountId || reporter.name || "";
            ticket.reporterLabel = reporter.displayName || "";
          }
          const preferredOwner = assignee || reporter;
          if (preferredOwner) {
            ticket.author = preferredOwner.accountId || preferredOwner.name || "";
            ticket.authorLabel = preferredOwner.displayName || "";
          }
          if (ticket.subject === "") {
            uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderUnableToCollectTicket', { ticketId: ticket.id })));
            if (JiraProvider.containsHtmlLoginPage(ticketInfo)) {
              uxLog("log", this, c.grey('[JiraProvider] ' + t('jiraProviderAuthConfigIssue')));
            } else {
              uxLog("log", this, c.grey(JSON.stringify(ticketInfo)));
            }
            ticket.foundOnServer = false;
            failedTicketsNumber++;
            firstErrorMessage = firstErrorMessage || 'JIRA returned an unusable response (possibly an authentication redirect)';
          }
          // "other" keeps this per-ticket line out of the VS Code UI, where the progress bar shows instead
          uxLog("other", this, c.grey('[JiraProvider] ' + t('jiraProviderCollectedTicket', { ticketId: ticket.id })));
        } else if (!errorCaught) {
          // Resolved without throwing but no usable payload: still a collection failure.
          // The thrown case was already counted and logged in the catch block above.
          uxLog("log", this, c.grey('[JiraProvider] ' + t('jiraProviderUnableToGetIssue', { ticketId: ticket.id })));
          failedTicketsNumber++;
          firstErrorMessage = firstErrorMessage || 'no details returned by the JIRA API';
        }
      }
    }
    if (showProgress) {
      WebSocketClient.sendProgressEndMessage(jiraTicketsNumber);
    }
    if (failedTicketsNumber > 0) {
      uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderTicketsCollectionFailed', {
        failed: failedTicketsNumber,
        total: jiraTicketsNumber,
        message: firstErrorMessage,
      })));
      recordTicketCollectionIssue(`Details could not be retrieved for ${failedTicketsNumber} of ${jiraTicketsNumber} JIRA ticket(s) (first error: ${firstErrorMessage}). Check the JIRA authentication and permissions of the CI job.`);
    }
    return tickets;
  }

  /**
   * True when the identifier has the shape of a JIRA key (PROJECT-123).
   * AB- / GH- / GL- are excluded: those prefixes belong to Azure Boards, GitHub and GitLab issues,
   * and they would otherwise match this pattern too.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public static matchesTicketId(ticketId: string, _config: any = {}): boolean {
    const trimmed = (ticketId || "").trim();
    if (/^(AB|GH|GL)-[0-9]+$/i.test(trimmed)) {
      return false;
    }
    return /^[A-Za-z][A-Za-z0-9]{1,9}-[0-9]{1,6}$/.test(trimmed);
  }

  /** Sprint and story points live in a custom field whose id differs per instance: try the usual ones */
  private static firstFieldValue(fields: any, candidateNames: string[]): string {
    for (const name of candidateNames) {
      const value = fields?.[name];
      if (value === undefined || value === null || value === "") {
        continue;
      }
      if (Array.isArray(value)) {
        const last = value[value.length - 1];
        if (typeof last === "string") {
          // Server/DC returns the sprint as a serialized bean: "...,name=Sprint 12,..."
          const nameMatch = last.match(/name=([^,]+)/);
          return nameMatch ? nameMatch[1] : last;
        }
        if (last && typeof last === "object") {
          return String(last.name ?? last.value ?? "");
        }
        continue;
      }
      if (typeof value === "object") {
        return String(value.name ?? value.value ?? "");
      }
      return String(value);
    }
    return "";
  }

  private async fetchAllComments(issueKey: string): Promise<{ comments: any[]; truncated: boolean }> {
    const pageSize = 100;
    const maxTotal = 2000;
    const all: any[] = [];
    let startAt = 0;
    let truncated = false;
    for (;;) {
      const page: any = await this.runJiraCall((client) =>
        client.issueComments.getComments({ issueIdOrKey: issueKey, startAt, maxResults: pageSize, expand: "renderedBody" })
      );
      const comments = page?.comments || [];
      all.push(...comments);
      const total = page?.total ?? all.length;
      if (all.length >= maxTotal) {
        truncated = true;
        break;
      }
      if (comments.length === 0 || all.length >= total) {
        break;
      }
      startAt += comments.length;
    }
    return { comments: all, truncated };
  }

  public async getTicketDetails(ticketId: string, options: TicketDetailsOptions = {}): Promise<TicketDetails | null> {
    const issueKey = (ticketId || "").trim().toUpperCase();
    const client = await this.getJiraClient();
    if (!client) {
      uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderNoUsableCredential')));
      return null;
    }
    const issue: any = await this.runJiraCall((jiraClient) =>
      jiraClient.issues.getIssue({ issueIdOrKey: issueKey, expand: "renderedFields" })
    );
    if (!issue?.fields) {
      return null;
    }
    const fields = issue.fields;
    const rendered = issue.renderedFields || {};
    const details = newTicketDetails("JIRA", issue.key || issueKey);
    details.url = `${this.jiraHost}/browse/${details.id}`;
    details.subject = fields.summary || "";
    details.type = fields.issuetype?.name || "";
    details.status = fields.status?.name || "";
    details.priority = fields.priority?.name || "";
    details.assignee = fields.assignee?.displayName || "";
    details.assigneeId = JiraProvider.identityOf(fields.assignee);
    details.reporter = fields.reporter?.displayName || "";
    details.reporterId = JiraProvider.identityOf(fields.reporter);
    details.project = fields.project?.key || JiraProvider.projectOfKey(details.id);
    details.created = fields.created || "";
    details.updated = fields.updated || "";
    details.resolved = fields.resolutiondate || "";
    details.labels = fields.labels || [];
    details.components = (fields.components || []).map((component: any) => component?.name).filter(Boolean);
    details.fixVersions = (fields.fixVersions || []).map((version: any) => version?.name).filter(Boolean);
    details.parent = fields.parent?.key || "";
    details.epic = JiraProvider.firstFieldValue(fields, ["epic", "customfield_10014", "customfield_10008"]);
    details.sprint = JiraProvider.firstFieldValue(fields, ["sprint", "customfield_10020", "customfield_10010"]);
    details.storyPoints = JiraProvider.firstFieldValue(fields, ["story_points", "customfield_10016", "customfield_10028", "customfield_10026"]);
    // renderedFields gives HTML on both Cloud and Server; the ADF/plain fallback covers the rest
    details.description = capText(
      rendered.description ? htmlToPlainText(rendered.description) : normalizeText(this.getPlainTextFromDescription(fields.description))
    );

    const { comments, truncated } = options.skipComments ? { comments: [], truncated: false } : await this.fetchAllComments(details.id);
    details.commentsTruncated = truncated;
    details.comments = comments.map((comment: any) => ({
      author: comment?.author?.displayName || "",
      authorId: JiraProvider.identityOf(comment?.author),
      date: comment?.created || "",
      body: capText(comment?.renderedBody ? htmlToPlainText(comment.renderedBody) : normalizeText(this.getPlainTextFromDescription(comment?.body))),
    }));

    details.subtasks = (fields.subtasks || []).map((subtask: any) => ({
      relation: "subtask",
      id: subtask?.key || "",
      title: subtask?.fields?.summary || "",
      status: subtask?.fields?.status?.name || "",
      url: `${this.jiraHost}/browse/${subtask?.key || ""}`,
    }));

    for (const link of fields.issuelinks || []) {
      const target = link?.outwardIssue || link?.inwardIssue;
      if (!target) {
        continue;
      }
      details.links.push({
        relation: (link?.outwardIssue ? link?.type?.outward : link?.type?.inward) || "linked",
        id: target.key || "",
        title: target?.fields?.summary || "",
        status: target?.fields?.status?.name || "",
        url: `${this.jiraHost}/browse/${target.key || ""}`,
      });
    }
    if (details.parent) {
      details.links.push({
        relation: "parent",
        id: details.parent,
        title: fields.parent?.fields?.summary || "",
        status: fields.parent?.fields?.status?.name || "",
        url: `${this.jiraHost}/browse/${details.parent}`,
      });
    }

    details.attachments = (fields.attachment || []).map((attachment: any) => ({
      filename: attachment?.filename || "attachment",
      contentType: attachment?.mimeType || "",
      size: Number(attachment?.size || 0),
      created: attachment?.created || "",
      author: attachment?.author?.displayName || "",
      url: attachment?.content || "",
      kind: classifyAttachment(attachment?.mimeType || "", attachment?.filename || ""),
      localPath: null,
      textContent: null,
      truncated: false,
      error: null,
    }));
    if (this.activeAuthHeaders) {
      await this.downloadDetailsAttachments(details, this.jiraHost || "", this.activeAuthHeaders, options);
    } else if (details.attachments.length > 0 && options.downloadAttachments !== false) {
      // Client Credentials resolves its token inside the client: it cannot be replayed as a header here
      for (const attachment of details.attachments) {
        attachment.error = "Attachment download is not supported with the JIRA_CLIENT_ID / JIRA_CLIENT_SECRET authentication";
      }
    }

    details.manualActions = detectManualActions([
      details.description,
      ...details.comments.map((comment) => comment.body),
      ...details.attachments.map((attachment) => attachment.textContent),
    ]);
    return details;
  }

  /**
   * Runs one call of the ticket list / label / whoami / meta commands and of the post-comment steps: fails with a named error when no
   * credential is usable, and converts the HTTP failures into the named errors of the contract.
   */
  private async runTicketOperation<T>(
    context: Omit<TicketErrorContext, "providerLabel">,
    call: (client: Version2Client) => Promise<T>
  ): Promise<T> {
    if (!(await this.getJiraClient())) {
      throw new SfError(t('ticketProviderNoCredential', { provider: JiraProvider.providerLabel }), TICKET_ERROR.providerNotConfigured);
    }
    try {
      return await this.runJiraCall(call);
    } catch (e) {
      throw toTicketError(e, { providerLabel: JiraProvider.providerLabel, ...context });
    }
  }

  private toTicketSummary(issue: any): TicketSummary {
    const fields = issue?.fields || {};
    const key = issue?.key || "";
    return {
      id: key,
      url: `${this.jiraHost}/browse/${key}`,
      subject: fields.summary || "",
      type: fields.issuetype?.name || "",
      status: fields.status?.name || "",
      priority: fields.priority?.name || "",
      assignee: fields.assignee?.displayName || null,
      created: toIsoDateTime(fields.created || ""),
      updated: toIsoDateTime(fields.updated || ""),
      labels: fields.labels || [],
      assigneeId: JiraProvider.identityOf(fields.assignee),
      project: fields.project?.key || JiraProvider.projectOfKey(key),
      areaPath: null,
    };
  }

  /**
   * JQL search on /search/jql, the endpoint that replaced the removed /rest/api/3/search. The page
   * cursor is relayed as is: it is opaque by contract, and the JQL is the caller's, never rebuilt.
   * Never fetches more than options.maxResults issues.
   */
  public async searchTickets(query: string, options: TicketSearchOptions): Promise<TicketSearchResult> {
    // Programming error only: the CLI flag already enforces a minimum of 1
    if (!Number.isInteger(options.maxResults) || options.maxResults < 1) {
      throw new SfError(`maxResults must be a positive integer, got ${options.maxResults}`);
    }
    if (!(await this.getJiraClient())) {
      throw new SfError(t('ticketProviderNoCredential', { provider: JiraProvider.providerLabel }), TICKET_ERROR.providerNotConfigured);
    }
    const allowedProjects = options.allowedProjects || null;
    // Bounded before the call: a query cannot read outside the allowed projects, and the results are filtered again
    const jql = allowedProjects ? scopeJql(allowedProjects, query) : query;
    const result = this.isJiraCloud() ? await this.searchCloud(jql, options) : await this.searchServer(jql, options);
    result.tickets = result.tickets.filter((ticket) => isProjectAllowed(ticket.project, allowedProjects));
    if (result.tickets.length === 0) {
      result.warning = t("ticketListNoResult", { scope: (allowedProjects || []).join(", ") || "-" });
    }
    return result;
  }

  /**
   * Jira Server / Data Center has no /search/jql: the offset-based /search, with the offset carried
   * in the page token as a number in a string.
   */
  private async searchServer(jql: string, options: TicketSearchOptions): Promise<TicketSearchResult> {
    const startAt = Number(options.pageToken || 0) || 0;
    const page: any = await this.runTicketOperation({ operation: "list" }, (client) =>
      retryReadOn5xx(() =>
        client.issueSearch.searchForIssuesUsingJqlPost({
          jql,
          startAt,
          maxResults: Math.min(options.maxResults, JiraProvider.SEARCH_PAGE_SIZE),
          fields: JiraProvider.SEARCH_FIELDS,
        })
      )
    );
    const issues: any[] = page?.issues || [];
    const tickets = issues.filter((issue) => issue?.key).map((issue) => this.toTicketSummary(issue));
    const next = startAt + issues.length;
    const nextPageToken = issues.length > 0 && next < Number(page?.total ?? 0) ? String(next) : null;
    return { tickets, nextPageToken, truncated: nextPageToken !== null };
  }

  private async searchCloud(query: string, options: TicketSearchOptions): Promise<TicketSearchResult> {
    const tickets: TicketSummary[] = [];
    let pageToken: string | null = options.pageToken || null;
    for (;;) {
      const remaining = options.maxResults - tickets.length;
      const page: any = await this.runTicketOperation({ operation: "list" }, (client) =>
        client.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost({
          jql: query,
          nextPageToken: pageToken || undefined,
          maxResults: Math.min(remaining, JiraProvider.SEARCH_PAGE_SIZE),
          fields: JiraProvider.SEARCH_FIELDS,
        })
      );
      const issues: any[] = page?.issues || [];
      // An empty page ends the search: relaying its cursor would make a caller loop on empty pages
      if (issues.length === 0) {
        pageToken = null;
        break;
      }
      tickets.push(...issues.filter((issue) => issue?.key).map((issue) => this.toTicketSummary(issue)));
      pageToken = page?.nextPageToken || null;
      if (!pageToken || tickets.length >= options.maxResults) {
        break;
      }
    }
    return { tickets, nextPageToken: pageToken, truncated: pageToken !== null };
  }

  /** JIRA keys are upper case: acme-123 and ACME-123 are the same ticket */
  public normalizeTicketId(ticketId: string): string {
    return (ticketId || "").trim().toUpperCase();
  }

  /** One call per file, so that the file the server refuses is the one named in the error */
  /** Adds the label to the ones already on the ticket (update.add, never a replacement of the list) */
  public async addTicketLabel(ticketId: string, label: string): Promise<void> {
    const issueKey = this.normalizeTicketId(ticketId);
    await this.runTicketOperation({ operation: "label", ticketId: issueKey }, (client) =>
      client.issues.editIssue({ issueIdOrKey: issueKey, update: { labels: [{ add: label }] } })
    );
  }

  /**
   * Free-text comment, independent from the deployment comment. ADF on Jira Cloud (REST v3), text as
   * is on Server / Data Center (REST v2), the same split as the deployment comments. No duplicate
   * guard: the caller makes the run idempotent with the label it adds.
   */

  public async whoAmI(): Promise<TicketIdentity> {
    const me: any = await this.runTicketOperation({ operation: "whoami" }, (client) =>
      retryReadOn5xx(() => client.myself.getCurrentUser())
    );
    return { id: JiraProvider.identityOf(me), displayName: me?.displayName ?? null, email: me?.emailAddress ?? null };
  }

  public async listProjects(): Promise<TicketProjectSummary[]> {
    const projects: TicketProjectSummary[] = [];
    if (!this.isJiraCloud()) {
      // Server / Data Center: /project answers every visible project at once
      const all: any[] = await this.runTicketOperation({ operation: "meta" }, (client) =>
        // jira.js dropped getAllProjects (removed from Cloud), but /rest/api/2/project still exists on Server / DC
        retryReadOn5xx(() => client.sendRequest<any[]>({ url: "/rest/api/2/project", method: "GET" }, undefined as never))
      );
      return (all || []).map((project: any) => ({ key: project?.key || "", name: project?.name || "" }));
    }
    for (let startAt = 0; ; ) {
      const page: any = await this.runTicketOperation({ operation: "meta" }, (client) =>
        retryReadOn5xx(() => client.projects.searchProjects({ startAt, maxResults: 50 }))
      );
      const values: any[] = page?.values || [];
      projects.push(...values.map((project: any) => ({ key: project?.key || "", name: project?.name || "" })));
      startAt += values.length;
      if (values.length === 0 || page?.isLast !== false || projects.length >= 1000) {
        break;
      }
    }
    return projects;
  }

  public async getProjectMeta(project: string): Promise<TicketProjectMeta> {
    const types: any[] = await this.runTicketOperation({ operation: "meta" }, (client) =>
      retryReadOn5xx(() => client.projects.getAllStatuses({ projectIdOrKey: project }))
    );
    const statuses = new Map<string, string>();
    const statusesByType: Record<string, string[]> = {};
    for (const type of types || []) {
      const names: string[] = [];
      for (const status of type?.statuses || []) {
        if (!statuses.has(String(status.id))) {
          statuses.set(String(status.id), status.name);
        }
        names.push(status.name);
      }
      statusesByType[type?.name || ""] = names;
    }
    return {
      project,
      issueTypes: (types || []).map((type: any) => ({ id: String(type.id), name: type.name })),
      statuses: [...statuses].map(([id, name]) => ({ id, name })),
      statusesByType,
    };
  }

  /** Matched on the target status only (name, untranslated name or id), never on the transition's own name */
  public async transitionTicket(ticketId: string, status: string): Promise<string> {
    const issueKey = this.normalizeTicketId(ticketId);
    const data: any = await this.runTicketOperation({ operation: "transition", ticketId: issueKey }, (client) =>
      retryReadOn5xx(() => client.issues.getTransitions({ issueIdOrKey: issueKey }))
    );
    const wanted = status.trim().toLowerCase();
    const match = (data?.transitions || []).find(
      (transition: any) =>
        transition?.to &&
        (String(transition.to.id) === status.trim() ||
          [transition.to.name, transition.to.untranslatedName].some((name) => name != null && String(name).toLowerCase() === wanted))
    );
    if (!match) {
      throw new SfError(t("ticketTransitionNotAvailable", { status, ticketId: issueKey }));
    }
    await this.runTicketOperation({ operation: "transition", ticketId: issueKey }, (client) =>
      client.issues.doTransition({ issueIdOrKey: issueKey, transition: { id: String(match.id) } })
    );
    return match.to?.name ?? status;
  }

  public async setTicketPoints(ticketId: string, points: number, options: TicketPointsOptions = {}): Promise<TicketStepResult> {
    const issueKey = this.normalizeTicketId(ticketId);
    const field = options.field || "";
    // Checked by the command before the comment; repeated here because the provider is public
    if (!JiraProvider.POINTS_FIELD_RE.test(field)) {
      throw new SfError(t("ticketPointsFieldRequired"));
    }
    const issue: any = await this.runTicketOperation({ operation: "points", ticketId: issueKey }, (client) =>
      retryReadOn5xx(() => client.issues.getIssue({ issueIdOrKey: issueKey, fields: [field] }))
    );
    const fields = issue?.fields || {};
    // A type whose screen lacks the field does not return it at all
    if (!(field in fields)) {
      return { status: "skipped", value: null, field, reason: "field-not-on-issue" };
    }
    const current = fields[field];
    if (current !== undefined && current !== null && current !== "" && !options.overwrite) {
      return { status: "skipped", value: current, field, reason: "already-set" };
    }
    await this.runTicketOperation({ operation: "points", ticketId: issueKey }, (client) =>
      client.issues.editIssue({ issueIdOrKey: issueKey, fields: { [field]: points } })
    );
    return { status: "done", value: points, field };
  }


  public async postDeploymentComments(tickets: Ticket[], org: string, pullRequestInfo: CommonPullRequestInfo | null): Promise<Ticket[]> {
    const activeClient = await this.getJiraClient();
    if (!activeClient) {
      if (tickets.length > 0) {
        uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderNoUsableCredential')));
      }
      return tickets;
    }
    uxLog("action", this, c.cyan('[JiraProvider] ' + t('jiraProviderPostingComments', { count: tickets.length })));

    const genericHtmlResponseError = "Probably config/access error since response is HTML";
    const commentMarkdown = await buildDeploymentCommentMarkdown(org, pullRequestInfo);
    const tag = await this.getDeploymentTag();
    const commentedTickets: Ticket[] = [];
    const taggedTickets: Ticket[] = [];
    for (const ticket of tickets) {
      // The list holds the tickets of every connector: without this filter a configured JIRA would
      // try to comment on an Azure work item or a ServiceNow record number
      if (ticket.provider === "JIRA" && ticket.foundOnServer) {
        try {
          await this.postComment(ticket.id, commentMarkdown);
          commentedTickets.push(ticket);
        } catch (e6) {
          uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderErrorPostingComment', { ticketId: ticket.id, message: (e6 as any).message })));
        }

        // Add deployment label to JIRA ticket
        try {
          await this.runJiraCall((client) => client.issues.editIssue({
            issueIdOrKey: ticket.id,
            update: {
              labels: [{ add: tag }],
            },
          }));
          taggedTickets.push(ticket);
        } catch (e6) {
          if ((e6 as any).message != null && JiraProvider.containsHtmlLoginPage((e6 as any).message)) {
            (e6 as any).message = genericHtmlResponseError;
          }
          uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderErrorAddingLabel', { tag, ticketId: ticket.id, message: (e6 as any).message })));
        }
      }
    }
    // Summary
    if (commentedTickets.length > 0 || taggedTickets.length > 0) {
      uxLog(
        "log",
        this,
        c.grey('[JiraProvider] ' + t('jiraProviderPostedComments', { count: commentedTickets.length, tickets: commentedTickets.map((ticket) => ticket.id).join(", ") })),
      );
      uxLog(
        "log",
        this,
        c.grey('[JiraProvider] ' + t('jiraProviderAddedLabel', { tag, count: taggedTickets.length, tickets: taggedTickets.map((ticket) => ticket.id).join(", ") })),
      );
    }
    return tickets;
  }

  /**
   * Posts a markdown comment: an Atlassian document on Jira Cloud (REST API v3), wiki markup on
   * Jira Server / Data Center (REST API v2). With a marker, the most recent comment holding it is
   * updated instead, the marker being a visible line since a Jira comment has no hidden text.
   */
  public async postComment(ticketId: string, markdown: string, options: PostCommentOptions = {}): Promise<PostCommentResult> {
    const issueKey = (ticketId || "").trim().toUpperCase();
    const fullMarkdown = markdown + markdownMarkerFooter(options.marker);
    // The mention comes from the assignee read on the ticket by the caller, never from the text
    const body: any = this.isJiraCloud()
      ? withAdfMention(markdownToAdf(fullMarkdown), options.mention)
      : withWikiMention(markdownToJiraWiki(fullMarkdown), options.mention);
    const visibility = options.visibility ? { visibility: { type: options.visibility.type, value: options.visibility.value } } : {};
    const existing = options.marker ? await this.findMarkedComment(issueKey, options.marker) : null;
    // jira.js reads the text from `comment`, except the v3 update which reads `body`: both are given
    const result: any = existing
      ? await this.runJiraCall((client) =>
          client.issueComments.updateComment({ issueIdOrKey: issueKey, id: String(existing.id), comment: body, body, ...visibility } as any)
        )
      : await this.runJiraCall((client) => client.issueComments.addComment({ issueIdOrKey: issueKey, comment: body, ...visibility } as any));
    if (JiraProvider.containsHtmlLoginPage(result) || !result?.id) {
      throw new SfError("Probably config/access error since response is HTML");
    }
    const commentId = String(result.id);
    return {
      ticketId: issueKey,
      provider: JiraProvider.providerLabel,
      action: existing ? "updated" : "created",
      commentId,
      url: `${this.jiraHost}/browse/${issueKey}?focusedCommentId=${commentId}`,
    };
  }

  /** The most recent comment holding the marker, read through the paginated comment list */
  private async findMarkedComment(issueKey: string, marker: string): Promise<any | null> {
    const { comments } = await this.fetchAllComments(issueKey);
    const marked = comments.filter((comment: any) => hasMarker(comment?.body, marker));
    return marked.length > 0 ? marked[marked.length - 1] : null;
  }

  private getPlainTextFromDescription(description: Version3Models.Document | string | null | undefined): string {
    if (!description) {
      return "";
    }
    if (typeof description === "string") {
      return description;
    }
    const segments: string[] = [];
    const visitNode = (node: any) => {
      if (!node) {
        return;
      }
      if (typeof node.text === "string") {
        segments.push(node.text);
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          visitNode(child);
        }
        if (node.type === "paragraph") {
          segments.push("\n");
        }
      }
    };
    visitNode(description);
    return segments.join("").replace(/\n{3,}/g, "\n\n").trim();
  }
}
