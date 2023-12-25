import * as JiraApi from 'jira-client';
import { TicketProviderRoot } from "./ticketProviderRoot";
import * as c from "chalk";
import { Ticket } from ".";
import { getBranchMarkdown, getOrgMarkdown } from "../utils/notifUtils";
import { uxLog } from "../utils";

export class JiraProvider extends TicketProviderRoot {
  private jiraClient: InstanceType<typeof JiraApi>;

  constructor() {
    super();
    const jiraOptions: JiraApi.JiraApiOptions = {
      protocol: 'https',
      host: process.env.JIRA_HOST.replace("https://", ""),
      apiVersion: '3',
      strictSSL: true
    }
    // Basic Auth
    if (process.env.JIRA_EMAIL && process.env.JIRA_TOKEN) {
      jiraOptions.username = process.env.JIRA_EMAIL;
      jiraOptions.password = process.env.JIRA_TOKEN;
    }
    // Personal access token
    if (process.env.JIRA_PAT) {
      jiraOptions.bearer = process.env.JIRA_PAT
    }
    this.jiraClient = new JiraApi(jiraOptions);
  }

  public getLabel(): string {
    return "sfdx-hardis JIRA connector";
  }

  public async collectTicketsInfo(tickets: Ticket[]) {
    const jiraTicketsNumber = tickets.filter((ticket) => ticket.provider === "JIRA").length;
    if (jiraTicketsNumber > 0) {
      uxLog(this, c.cyan(`Now trying to collect ${jiraTicketsNumber} tickets infos from JIRA server ` + process.env.JIRA_HOST + " ..."));
    }
    for (const ticket of tickets) {
      if (ticket.provider === "JIRA") {
        const ticketInfo = await this.jiraClient.getIssue(ticket.id);
        if (ticketInfo) {
          ticket.foundOnServer = true;
          ticket.subject = ticketInfo?.fields?.summary || "";
          ticket.body = ticketInfo.fields?.description?.content.map((content) => content.text).join("\n") || "";
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
          branchMarkdown.url || '',
          prTitle,
          prUrl,
          prAuthor,
        );
        try {
          await this.jiraClient.addCommentAdvanced(ticket.id, { "body": jiraComment });
          commentedTickets.push(ticket);
        } catch (e6) {
          uxLog(this, c.yellow(`[JiraProvider] Error while posting comment on ${ticket.id}\n${e6.message}`))
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
    orgName: string, orgUrl: string, branchName: string,
    branchUrl: string, prTitle: string, prUrl: string, prAuthor: string
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
