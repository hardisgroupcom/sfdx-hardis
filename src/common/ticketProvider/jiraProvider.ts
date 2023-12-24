import { Version3Client } from "jira.js";
import { TicketProviderRoot } from "./ticketProviderRoot";
import * as c from "chalk";
import { Ticket } from ".";
import { getBranchMarkdown, getOrgMarkdown } from "../utils/notifUtils";
import { uxLog } from "../utils";

export class JiraProvider extends TicketProviderRoot {
  private jiraClient: InstanceType<typeof Version3Client>;

  constructor() {
    super();
    if (process.env.JIRA_PAT) {
      // Personal Access Token Auth
      this.jiraClient = new Version3Client({
        host: process.env.JIRA_HOST,
        authentication: {
          personalAccessToken: process.env.JIRA_PAT,
        },
      });
    } else {
      // Basic auth
      this.jiraClient = new Version3Client({
        host: process.env.JIRA_HOST,
        authentication: {
          basic: {
            email: process.env.JIRA_EMAIL,
            apiToken: process.env.JIRA_TOKEN,
          },
        },
      });
    }
  }

  public getLabel(): string {
    return "sfdx-hardis JIRA connector";
  }

  public async collectTicketsInfo(tickets: Ticket[]) {
    for (const ticket of tickets) {
      if (ticket.provider === "JIRA") {
        const ticketInfo = await this.jiraClient.issues.getIssue({ issueIdOrKey: ticket.id });
        if (ticketInfo) {
          ticket.foundOnServer = true;
          ticket.subject = ticketInfo?.fields?.summary || "";
          ticket.body = ticketInfo.fields?.description?.content.map((content) => content.text).join("\n") || "";
          ticket.status = ticketInfo.fields?.status?.id || "";
          ticket.statusLabel = ticketInfo.fields?.status?.name || "";
          if (ticket.subject === "") {
            uxLog(this, c.yellow("[JiraProvider] Unable to find JIRA ticket info for " + ticket.id));
            if (JSON.stringify(ticketInfo).includes("<!DOCTYPE html>")) {
              uxLog(this, c.grey("[JiraProvider] This is probably a JIRA auth config issue, as HTML is returned"));
            } else {
              uxLog(this, c.grey(JSON.stringify(ticketInfo)));
            }
            ticket.foundOnServer = false;
          }
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
          branchMarkdown.url,
          prTitle,
          prUrl,
          prAuthor,
        );
        await this.jiraClient.issueComments.addComment({ issueIdOrKey: ticket.id, comment: jiraComment });
        commentedTickets.push(ticket);
      }
    }
    uxLog(
      this,
      c.cyan(`[JiraProvider] Posted comments on ${commentedTickets.length} tickets` + commentedTickets.map((ticket) => ticket.id).join(", ")),
    );
    return tickets;
  }

  getJiraDeploymentCommentAdf(orgName, orgUrl, branchName, branchUrl, prTitle, prUrl, prAuthor) {
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
