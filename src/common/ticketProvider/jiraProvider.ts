import JiraApi from "jira-client";
import { TicketProviderRoot } from "./ticketProviderRoot.js";
import c from "chalk";
import sortArray from "sort-array";
import { Ticket } from "./index.js";
import { getBranchMarkdown, getOrgMarkdown } from "../utils/notifUtils.js";
import { extractRegexMatches, uxLog } from "../utils/index.js";
import { SfError } from "@salesforce/core";
import { getEnvVar } from "../../config/index.js";

export class JiraProvider extends TicketProviderRoot {
  private jiraClient: InstanceType<typeof JiraApi> | any = null;

  constructor() {
    super();
    const jiraOptions: JiraApi.JiraApiOptions = {
      protocol: "https",
      host: (getEnvVar("JIRA_HOST") || "").replace("https://", ""),
      apiVersion: "3",
      strictSSL: true,
    };
    // Basic Auth
    if (getEnvVar("JIRA_EMAIL") && getEnvVar("JIRA_TOKEN")) {
      jiraOptions.username = getEnvVar("JIRA_EMAIL") || "";
      jiraOptions.password = getEnvVar("JIRA_TOKEN") || "";
      this.isActive = true;
    }
    // Personal access token
    if (getEnvVar("JIRA_PAT")) {
      jiraOptions.bearer = getEnvVar("JIRA_PAT") || "";
      this.isActive = true;
    }
    if (this.isActive) {
      this.jiraClient = new JiraApi(jiraOptions);
    }
  }

  public static isAvailable() {
    if (
      // Basic auth
      getEnvVar("JIRA_HOST") &&
      getEnvVar("JIRA_TOKEN") &&
      getEnvVar("JIRA_EMAIL")
    ) {
      return true;
    }
    if (
      // Personal Access Token
      getEnvVar("JIRA_HOST") &&
      getEnvVar("JIRA_PAT")
    ) {
      return true;
    }
    return false;
  }

  public getLabel(): string {
    return "sfdx-hardis JIRA connector";
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
    const jiraBaseUrl = getEnvVar("JIRA_HOST") || "https://define.JIRA_HOST.in.cicd.variables/";
    const jiraRegex = getEnvVar("JIRA_TICKET_REGEX") || "(?<=[^a-zA-Z0-9_-]|^)([A-Za-z]{2,10}-\\d{1,6})(?=[^a-zA-Z0-9_-]|$)";
    const jiraRefRegex = new RegExp(jiraRegex, "gm");
    const jiraRefs = await extractRegexMatches(jiraRefRegex, text);
    const jiraBaseUrlBrowse = jiraBaseUrl.replace(/\/$/, "") + "/browse/";
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
    const jiraTicketsNumber = tickets.filter((ticket) => ticket.provider === "JIRA").length;
    if (jiraTicketsNumber > 0) {
      uxLog(
        this,
        c.cyan(`[JiraProvider] Now trying to collect ${jiraTicketsNumber} tickets infos from JIRA server ` + process.env.JIRA_HOST + " ..."),
      );
    }
    for (const ticket of tickets) {
      if (ticket.provider === "JIRA") {
        let ticketInfo: JiraApi.JsonResponse | null = null;
        try {
          ticketInfo = await this.jiraClient.getIssue(ticket.id);
        } catch (e) {
          uxLog(this, c.yellow(`[JiraApi] Error while trying to get ${ticket.id} information: ${(e as Error).message}`));
        }
        if (ticketInfo) {
          const body =
            ticketInfo?.fields?.description?.content?.length > 0
              ? ticketInfo.fields?.description?.content?.map((content) => content.text).join("\n")
              : "";
          ticket.foundOnServer = true;
          ticket.subject = ticketInfo?.fields?.summary || "";
          ticket.body = body;
          ticket.status = ticketInfo.fields?.status?.id || "";
          ticket.statusLabel = ticketInfo.fields?.status?.name || "";
          if (ticket.subject === "") {
            uxLog(this, c.yellow("[JiraProvider] Unable to collect JIRA ticket info for " + ticket.id));
            if (JSON.stringify(ticketInfo).includes("<!DOCTYPE html>")) {
              uxLog(this, c.grey("[JiraProvider] This is probably a JIRA auth config issue, as HTML is returned"));
            } else {
              uxLog(this, c.grey(JSON.stringify(ticketInfo)));
            }
            ticket.foundOnServer = false;
          }
          uxLog(this, c.grey("[JiraProvider] Collected data for ticket " + ticket.id));
        } else {
          uxLog(this, c.yellow("[JiraProvider] Unable to get JIRA issue " + ticket.id));
        }
      }
    }
    return tickets;
  }

  public async postDeploymentComments(tickets: Ticket[], org: string, pullRequestInfo: any) {
    uxLog(this, c.cyan(`[JiraProvider] Try to post comments on ${tickets.length} tickets...`));

    const genericHtmlResponseError = "Probably config/access error since response is HTML";
    const orgMarkdown = JSON.parse(await getOrgMarkdown(org, "jira"));
    const branchMarkdown = JSON.parse(await getBranchMarkdown("jira"));
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
          prUrl = pullRequestInfo.web_url || pullRequestInfo.html_url || pullRequestInfo.url;
          if (prUrl) {
            prTitle = pullRequestInfo.title;
            prAuthor = pullRequestInfo?.authorName || pullRequestInfo?.author?.login || pullRequestInfo?.author?.name || null;
          }
        }
        const jiraComment = this.getJiraDeploymentCommentAdf(
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
          const commentPostRes = await this.jiraClient.addCommentAdvanced(ticket.id, { body: jiraComment });
          if (JSON.stringify(commentPostRes).includes("<!DOCTYPE html>")) {
            throw new SfError(genericHtmlResponseError);
          }
          commentedTickets.push(ticket);
        } catch (e6) {
          uxLog(this, c.yellow(`[JiraProvider] Error while posting comment on ${ticket.id}: ${(e6 as any).message}`));
        }

        // Add deployment label to JIRA ticket
        try {
          const issueUpdate = {
            update: {
              labels: [{ add: tag }],
            },
          };
          await this.jiraClient.updateIssue(ticket.id, issueUpdate);
          taggedTickets.push(ticket);
        } catch (e6) {
          if ((e6 as any).message != null && (e6 as any).message.includes("<!doctype html>")) {
            (e6 as any).message = genericHtmlResponseError;
          }
          uxLog(this, c.yellow(`[JiraProvider] Error while adding label ${tag} on ${ticket.id}: ${(e6 as any).message}`));
        }
      }
    }
    // Summary
    if (commentedTickets.length > 0 || taggedTickets.length > 0) {
      uxLog(
        this,
        c.gray(`[JiraProvider] Posted comments on ${commentedTickets.length} ticket(s): ` + commentedTickets.map((ticket) => ticket.id).join(", ")),
      );
      uxLog(
        this,
        c.gray(`[JiraProvider] Added label ${tag} on ${taggedTickets.length} ticket(s): ` + taggedTickets.map((ticket) => ticket.id).join(", ")),
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
  ) {
    const comment = {
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
                    href: "https://sfdx-hardis.cloudity.com/",
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
}
