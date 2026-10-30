/* jscpd:ignore-start */
import * as azdev from "azure-devops-node-api";
import { TicketProviderRoot } from "./ticketProviderRoot.js";
import c from "chalk";
import sortArray from '../utils/sortArray.js';
// Type-only: a value import here would close a runtime cycle index -> provider -> index
import type { Ticket, TicketsFromStringOptions } from "./index.js";
import { convertMarkdownToHtml } from "../notifProvider/utils/markdownToHtml.js";
import { PostCommentOptions, PostCommentResult, buildDeploymentCommentMarkdown, hasMarker, htmlMarker } from "./utils/ticketComment.js";
import { extractRegexMatches, git, isGitRepo, uxLog } from "../utils/index.js";
import { PROVIDER_BATCH_PROFILES, mapInAdaptiveBatchesSettled } from '../utils/adaptiveBatch.js';
import { AzureDevopsProvider } from "../gitProvider/azureDevops.js";
import { SfError } from "@salesforce/core";
import { getConfig, getEnvVar } from "../../config/index.js";
import { GitCommitRef } from "azure-devops-node-api/interfaces/GitInterfaces.js";
import { JsonPatchDocument } from "azure-devops-node-api/interfaces/common/VSSInterfaces.js";
import { CommonPullRequestInfo } from "../gitProvider/index.js";
import { WebSocketClient } from "../websocketClient.js";
import { t } from '../utils/i18n.js';
import { WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";
import {
  TicketDetails,
  TicketDetailsOptions,
  capText,
  classifyAttachment,
  detectManualActions,
  htmlToPlainText,
  newTicketDetails,
} from "./utils/ticketDetails.js";
import {
  TICKET_ERROR,
  TicketErrorContext,
  TicketOperation,
  TicketSearchOptions,
  TicketSearchResult,
  TicketSummary,
  httpStatusOf,
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
  scopeWiql,
  splitTags,
  withHtmlHeadingSpacers,
  withHtmlMention,
} from "./utils/ticketQualify.js";
/* jscpd:ignore-end */

export class AzureBoardsProvider extends TicketProviderRoot {
  public static readonly providerKey = "azure" as const;
  public static readonly providerLabel = "Azure Boards";
  public static readonly supportsTicketDetails = true;
  public static readonly supportsComments = true;

  protected serverUrl: string | null;
  protected azureApi: InstanceType<typeof azdev.WebApi>;
  protected teamProject: string | null;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: any) {
    super();
    // Azure server url must be provided in SYSTEM_COLLECTIONURI. ex: https:/dev.azure.com/mycompany
    this.serverUrl = getEnvVar("SYSTEM_COLLECTIONURI");
    // a Personal Access Token must be defined. AZURE_DEVOPS_EXT_PAT comes last: it is the variable
    // the Azure CLI uses, so a developer machine usually already has it.
    this.token = getEnvVar("CI_SFDX_HARDIS_AZURE_TOKEN") || getEnvVar("SYSTEM_ACCESSTOKEN") || getEnvVar("AZURE_DEVOPS_EXT_PAT");
    this.teamProject = getEnvVar("SYSTEM_TEAMPROJECT");
    if (this.serverUrl && this.token && this.teamProject) {
      this.isActive = true;
    }
    if (this.isActive) {
      const authHandler = azdev.getHandlerFromToken(this.token || "");
      this.azureApi = new azdev.WebApi(this.serverUrl || "", authHandler);
    }
  }

  /**
   * Fills SYSTEM_COLLECTIONURI and SYSTEM_TEAMPROJECT from the git remote of the current repository.
   *
   * On a CI agent Azure Pipelines sets both for free, but a developer running the command locally
   * would otherwise have to declare the organization and the project by hand - while the clone they
   * are standing in already names both. So only the token really has to be configured; the rest is
   * read from `origin`. Values already set (a CI agent, or an explicit override) always win.
   *
   * Sets process.env rather than returning, so the synchronous isAvailable() sees the result. This
   * is the same approach AzureDevopsProvider uses for the git side, and the detection itself is
   * delegated to it: it reads the raw remote, so SSH clones are handled too.
   *
   * Never throws: a git failure here must end as the regular "provider not configured" error of the
   * caller, not as a stack trace.
   */
  public static async autoDetectFromGitRemote(): Promise<void> {
    if (getEnvVar("SYSTEM_COLLECTIONURI") && getEnvVar("SYSTEM_TEAMPROJECT")) {
      return;
    }
    if (!isGitRepo()) {
      return;
    }
    try {
      await AzureDevopsProvider.autoDetectSettings();
      // autoDetectSettings only parses the remote when SYSTEM_COLLECTIONURI is unset, so a developer
      // who declared the organization but not the project still has to get the project filled here
      if (getEnvVar("SYSTEM_COLLECTIONURI") && !getEnvVar("SYSTEM_TEAMPROJECT")) {
        const remoteUrl = (await git().getConfig("remote.origin.url"))?.value || "";
        const parsed = remoteUrl ? AzureDevopsProvider.parseAzureRepoUrl(remoteUrl) : null;
        if (parsed) {
          process.env.SYSTEM_TEAMPROJECT = parsed.teamProject;
        }
      }
      // Both set while at least one was missing on entry: the remote did answer
      if (getEnvVar("SYSTEM_COLLECTIONURI") && getEnvVar("SYSTEM_TEAMPROJECT")) {
        uxLog("log", AzureBoardsProvider, c.grey('[AzureBoardsProvider] ' + t('azureBoardsAutoDetectedFromRemote', {
          collectionUri: process.env.SYSTEM_COLLECTIONURI || "",
          teamProject: process.env.SYSTEM_TEAMPROJECT || "",
        })));
      }
    } catch (e) {
      uxLog("warning", AzureBoardsProvider, c.yellow('[AzureBoardsProvider] ' + t('autoDetectProviderFailed', {
        provider: "Azure Boards",
        message: (e as Error).message,
      })));
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public static isAvailable(_config: any): boolean {
    if (
      // Basic auth
      getEnvVar("SYSTEM_COLLECTIONURI") &&
      (getEnvVar("SYSTEM_ACCESSTOKEN") || getEnvVar("CI_SFDX_HARDIS_AZURE_TOKEN") || getEnvVar("AZURE_DEVOPS_EXT_PAT")) &&
      getEnvVar("SYSTEM_TEAMPROJECT")
    ) {
      return true;
    }
    return false;
  }

  public getLabel(): string {
    return "sfdx-hardis Azure Boards connector";
  }

  public static async getTicketsFromString(text: string, options: TicketsFromStringOptions = {}): Promise<Ticket[]> {
    const prInfo = options.pullRequestInfo || null;
    const tickets: Ticket[] = [];
    // Extract Azure Boards Work Items
    const azureBoardsUrlRegex = /(https:\/\/.*\/_workitems\/edit\/[0-9]+)/g;
    const azureBoardUrlsMatches = await extractRegexMatches(azureBoardsUrlRegex, text);
    for (const azureTicketUrl of azureBoardUrlsMatches) {
      const pattern = /https:\/\/.*\/_workitems\/edit\/([0-9]+)/;
      const match = azureTicketUrl.match(pattern);
      if (match) {
        if (!tickets.some((ticket) => ticket.url === azureTicketUrl)) {
          tickets.push({
            provider: "AZURE",
            url: azureTicketUrl,
            id: match[1],
          });
        }
      }
    }
    const config = options.config || (await getConfig("project"));
    if (!this.isAvailable(config)) {
      return sortArray(tickets, { by: ["id"], order: ["asc"] }) as Ticket[];
    }
    // Get tickets from Azure commits.
    // BUILD_REPOSITORY_ID only exists on an Azure Pipelines agent: Azure Boards is also used with
    // GitHub or GitLab repositories, and asking the Azure git API for the commits of an empty
    // repository id would fail on every one of them. The work items linked to the Pull Request
    // itself are collected below, and do not need the git API.
    const repositoryId = getEnvVar("BUILD_REPOSITORY_ID") || "";
    if (prInfo?.providerInfo?.commits && repositoryId) {
      // Never lets a failure here escape: the caller turns any throw into "unable to compute git
      // summary" and drops the whole Pull Request comment, work items and commits alike
      try {
        const azureBoardsProvider = new AzureBoardsProvider(config);
        const azureApi = azureBoardsProvider.azureApi;
        const azureGitApi = await azureApi.getGitApi();
        const commitIds = prInfo?.providerInfo?.commits.filter((commit) => commit.hash).map((commit) => commit.hash);
        const azureCommits: GitCommitRef[] = [];
        for (const commitId of commitIds) {
          const commitRefs = await azureGitApi.getCommits(repositoryId, { fromCommitId: commitId, toCommitId: commitId, includeWorkItems: true });
          azureCommits.push(...commitRefs);
        }
        for (const commit of azureCommits) {
          for (const workItem of commit?.workItems || []) {
            if (!tickets.some((ticket) => ticket.id === workItem.id)) {
              tickets.push({
                provider: "AZURE",
                url: workItem.url || "",
                id: workItem.id || "",
              });
            }
          }
        }
      } catch (e) {
        uxLog("warning", AzureBoardsProvider, c.yellow('[AzureBoardsProvider] ' + t('azureBoardsCommitWorkItemsError', {
          message: (e as Error).message,
        })));
      }
    }

    // Get tickets from Azure PR
    if (prInfo?.providerInfo?.workItemRefs?.length) {
      for (const workItemRef of prInfo.providerInfo.workItemRefs) {
        if (!tickets.some((ticket) => ticket.id === workItemRef.id)) {
          tickets.push({
            provider: "AZURE",
            url: workItemRef.url,
            id: workItemRef.id,
          });
        }
      }
    }

    return sortArray(tickets, { by: ["id"], order: ["asc"] }) as Ticket[];
  }

  // Call Azure Work Items apis to gather more information from the ticket identifiers
  public async collectTicketsInfo(tickets: Ticket[]) {
    const azureTicketsNumber = tickets.filter((ticket) => ticket.provider === "AZURE").length;
    if (azureTicketsNumber > 0) {
      uxLog(
        "action",
        this,
        c.cyan('[AzureBoardsProvider]' + 
          t('azureBoardsProviderCollectingTickets', { azureTicketsNumber, serverUrl: process.env.SYSTEM_COLLECTIONURI || "" }),
        ),
      );
    }
    const azureWorkItemApi = await this.azureApi.getWorkItemTrackingApi(this.serverUrl || "");
    // One HTTP call per work item: show a progress bar instead of flooding the log with one line each
    const showProgress = azureTicketsNumber > 1;
    if (showProgress) {
      WebSocketClient.sendProgressStartMessage(t('collectingTicketsInfo', { count: azureTicketsNumber }), azureTicketsNumber);
    }
    // try/finally so the progress bar never stays stuck in the VS Code UI when a fetch throws
    try {
      // One HTTP call per work item, in the adaptive batches of the Azure DevOps ladder, shrunk only
      // when Azure throttles. One failing work item (deleted id, expired PAT...) must not lose the others.
      const azureTickets = tickets.filter((ticket) => ticket.provider === "AZURE");
      const errorById = new Map<string, string>();
      const infos = await mapInAdaptiveBatchesSettled(azureTickets, (ticket) => azureWorkItemApi.getWorkItem(Number(ticket.id)), {
        sizes: PROVIDER_BATCH_PROFILES.azure,
        onBackoff: (size, e, waitMs) => uxLog("log", this, c.grey('[AzureBoardsProvider] ' + t('providerThrottledBackoff', { count: size, waitSeconds: Math.round(waitMs / 1000), message: (e as Error)?.message || '' }))),
        onError: (e, ticket) => errorById.set(ticket.id, (e as Error).message),
        onProgress: (done, total) => {
          if (showProgress) {
            WebSocketClient.sendProgressStepMessage(done, total);
          }
        },
      });
      const infoById = new Map(azureTickets.map((ticket, index) => [ticket.id, infos[index] ?? null]));
      for (const ticket of tickets) {
        if (ticket.provider === "AZURE") {
          const ticketInfo: any = infoById.get(ticket.id) ?? { error: errorById.get(ticket.id) || 'no work item returned' };
          if (ticketInfo && ticketInfo?.fields) {
            ticket.foundOnServer = true;
            ticket.subject = ticketInfo.fields["System.Title"] || "";
            ticket.status = ticketInfo.fields["System.State"] || "";
            ticket.statusLabel = ticketInfo.fields["System.State"] || "";
            if (ticketInfo?._links && ticketInfo._links["html"] && ticketInfo._links["html"]["href"]) {
              ticket.url = ticketInfo?._links["html"]["href"];
            }
            // "other" keeps this per-ticket line out of the VS Code UI, where the progress bar shows instead
            uxLog("other", this, c.grey('[AzureBoardsProvider] ' + t('azureBoardsProviderCollectedWorkItem', { ticketId: ticket.id })));
          } else {
            uxLog("warning", this, c.yellow('[AzureBoardsProvider] ' + t('azureBoardsProviderUnableToGetWorkItem', { ticketId: ticket.id, ticketInfo: JSON.stringify(ticketInfo) })));
          }
        }
      }
    } finally {
      if (showProgress) {
        WebSocketClient.sendProgressEndMessage(azureTicketsNumber);
      }
    }
    return tickets;
  }

  /** True when the identifier is a work item id, bare or in the AB-1234 form used by the skills */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public static matchesTicketId(ticketId: string, _config: any = {}): boolean {
    return /^(AB-)?[0-9]{1,10}$/i.test((ticketId || "").trim());
  }

  /** Accepts 1234, AB-1234, or a _workitems/edit/1234 URL */
  private static workItemIdOf(ticketId: string): number | null {
    const trimmed = (ticketId || "").trim();
    const match = trimmed.match(/(?:_workitems\/edit\/|^AB-|^)([0-9]{1,10})$/i);
    return match ? Number(match[1]) : null;
  }

  /** Azure identities come back either as an object or as a "Display Name <mail>" string */
  private static identityName(identity: any): string {
    if (!identity) {
      return "";
    }
    if (typeof identity === "string") {
      return identity.replace(/\s*<[^>]*>$/, "");
    }
    return identity.displayName || identity.uniqueName || "";
  }

  /** Identity id (a GUID): what a mention and the marker check compare. Null for the "Name <mail>" string form */
  private static identityId(identity: any): string | null {
    return identity && typeof identity === "object" ? identity.id ?? null : null;
  }

  public async getTicketDetails(ticketId: string, options: TicketDetailsOptions = {}): Promise<TicketDetails | null> {
    if (!this.isActive) {
      uxLog("warning", this, c.yellow('[AzureBoardsProvider] ' + t('azureBoardsProviderNotConfigured')));
      return null;
    }
    const workItemId = AzureBoardsProvider.workItemIdOf(ticketId);
    if (workItemId === null) {
      return null;
    }
    const azureWorkItemApi = await this.azureApi.getWorkItemTrackingApi(this.serverUrl || "");
    // Relations carry both the linked work items and the attached files
    const workItem: any = await retryReadOn5xx(() => azureWorkItemApi.getWorkItem(workItemId, undefined, undefined, WorkItemExpand.All));
    if (!workItem?.fields) {
      return null;
    }
    const fields = workItem.fields;
    const details = newTicketDetails("AZURE", `AB-${workItemId}`);
    details.url = workItem?._links?.html?.href || `${this.serverUrl}/${this.teamProject}/_workitems/edit/${workItemId}`;
    details.subject = fields["System.Title"] || "";
    details.type = fields["System.WorkItemType"] || "";
    details.status = fields["System.State"] || "";
    details.priority = String(fields["Microsoft.VSTS.Common.Priority"] ?? "");
    details.assignee = AzureBoardsProvider.identityName(fields["System.AssignedTo"]);
    details.assigneeId = AzureBoardsProvider.identityId(fields["System.AssignedTo"]);
    details.reporter = AzureBoardsProvider.identityName(fields["System.CreatedBy"]);
    details.reporterId = AzureBoardsProvider.identityId(fields["System.CreatedBy"]);
    // The work item's own project: the one of the repository often only holds the code
    details.project = fields["System.TeamProject"] || this.teamProject || "";
    details.created = fields["System.CreatedDate"] || "";
    details.updated = fields["System.ChangedDate"] || "";
    details.storyPoints = String(fields["Microsoft.VSTS.Scheduling.StoryPoints"] ?? "");
    details.sprint = fields["System.IterationPath"] || "";
    details.labels = String(fields["System.Tags"] || "").split(";").map((tag) => tag.trim()).filter(Boolean);
    details.description = capText(htmlToPlainText(fields["System.Description"]));
    details.acceptanceCriteria = capText(htmlToPlainText(fields["Microsoft.VSTS.Common.AcceptanceCriteria"]));
    details.extra.areaPath = fields["System.AreaPath"] || "";
    details.extra.reason = fields["System.Reason"] || "";
    details.extra.project = details.project;

    try {
      const commentList: any = options.skipComments
        ? { comments: [] }
        : await retryReadOn5xx(() => azureWorkItemApi.getComments(details.project, workItemId, AzureBoardsProvider.COMMENTS_TOP));
      details.comments = (commentList?.comments || []).map((comment: any) => ({
        author: AzureBoardsProvider.identityName(comment?.createdBy),
        authorId: AzureBoardsProvider.identityId(comment?.createdBy),
        date: comment?.createdDate ? String(comment.createdDate) : "",
        body: capText(htmlToPlainText(comment?.text)),
      }));
    } catch (e: any) {
      uxLog("warning", this, c.yellow('[AzureBoardsProvider] ' + t('azureBoardsProviderCommentsError', { ticketId: String(workItemId), message: e.message })));
    }

    for (const relation of workItem?.relations || []) {
      const relationType = relation?.rel || "";
      if (relationType === "AttachedFile") {
        const attributes = relation?.attributes || {};
        const filename = attributes.name || "attachment";
        details.attachments.push({
          filename,
          contentType: "",
          size: Number(attributes.resourceSize || 0),
          created: attributes.resourceCreatedDate ? String(attributes.resourceCreatedDate) : "",
          author: "",
          url: relation?.url || "",
          kind: classifyAttachment("", filename),
          localPath: null,
          textContent: null,
          truncated: false,
          error: null,
        });
        continue;
      }
      // Hierarchy / related / duplicate links all point at another work item
      const linkedId = String(relation?.url || "").match(/workItems\/([0-9]+)$/)?.[1];
      if (!linkedId) {
        continue;
      }
      const item = {
        relation: relationType.replace("System.LinkTypes.", "").replace("Microsoft.VSTS.Common.", ""),
        id: `AB-${linkedId}`,
        title: relation?.attributes?.name || "",
        status: "",
        url: `${this.serverUrl}/${this.teamProject}/_workitems/edit/${linkedId}`,
      };
      if (relationType === "System.LinkTypes.Hierarchy-Forward") {
        details.subtasks.push({ ...item, relation: "child" });
      } else {
        if (relationType === "System.LinkTypes.Hierarchy-Reverse") {
          item.relation = "parent";
          details.parent = item.id;
        }
        details.links.push(item);
      }
    }

    await this.downloadDetailsAttachments(details, this.serverUrl || "", this.attachmentHeaders(), options);

    details.manualActions = detectManualActions([
      details.description,
      details.acceptanceCriteria,
      ...details.comments.map((comment) => comment.body),
      ...details.attachments.map((attachment) => attachment.textContent),
    ]);
    return details;
  }

  /** Azure PATs authenticate as Basic with an empty user name */
  private attachmentHeaders(): Record<string, string> {
    return { Authorization: "Basic " + Buffer.from(`:${this.token || ""}`).toString("base64") };
  }

  // ---------------------------------------------------------------------------------------------
  // Operations of the ticket list / label / whoami / meta commands and of the post-comment steps
  // ---------------------------------------------------------------------------------------------

  private static readonly COMMENTS_TOP = 200;
  private static readonly SEARCH_FIELDS = [
    "System.Id", "System.Title", "System.State", "System.WorkItemType", "System.Tags", "System.CreatedDate",
    "System.ChangedDate", "System.TeamProject", "System.AreaPath", "System.AssignedTo", "Microsoft.VSTS.Common.Priority",
  ];
  // Agile / CMMI use StoryPoints, Scrum uses Effort, Basic uses Size... in that order
  private static readonly POINT_FIELDS = ["Microsoft.VSTS.Scheduling.StoryPoints", "Microsoft.VSTS.Scheduling.Effort", "Microsoft.VSTS.Scheduling.Size"];

  /**
   * Runs one call: fails with a named error when no credential is configured, converts HTTP failures
   * into the named errors of the contract, and never lets an HTML sign-in page reach a message.
   */
  private async runOperation<T>(context: Omit<TicketErrorContext, "providerLabel">, call: () => Promise<T>): Promise<T> {
    if (!this.isActive) {
      throw new SfError(t("ticketProviderNoCredential", { provider: AzureBoardsProvider.providerLabel }), TICKET_ERROR.providerNotConfigured);
    }
    try {
      return await call();
    } catch (e: any) {
      // A refused credential gets a sign-in page (HTTP 203 or a redirect), not a 401
      if (/<\s*(!doctype|html)/i.test(String(e?.message || "")) || httpStatusOf(e) === 203) {
        throw new SfError(
          t("ticketProviderCredentialsRefused", { provider: AzureBoardsProvider.providerLabel, message: "sign-in page" }),
          TICKET_ERROR.providerNotConfigured
        );
      }
      throw toTicketError(e, { providerLabel: AzureBoardsProvider.providerLabel, ...context });
    }
  }

  private async witApi() {
    return this.azureApi.getWorkItemTrackingApi(this.serverUrl || "");
  }

  public normalizeTicketId(ticketId: string): string {
    const workItemId = AzureBoardsProvider.workItemIdOf(ticketId);
    return workItemId === null ? (ticketId || "").trim() : `AB-${workItemId}`;
  }

  /** The work item id, or a named error: a JIRA key or a typo must not reach the API as NaN */
  private requireWorkItemId(ticketId: string): number {
    const workItemId = AzureBoardsProvider.workItemIdOf(ticketId);
    if (workItemId === null) {
      throw new SfError(t("ticketDetailsUnknownIdShape", { ticketId }), TICKET_ERROR.notFound);
    }
    return workItemId;
  }

  private async getWorkItemFields(workItemId: number, operation: TicketOperation): Promise<any> {
    const api = await this.witApi();
    const workItem: any = await this.runOperation({ operation, ticketId: String(workItemId) }, () =>
      retryReadOn5xx(() => api.getWorkItem(workItemId))
    );
    if (!workItem?.fields) {
      throw new SfError(t("ticketNotFound", { ticketId: String(workItemId) }), TICKET_ERROR.notFound);
    }
    return workItem;
  }

  /** Patch guarded by the revision read just before: a concurrent edit fails instead of being overwritten */
  private async patchWorkItem(workItem: any, path: string, value: any, operation: TicketOperation): Promise<void> {
    const api = await this.witApi();
    const patch: JsonPatchDocument = [
      { op: "test", path: "/rev", value: workItem.rev },
      { op: "add", path, value },
    ];
    await this.runOperation({ operation, ticketId: String(workItem.id) }, () => api.updateWorkItem({}, patch, Number(workItem.id)));
  }

  private toTicketSummary(workItem: any): TicketSummary {
    const fields = workItem?.fields || {};
    const project = fields["System.TeamProject"] || "";
    return {
      id: `AB-${workItem.id}`,
      url: `${this.serverUrl}/${encodeURIComponent(project)}/_workitems/edit/${workItem.id}`,
      subject: fields["System.Title"] || "",
      type: fields["System.WorkItemType"] || "",
      status: fields["System.State"] || "",
      priority: String(fields["Microsoft.VSTS.Common.Priority"] ?? ""),
      assignee: AzureBoardsProvider.identityName(fields["System.AssignedTo"]) || null,
      created: fields["System.CreatedDate"] ? new Date(fields["System.CreatedDate"]).toISOString() : "",
      updated: fields["System.ChangedDate"] ? new Date(fields["System.ChangedDate"]).toISOString() : "",
      labels: splitTags(fields["System.Tags"]),
      assigneeId: AzureBoardsProvider.identityId(fields["System.AssignedTo"]),
      project,
      areaPath: fields["System.AreaPath"] || null,
    };
  }

  /**
   * The query is a WIQL condition, wrapped in a statement bounded to the allowed projects (or, without
   * --allowed-projects, to the configured team project). WIQL has no cursor: one page of maxResults.
   */
  public async searchTickets(query: string, options: TicketSearchOptions): Promise<TicketSearchResult> {
    const projects = options.allowedProjects || [this.teamProject || ""];
    const wiql = scopeWiql(projects, query);
    const api = await this.witApi();
    const queryResult: any = await this.runOperation({ operation: "list" }, () =>
      retryReadOn5xx(() => api.queryByWiql({ query: wiql }, { project: projects[0] } as any, undefined, options.maxResults))
    );
    const ids: number[] = (queryResult?.workItems || []).map((item: any) => item.id).slice(0, options.maxResults);
    let tickets: TicketSummary[] = [];
    if (ids.length > 0) {
      const items: any[] = await this.runOperation({ operation: "list" }, () =>
        retryReadOn5xx(() => api.getWorkItemsBatch({ ids, fields: AzureBoardsProvider.SEARCH_FIELDS } as any))
      );
      const byId = new Map((items || []).map((item: any) => [item.id, item]));
      tickets = ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((item) => this.toTicketSummary(item))
        .filter((ticket) => isProjectAllowed(ticket.project, projects));
    }
    const warning = tickets.length === 0 ? t("ticketListNoResult", { scope: projects.join(", ") }) : null;
    return { tickets, nextPageToken: null, truncated: false, warning };
  }

  /** Adds one tag, keeps the others; Azure tags are case-insensitive */
  public async addTicketLabel(ticketId: string, label: string): Promise<void> {
    const workItem = await this.getWorkItemFields(this.requireWorkItemId(ticketId), "label");
    const tags = splitTags(workItem.fields["System.Tags"]);
    if (tags.some((tag) => tag.toLowerCase() === label.toLowerCase())) {
      return;
    }
    await this.patchWorkItem(workItem, "/fields/System.Tags", [...tags, label].join("; "), "label");
  }

  public async whoAmI(): Promise<TicketIdentity> {
    const connection: any = await this.runOperation({ operation: "whoami" }, () => retryReadOn5xx(() => this.azureApi.connect()));
    const user = connection?.authenticatedUser || {};
    return {
      id: user.id ?? null,
      displayName: user.providerDisplayName ?? user.customDisplayName ?? null,
      email: user.properties?.Account?.$value ?? null,
    };
  }

  public async listProjects(): Promise<TicketProjectSummary[]> {
    const coreApi = await this.azureApi.getCoreApi(this.serverUrl || "");
    const projects: any[] = await this.runOperation({ operation: "meta" }, () => retryReadOn5xx(() => coreApi.getProjects(undefined, 200)));
    return (projects || []).map((project: any) => ({ key: project?.name || "", name: project?.name || "" }));
  }

  private async statesOf(project: string, type: string): Promise<string[]> {
    const api = await this.witApi();
    const states: any[] = await this.runOperation({ operation: "meta" }, () =>
      retryReadOn5xx(() => api.getWorkItemTypeStates(project, type))
    );
    return (states || []).map((state: any) => state.name);
  }

  public async getProjectMeta(project: string): Promise<TicketProjectMeta> {
    const api = await this.witApi();
    const allTypes: any[] = await this.runOperation({ operation: "meta" }, () => retryReadOn5xx(() => api.getWorkItemTypes(project)));
    const types = (allTypes || []).filter((type: any) => !type.isDisabled);
    const statusesByType: Record<string, string[]> = {};
    const statuses = new Set<string>();
    for (const type of types) {
      const names = (type.states || []).map((state: any) => state.name);
      statusesByType[type.name] = names.length ? names : await this.statesOf(project, type.name);
      statusesByType[type.name].forEach((name) => statuses.add(name));
    }
    return {
      project,
      issueTypes: types.map((type: any) => ({ id: type.name, name: type.name })),
      statuses: [...statuses].map((name) => ({ id: name, name })),
      statusesByType,
    };
  }

  /** The states of the work item's type, matched without case */
  public async transitionTicket(ticketId: string, status: string): Promise<string> {
    const workItem = await this.getWorkItemFields(this.requireWorkItemId(ticketId), "transition");
    const project = workItem.fields["System.TeamProject"];
    const type = workItem.fields["System.WorkItemType"];
    const match = (await this.statesOf(project, type)).find((state) => state.toLowerCase() === status.trim().toLowerCase());
    if (!match) {
      throw new SfError(t("ticketStateNotAvailable", { status, type }), TICKET_ERROR.transitionInvalid);
    }
    await this.patchWorkItem(workItem, "/fields/System.State", match, "transition");
    return match;
  }

  public async setTicketPoints(ticketId: string, points: number, options: TicketPointsOptions = {}): Promise<TicketStepResult> {
    const workItem = await this.getWorkItemFields(this.requireWorkItemId(ticketId), "points");
    const project = workItem.fields["System.TeamProject"];
    const type = workItem.fields["System.WorkItemType"];
    const api = await this.witApi();
    const typeFields: any[] = await this.runOperation({ operation: "points", ticketId: String(workItem.id) }, () =>
      retryReadOn5xx(() => api.getWorkItemTypeFieldsWithReferences(project, type))
    );
    const available = new Set((typeFields || []).map((field: any) => field.referenceName));
    const wanted = options.field ? [options.field] : AzureBoardsProvider.POINT_FIELDS;
    const field = wanted.find((candidate) => available.has(candidate));
    if (!field) {
      return { status: "skipped", value: null, field: null, reason: "type-has-no-points-field" };
    }
    const current = workItem.fields[field];
    if (current !== undefined && current !== null && current !== "" && !options.overwrite) {
      return { status: "skipped", value: current, field, reason: "already-set" };
    }
    await this.patchWorkItem(workItem, `/fields/${field}`, points, "points");
    return { status: "done", value: points, field };
  }


  public async postDeploymentComments(tickets: Ticket[], org: string, pullRequestInfo: CommonPullRequestInfo | null): Promise<Ticket[]> {
    uxLog("action", this, c.cyan('[AzureBoardsProvider] ' + t('azureBoardsProviderPostingComments', { count: tickets.length })));
    const commentMarkdown = await buildDeploymentCommentMarkdown(org, pullRequestInfo);
    const tag = await this.getDeploymentTag();
    const commentedTickets: Ticket[] = [];
    const taggedTickets: Ticket[] = [];
    const azureWorkItemApi = await this.azureApi.getWorkItemTrackingApi(this.serverUrl || "");
    for (const ticket of tickets) {
      // The list holds the tickets of every connector: without this filter a configured Azure
      // Boards would call getWorkItem(NaN) on a JIRA key or a ServiceNow record number
      if (ticket.provider === "AZURE" && ticket.foundOnServer) {
        // Post comment
        try {
          await this.postComment(ticket.id, commentMarkdown);
          commentedTickets.push(ticket);
        } catch (e6) {
          uxLog("warning", this, c.yellow('[AzureBoardsProvider] ' + t('azureBoardsProviderErrorPostingComment', { ticketId: ticket.id, message: (e6 as any).message })));
        }

        // Add tag
        try {
          const patchDocument: JsonPatchDocument = [
            {
              op: "add",
              path: "/fields/System.Tags",
              value: tag,
            },
          ];
          const workItem = await azureWorkItemApi.updateWorkItem({}, patchDocument, Number(ticket.id), this.teamProject || "");
          if (workItem?.id && workItem?.id > 0) {
            taggedTickets.push(ticket);
          } else {
            throw new SfError("tag workItem: " + workItem);
          }
        } catch (e6) {
          uxLog("warning", this, c.yellow('[AzureBoardsProvider] ' + t('azureBoardsProviderErrorAddingTag', { tag, ticketId: ticket.id, message: (e6 as any).message })));
        }
      }
    }
    uxLog(
      "log",
      this,
      c.grey('[AzureBoardsProvider]' + 
        t('azureBoardsProviderPostedComments', { count: commentedTickets.length, tickets: commentedTickets.map((ticket) => ticket.id).join(", ") }),
      ),
    );
    uxLog(
      "log",
      this,
      c.grey('[AzureBoardsProvider]' + 
        t('azureBoardsProviderAddedTag', { tag, count: taggedTickets.length, tickets: taggedTickets.map((ticket) => ticket.id).join(", ") }),
      ),
    );
    return tickets;
  }
  /**
   * Posts a markdown comment, written as HTML. With a marker, hidden in an HTML comment, the most
   * recent comment holding it is updated instead.
   */
  public async postComment(ticketId: string, markdown: string, options: PostCommentOptions = {}): Promise<PostCommentResult> {
    const workItemId = AzureBoardsProvider.workItemIdOf(ticketId);
    if (!workItemId) {
      throw new SfError(t('ticketDetailsUnknownIdShape', { ticketId }));
    }
    if (options.visibility) {
      throw new SfError(t('ticketVisibilityJiraOnly'));
    }
    // The mention comes from the assignee read on the work item by the caller, never from the text
    const converted = await convertMarkdownToHtml(markdown);
    const html = withHtmlMention(options.strictMarkdown ? withHtmlHeadingSpacers(converted) : converted, options.mention) + htmlMarker(options.marker);
    const azureWorkItemApi = await this.azureApi.getWorkItemTrackingApi(this.serverUrl || "");
    // The work item's own project: commenting through the project of the repository fails when they differ
    const workItemProject: any = await retryReadOn5xx(() => azureWorkItemApi.getWorkItem(workItemId, ["System.TeamProject"]));
    const project = workItemProject?.fields?.["System.TeamProject"] || this.teamProject || "";
    const existing = options.marker ? await this.findMarkedComment(azureWorkItemApi, project, workItemId, options.marker) : null;
    const comment = existing
      ? await azureWorkItemApi.updateComment({ text: html }, project, workItemId, Number(existing.id))
      : await azureWorkItemApi.addComment({ text: html }, project, workItemId);
    if (!comment?.id || comment.id <= 0) {
      throw new SfError("commentPostRes: " + JSON.stringify(comment));
    }
    return {
      ticketId: String(workItemId),
      provider: AzureBoardsProvider.providerLabel,
      action: existing ? "updated" : "created",
      commentId: String(comment.id),
      url: `${String(this.serverUrl || "").replace(/\/+$/, "")}/${encodeURIComponent(project)}/_workitems/edit/${workItemId}`,
    };
  }

  /** The most recent comment holding the marker, read page after page */
  private async findMarkedComment(azureWorkItemApi: any, project: string, workItemId: number, marker: string): Promise<any | null> {
    let found: any = null;
    let continuationToken: string | undefined = undefined;
    for (let page = 0; page < 50; page++) {
      const list: any = await azureWorkItemApi.getComments(project, workItemId, 200, continuationToken);
      for (const comment of list?.comments ?? []) {
        if (hasMarker(comment?.text, marker) && (!found || new Date(comment.createdDate) > new Date(found.createdDate))) {
          found = comment;
        }
      }
      continuationToken = list?.continuationToken || undefined;
      if (!continuationToken) {
        break;
      }
    }
    return found;
  }
}
