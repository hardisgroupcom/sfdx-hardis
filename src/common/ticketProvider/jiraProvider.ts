import * as JiraApi from "jira-client";
import { TicketProviderRoot } from "./ticketProviderRoot";
import * as c from "chalk";
import * as sortArray from "sort-array";
import { Ticket } from ".";
import { getBranchMarkdown, getOrgMarkdown } from "../utils/notifUtils";
import { extractRegexMatches, uxLog } from "../utils";
import { SfdxError } from "@salesforce/core";

export class JiraProvider extends TicketProviderRoot {
  private jiraClient: InstanceType<typeof JiraApi>;

  constructor() {
    super();
    const jiraOptions: JiraApi.JiraApiOptions = {
      protocol: "https",
      host: (process.env.JIRA_HOST || "").replace("https://", ""),
      apiVersion: "3",
      strictSSL: true,
    };
    // Basic Auth
    if (process.env.JIRA_EMAIL && process.env.JIRA_TOKEN) {
      jiraOptions.username = process.env.JIRA_EMAIL;
      jiraOptions.password = process.env.JIRA_TOKEN;
      this.isActive = true;
    }
    // Personal access token
    if (process.env.JIRA_PAT) {
      jiraOptions.bearer = process.env.JIRA_PAT;
      this.isActive = true;
    }
    if (this.isActive) {
      this.jiraClient = new JiraApi(jiraOptions);
    }
  }

  public static isAvailable() {
    if (
      // Basic auth
      process.env.JIRA_TOKEN &&
      process.env.JIRA_TOKEN.length > 5 &&
      !process.env.JIRA_TOKEN.includes("JIRA_TOKEN") &&
      process.env.JIRA_HOST &&
      process.env.JIRA_HOST.length > 5 &&
      !process.env.JIRA_HOST.includes("JIRA_HOST") &&
      process.env.JIRA_EMAIL &&
      process.env.JIRA_EMAIL.length > 5 &&
      !process.env.JIRA_EMAIL.includes("JIRA_EMAIL")
    ) {
      return true;
    }
    if (
      // Personal Access Token
      process.env.JIRA_HOST &&
      process.env.JIRA_HOST.length > 5 &&
      !process.env.JIRA_HOST.includes("JIRA_HOST") &&
      process.env.JIRA_PAT &&
      process.env.JIRA_PAT.length > 5 &&
      !process.env.JIRA_PAT.includes("JIRA_PAT")
    ) {
      return true;
    }
    return false;
  }

  public getLabel(): string {
    return "sfdx-hardis JIRA connector";
  }

  public static async getTicketsFromString(text: string): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    // Extract JIRA tickets
    const jiraUrlRegex = /(https:\/\/.*(jira|atlassian\.net).*\/[A-Z0-9]+-\d+\b)/g;
    const jiraMatches = await extractRegexMatches(jiraUrlRegex, text);
    for (const jiraTicketUrl of jiraMatches) {
      const pattern = /https:\/\/.*\/([A-Z0-9]+-\d+\b)/;
      const match = jiraTicketUrl.match(pattern);
      if (match) {
        if (!tickets.some((ticket) => ticket.url === jiraTicketUrl)) {
          tickets.push({
            provider: "JIRA",
            url: jiraTicketUrl,
            id: match[1],
          });
        }
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
        const ticketInfo = await this.jiraClient.getIssue(ticket.id);
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
    const orgMarkdown = JSON.parse(await getOrgMarkdown(org, "jira"));
    const branchMarkdown = JSON.parse(await getBranchMarkdown("jira"));
    const commentedTickets: Ticket[] = [];
    for (const ticket of tickets) {
      if (ticket.foundOnServer) {
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
        try {
          const commentPostRes = await this.jiraClient.addCommentAdvanced(ticket.id, { body: jiraComment });
          if (JSON.stringify(commentPostRes).includes("<!DOCTYPE html>")) {
            throw new SfdxError(`This is a probably a config/rights errors as the response contain HTML`);
          }
          commentedTickets.push(ticket);
        } catch (e6) {
          uxLog(this, c.yellow(`[JiraProvider] Error while posting comment on ${ticket.id}\n${e6.message}`));
        }
      }
    }
    uxLog(
      this,
      c.gray(`[JiraProvider] Posted comments on ${commentedTickets.length} ticket(s): ` + commentedTickets.map((ticket) => ticket.id).join(", ")),
    );
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
