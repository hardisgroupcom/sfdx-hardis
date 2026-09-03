/* jscpd:ignore-start */
import * as azdev from "azure-devops-node-api";
import { TicketProviderRoot } from "./ticketProviderRoot.js";
import c from "chalk";
import sortArray from '../utils/sortArray.js';
// Type-only: a value import here would close a runtime cycle index -> provider -> index
import type { Ticket } from "./index.js";
import { getBranchMarkdown, getOrgMarkdown } from "../utils/notifUtils.js";
import { convertMarkdownToHtml } from "../notifProvider/markdownToHtml.js";
import { extractRegexMatches, getGitRepoUrl, isGitRepo, uxLog } from "../utils/index.js";
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
} from "./ticketDetails.js";
/* jscpd:ignore-end */

export class AzureBoardsProvider extends TicketProviderRoot {
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
   * is the same approach AzureDevopsProvider uses for the git side.
   */
  public static async autoDetectFromGitRemote(): Promise<void> {
    if (getEnvVar("SYSTEM_COLLECTIONURI") && getEnvVar("SYSTEM_TEAMPROJECT")) {
      return;
    }
    if (!isGitRepo()) {
      return;
    }
    const remoteUrl = (await getGitRepoUrl()) || "";
    if (!remoteUrl) {
      return;
    }
    const parsed = AzureDevopsProvider.parseAzureRepoUrl(remoteUrl);
    if (!parsed) {
      // Another provider's remote: not an error, the identifier simply does not belong to this repo
      return;
    }
    if (!getEnvVar("SYSTEM_COLLECTIONURI")) {
      process.env.SYSTEM_COLLECTIONURI = parsed.collectionUri;
    }
    if (!getEnvVar("SYSTEM_TEAMPROJECT")) {
      process.env.SYSTEM_TEAMPROJECT = parsed.teamProject;
    }
    uxLog("log", AzureBoardsProvider, c.grey('[AzureBoardsProvider] ' + t('azureBoardsAutoDetectedFromRemote', {
      collectionUri: process.env.SYSTEM_COLLECTIONURI || "",
      teamProject: process.env.SYSTEM_TEAMPROJECT || "",
    })));
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

  public static async getTicketsFromString(text: string, prInfo: CommonPullRequestInfo | null): Promise<Ticket[]> {
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
    const ticketsSorted: Ticket[] = sortArray(tickets, { by: ["id"], order: ["asc"] });
    const config = await getConfig("project");
    if (!this.isAvailable(config)) {
      return ticketsSorted;
    }
    // Get tickets from Azure commits
    if (prInfo?.providerInfo?.commits) {
      const azureBoardsProvider = new AzureBoardsProvider(config);
      const azureApi = azureBoardsProvider.azureApi;
      const azureGitApi = await azureApi.getGitApi();
      const repositoryId = getEnvVar("BUILD_REPOSITORY_ID") || "";
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

    return ticketsSorted;
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
    let collectedTicketsNumber = 0;
    // try/finally so the progress bar never stays stuck in the VS Code UI when a fetch throws
    try {
      for (const ticket of tickets) {
        if (ticket.provider === "AZURE") {
          // One failing work item (deleted id, expired PAT mid-loop...) must not lose the others
          let ticketInfo: any = null;
          try {
            ticketInfo = await azureWorkItemApi.getWorkItem(Number(ticket.id));
          } catch (e) {
            ticketInfo = { error: (e as Error).message };
          }
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
          collectedTicketsNumber++;
          if (showProgress) {
            WebSocketClient.sendProgressStepMessage(collectedTicketsNumber, azureTicketsNumber);
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
  public static matchesTicketId(ticketId: string): boolean {
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
    const workItem: any = await azureWorkItemApi.getWorkItem(workItemId, undefined, undefined, WorkItemExpand.All);
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
    details.reporter = AzureBoardsProvider.identityName(fields["System.CreatedBy"]);
    details.created = fields["System.CreatedDate"] || "";
    details.updated = fields["System.ChangedDate"] || "";
    details.storyPoints = String(fields["Microsoft.VSTS.Scheduling.StoryPoints"] ?? "");
    details.sprint = fields["System.IterationPath"] || "";
    details.labels = String(fields["System.Tags"] || "").split(";").map((tag) => tag.trim()).filter(Boolean);
    details.description = capText(htmlToPlainText(fields["System.Description"]));
    details.acceptanceCriteria = capText(htmlToPlainText(fields["Microsoft.VSTS.Common.AcceptanceCriteria"]));
    details.extra.areaPath = fields["System.AreaPath"] || "";
    details.extra.reason = fields["System.Reason"] || "";
    details.extra.project = this.teamProject || "";

    try {
      const commentList: any = await azureWorkItemApi.getComments(this.teamProject || "", workItemId);
      details.comments = (commentList?.comments || []).map((comment: any) => ({
        author: AzureBoardsProvider.identityName(comment?.createdBy),
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

  public async postDeploymentComments(tickets: Ticket[], org: string, pullRequestInfo: CommonPullRequestInfo | null): Promise<Ticket[]> {
    uxLog("action", this, c.cyan('[AzureBoardsProvider] ' + t('azureBoardsProviderPostingComments', { count: tickets.length })));
    const orgMarkdown = await getOrgMarkdown(org);
    const branchMarkdown = await getBranchMarkdown();
    const tag = await this.getDeploymentTag();
    const commentedTickets: Ticket[] = [];
    const taggedTickets: Ticket[] = [];
    const azureWorkItemApi = await this.azureApi.getWorkItemTrackingApi(this.serverUrl || "");
    for (const ticket of tickets) {
      if (ticket.foundOnServer) {
        let commentMd = `Deployed from branch ${branchMarkdown} to org ${orgMarkdown}`;
        if (pullRequestInfo) {
          const prUrl = pullRequestInfo.webUrl || "";
          if (prUrl) {
            const prAuthor = pullRequestInfo.authorName;
            commentMd += `\n\nPR: [${pullRequestInfo.title}](${prUrl})` + (prAuthor ? ` by ${prAuthor}` : "");
          }
        }
        const azureBoardsComment = await convertMarkdownToHtml(commentMd);

        // Post comment
        try {
          const commentPostRes = await azureWorkItemApi.addComment({ text: azureBoardsComment }, this.teamProject || "", Number(ticket.id));
          if (commentPostRes?.id && commentPostRes?.id > 0) {
            commentedTickets.push(ticket);
          } else {
            throw new SfError("commentPostRes: " + commentPostRes);
          }
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
}
