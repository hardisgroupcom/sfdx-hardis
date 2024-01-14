import * as azdev from "azure-devops-node-api";
import { TicketProviderRoot } from "./ticketProviderRoot";
import * as c from "chalk";
import * as sortArray from "sort-array";
import { Ticket } from ".";
import { getBranchMarkdown, getOrgMarkdown } from "../utils/notifUtils";
import { extractRegexMatches, uxLog } from "../utils";
import { SfdxError } from "@salesforce/core";
import { GitCommitRef } from "azure-devops-node-api/interfaces/GitInterfaces";
import { JsonPatchDocument } from "azure-devops-node-api/interfaces/common/VSSInterfaces";

export class AzureBoardsProvider extends TicketProviderRoot {
  protected serverUrl: string;
  protected azureApi: InstanceType<typeof azdev.WebApi>;
  protected teamProject: string;

  constructor() {
    super();
    // Azure server url must be provided in SYSTEM_COLLECTIONURI. ex: https:/dev.azure.com/mycompany
    this.serverUrl = process.env.SYSTEM_COLLECTIONURI;
    // a Personal Access Token must be defined
    this.token = process.env.CI_SFDX_HARDIS_AZURE_TOKEN || process.env.SYSTEM_ACCESSTOKEN;
    this.teamProject = process.env.SYSTEM_TEAMPROJECT;
    if (this.serverUrl && this.token && this.teamProject) {
      this.isActive = true;
    }
    if (this.isActive) {
      const authHandler = azdev.getHandlerFromToken(this.token);
      this.azureApi = new azdev.WebApi(this.serverUrl, authHandler);
    }
  }

  public static isAvailable() {
    if (
      // Basic auth
      process.env.SYSTEM_COLLECTIONURI &&
      process.env.SYSTEM_COLLECTIONURI.length > 5 &&
      !process.env.SYSTEM_COLLECTIONURI.includes("SYSTEM_COLLECTIONURI") &&
      process.env.SYSTEM_ACCESSTOKEN &&
      process.env.SYSTEM_ACCESSTOKEN.length > 5 &&
      !process.env.SYSTEM_ACCESSTOKEN.includes("SYSTEM_ACCESSTOKEN") &&
      process.env.SYSTEM_TEAMPROJECT &&
      process.env.SYSTEM_TEAMPROJECT.length > 5 &&
      !process.env.SYSTEM_TEAMPROJECT.includes("SYSTEM_TEAMPROJECT")
    ) {
      return true;
    }
    return false;
  }

  public getLabel(): string {
    return "sfdx-hardis JIRA connector";
  }

  public static async getTicketsFromString(text: string, options: any = {}): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    // Extract JIRA tickets
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
    if (!this.isAvailable) {
      return ticketsSorted;
    }
    // Get tickets from Azure commits
    if (options.commits) {
      const azureBoardsProvider = new AzureBoardsProvider();
      const azureApi = azureBoardsProvider.azureApi;
      const azureGitApi = await azureApi.getGitApi();
      const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
      const commitIds = options.commits.filter((commit) => commit.hash).map((commit) => commit.hash);
      const azureCommits: GitCommitRef[] = [];
      for (const commitId of commitIds) {
        const commitRefs = await azureGitApi.getCommits(repositoryId, { fromCommitId: commitId, toCommitId: commitId, includeWorkItems: true });
        azureCommits.push(...commitRefs);
      }
      for (const commit of azureCommits) {
        for (const workItem of commit?.workItems || []) {
          if (!tickets.some((ticket) => ticket.url === workItem.url)) {
            tickets.push({
              provider: "AZURE",
              url: workItem.url,
              id: workItem.id,
            });
          }
        }
      }
    }

    // Get tickets from Azure PR
    if (options?.pullRequestInfo?.workItemRefs?.length > 0) {
      for (const workItemRef of options?.pullRequestInfo?.workItemRefs) {
        if (!tickets.some((ticket) => ticket.url === workItemRef.url)) {
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
        this,
        c.cyan(
          `[AzureBoardsProvider] Now trying to collect ${azureTicketsNumber} tickets infos from Azure Boards Server ` + process.env.SYSTEM_COLLECTIONURI + " ..."
        )
      );
    }
    const azureWorkItemApi = await this.azureApi.getWorkItemTrackingApi(this.serverUrl);
    for (const ticket of tickets) {
      if (ticket.provider === "AZURE") {
        const ticketInfo = await azureWorkItemApi.getWorkItem(Number(ticket.id));
        if (ticketInfo && ticketInfo?.fields) {
          ticket.foundOnServer = true;
          ticket.subject = ticketInfo.fields["System.Title"] || "";
          ticket.status = ticketInfo.fields["System.State"] || "";
          ticket.statusLabel = ticketInfo.fields["System.State"] || "";
          if (ticketInfo?._links && ticketInfo._links["html"] && ticketInfo._links["html"]["href"]) {
            ticket.url = ticketInfo?._links["html"]["href"];
          }
          uxLog(this, c.grey("[AzureBoardsProvider] Collected data for Work Item " + ticket.id));
        } else {
          uxLog(this, c.yellow("[AzureBoardsProvider] Unable to get Azure Boards WorkItem " + ticket.id + "\n" + c.grey(JSON.stringify(ticketInfo))));
        }
      }
    }
    return tickets;
  }

  public async postDeploymentComments(tickets: Ticket[], org: string, pullRequestInfo: any) {
    uxLog(this, c.cyan(`[AzureBoardsProvider] Try to post comments on ${tickets.length} work items...`));
    const orgMarkdown = await getOrgMarkdown(org, "html");
    const branchMarkdown = await getBranchMarkdown("html");
    const tag = await this.getDeploymentTag();
    const commentedTickets: Ticket[] = [];
    const taggedTickets: Ticket[] = [];
    const azureWorkItemApi = await this.azureApi.getWorkItemTrackingApi(this.serverUrl);
    for (const ticket of tickets) {
      if (ticket.foundOnServer) {
        let azureBoardsComment = `Deployed from branch ${branchMarkdown} to org ${orgMarkdown}`;
        if (pullRequestInfo) {
          const prUrl = pullRequestInfo.web_url || pullRequestInfo.html_url || pullRequestInfo.url;
          if (prUrl) {
            const prAuthor = pullRequestInfo?.authorName || pullRequestInfo?.author?.login || pullRequestInfo?.author?.name || null;
            azureBoardsComment += `<br/><br/>PR: <a href="${prUrl}">${pullRequestInfo.title}</a>` + (prAuthor ? ` by ${prAuthor}` : "");
          }
        }

        // Post comment
        try {
          const commentPostRes = await azureWorkItemApi.addComment({ text: azureBoardsComment }, this.teamProject, Number(ticket.id));
          if (commentPostRes && commentPostRes?.id > 0) {
            commentedTickets.push(ticket);
          }
          else {
            throw new SfdxError("commentPostRes: " + commentPostRes);
          }
        } catch (e6) {
          uxLog(this, c.yellow(`[AzureBoardsProvider] Error while posting comment on ${ticket.id}\n${e6.message}\n${c.grey(e6.stack)}`));
        }

        // Add tag
        try {
          const patchDocument: JsonPatchDocument = [
            {
              "op": "add",
              "path": "/fields/System.Tags",
              "value": tag
            }
          ];
          const workItem = await azureWorkItemApi.updateWorkItem({}, patchDocument, Number(ticket.id), this.teamProject);
          if (workItem && workItem?.id > 0) {
            taggedTickets.push(ticket);
          }
          else {
            throw new SfdxError("workItem: " + workItem);
          }
        } catch (e6) {
          uxLog(this, c.yellow(`[AzureBoardsProvider] Error while posting tag on ${ticket.id}\n${e6.message}\n${c.grey(e6.stack)}`));
        }

      }
    }
    uxLog(
      this,
      c.gray(
        `[AzureBoardsProvider] Posted comments on ${commentedTickets.length} ticket(s): ` + commentedTickets.map((ticket) => ticket.id).join(", ")
      )
    );
    uxLog(
      this,
      c.gray(
        `[AzureBoardsProvider] Posted tags on ${taggedTickets.length} ticket(s): ` + taggedTickets.map((ticket) => ticket.id).join(", ")
      )
    );
    return tickets;
  }
}
