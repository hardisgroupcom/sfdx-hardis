import { Version2Client, Version3Client, Version3Models } from "jira.js";
import type { Config } from "jira.js";
import { recordTicketCollectionIssue, TicketProviderRoot } from "./ticketProviderRoot.js";
import c from "chalk";
import sortArray from '../utils/sortArray.js';
import { Ticket } from "./index.js";
import { extractRegexMatches, getCurrentGitBranch, uxLog } from "../utils/index.js";
import { SfError } from "@salesforce/core";
import { CONSTANTS, getConfig, getEnvVar } from "../../config/index.js";
import { CommonPullRequestInfo, GitProvider } from "../gitProvider/index.js";
import { t } from '../utils/i18n.js';
import { httpGet, httpPost } from "../utils/httpUtils.js";
import { WebSocketClient } from "../websocketClient.js";
import {
  TicketDetails,
  TicketDetailsOptions,
  capText,
  classifyAttachment,
  detectManualActions,
  htmlToPlainText,
  newTicketDetails,
  normalizeText,
} from "./ticketDetails.js";

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

export class JiraProvider extends TicketProviderRoot {
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
  public static async getTicketsFromString(text: string, options = {}): Promise<Ticket[]> {
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
    const config = await getConfig("project");
    const jiraBaseUrl = getEnvVar("JIRA_HOST") || config.jiraHost || "https://define.JIRA_HOST.in.cicd.variables/";
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
    let collectedTicketsNumber = 0;
    let failedTicketsNumber = 0;
    let firstErrorMessage = '';
    for (const ticket of tickets) {
      if (ticket.provider === "JIRA") {
        let ticketInfo: any = null;
        let errorCaught = false;
        try {
          ticketInfo = await this.runJiraCall((client) => client.issues.getIssue({ issueIdOrKey: ticket.id }));
        } catch (e) {
          // A single aggregated warning is displayed after the loop: per-ticket failures usually
          // share the same cause (expired token, missing permission) and would flood the log.
          uxLog("log", this, c.grey('[JiraApi] ' + t('jiraApiErrorGettingTicket', { ticketId: ticket.id, message: (e as Error).message })));
          errorCaught = true;
          failedTicketsNumber++;
          firstErrorMessage = firstErrorMessage || (e as Error).message;
        }
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
        collectedTicketsNumber++;
        if (showProgress) {
          WebSocketClient.sendProgressStepMessage(collectedTicketsNumber, jiraTicketsNumber);
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
  public static matchesTicketId(ticketId: string): boolean {
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
    details.reporter = fields.reporter?.displayName || "";
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

    const { comments, truncated } = await this.fetchAllComments(details.id);
    details.commentsTruncated = truncated;
    details.comments = comments.map((comment: any) => ({
      author: comment?.author?.displayName || "",
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
    // Jira's ADF / wiki markup builders below consume { label, url } objects.
    // TODO(commonmark-jira): replace the bespoke ADF / wiki markup builders with a
    // CommonMark -> Jira converter so this provider can join the central pipeline.
    const orgLabel = org.replace("https://", "").replace(".my.salesforce.com", "");
    const orgMarkdown = { label: orgLabel, url: org };
    const branchName = (await getCurrentGitBranch()) || "";
    const branchUrl = (await GitProvider.getCurrentBranchUrl()) || "";
    const branchMarkdown = { label: branchName, url: branchUrl };
    const tag = await this.getDeploymentTag();
    const commentedTickets: Ticket[] = [];
    const taggedTickets: Ticket[] = [];
    for (const ticket of tickets) {
      if (ticket.foundOnServer) {
        // Build comment
        let prTitle = "";
        let prUrl = "";
        let prAuthor = "";
        if (pullRequestInfo) {
          prUrl = pullRequestInfo.webUrl;
          if (prUrl) {
            prTitle = pullRequestInfo.title;
            prAuthor = pullRequestInfo?.authorName;
          }
        }
        // Use ADF format for Jira Cloud, plain text for Jira Server/DC
        const jiraComment: any = this.isJiraCloud()
          ? this.getJiraDeploymentCommentAdf(
            orgMarkdown.label,
            orgMarkdown.url,
            branchMarkdown.label,
            branchMarkdown.url || "",
            prTitle,
            prUrl,
            prAuthor,
          )
          : this.getJiraDeploymentCommentText(
            orgMarkdown.label,
            orgMarkdown.url,
            branchMarkdown.label,
            branchMarkdown.url || "",
            prTitle,
            prUrl,
            prAuthor,
          );
        // Post comment
        try {
          const commentPostRes = await this.runJiraCall((client) => client.issueComments.addComment({ issueIdOrKey: ticket.id, comment: jiraComment }));
          if (JiraProvider.containsHtmlLoginPage(commentPostRes)) {
            throw new SfError(genericHtmlResponseError);
          }
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

  getJiraDeploymentCommentAdf(
    orgName: string,
    orgUrl: string,
    branchName: string,
    branchUrl: string,
    prTitle: string,
    prUrl: string,
    prAuthor: string,
  ): Version3Models.Document {
    const comment: Version3Models.Document = {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Deployed by ",
            },
            {
              type: "text",
              text: "sfdx-hardis",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "${CONSTANTS.DOC_URL_ROOT}/",
                  },
                },
              ],
            },
            {
              type: "text",
              text: " in ",
            },
            {
              type: "text",
              text: orgName,
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: orgUrl,
                  },
                },
                {
                  type: "strong",
                },
              ],
            },
            {
              type: "text",
              text: " from branch ",
            },
            {
              type: "text",
              text: branchName,
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: branchUrl,
                  },
                },
                {
                  type: "strong",
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Related PR: ",
            },
            {
              type: "text",
              text: prTitle,
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: prUrl,
                  },
                },
              ],
            },
            {
              type: "text",
              text: `, by ${prAuthor}`,
            },
          ],
        },
      ],
    };
    return comment;
  }

  /**
   * Builds a plain-text deployment comment for Jira Server / Data Center (REST API v2).
   */
  getJiraDeploymentCommentText(
    orgName: string,
    orgUrl: string,
    branchName: string,
    branchUrl: string,
    prTitle: string,
    prUrl: string,
    prAuthor: string,
  ): string {
    let text = `Deployed by [sfdx-hardis|${CONSTANTS.DOC_URL_ROOT}/] in [${orgName}|${orgUrl}] from branch [${branchName}|${branchUrl}]`;
    if (prTitle && prUrl) {
      text += `\nRelated PR: [${prTitle}|${prUrl}]`;
      if (prAuthor) {
        text += `, by ${prAuthor}`;
      }
    }
    return text;
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
