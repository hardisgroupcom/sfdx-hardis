import { Version3Client, Version3Models } from "jira.js";
import { TicketProviderRoot } from "./ticketProviderRoot.js";
import c from "chalk";
import sortArray from "sort-array";
import { Ticket } from "./index.js";
import { getBranchMarkdown, getOrgMarkdown } from "../utils/notifUtils.js";
import { extractRegexMatches, uxLog } from "../utils/index.js";
import { SfError } from "@salesforce/core";
import { getConfig, getEnvVar } from "../../config/index.js";
import { CommonPullRequestInfo } from "../gitProvider/index.js";
import { t } from '../utils/i18n.js';

export class JiraProvider extends TicketProviderRoot {
  private jiraClient: Version3Client | null = null;
  private jiraHost: string | null = null;

  constructor(config: any) {
    super();
    const rawHost = getEnvVar("JIRA_HOST") || config.jiraHost || "";
    const sanitizedHost = rawHost.startsWith("http") ? rawHost : `https://${rawHost}`;
    this.jiraHost = sanitizedHost.replace(/\/$/, "");
    const jiraOptions: ConstructorParameters<typeof Version3Client>[0] = {
      host: this.jiraHost || '',
    };
    // Basic Auth
    if (getEnvVar("JIRA_EMAIL") && getEnvVar("JIRA_TOKEN")) {
      jiraOptions.authentication = {
        basic: {
          email: getEnvVar("JIRA_EMAIL") || "",
          apiToken: getEnvVar("JIRA_TOKEN") || "",
        },
      };
      this.isActive = true;
      uxLog("log", this, c.grey(t('jiraProviderAuthEmailToken')));
    }
    // Personal access token
    else if (getEnvVar("JIRA_PAT")) {
      jiraOptions.authentication = {
        oauth2: {
          accessToken: getEnvVar("JIRA_PAT") || "",
        },
      };
      this.isActive = true;
      uxLog("log", this, c.grey(t('jiraProviderAuthPat')));
    }
    if (this.isActive) {
      this.jiraClient = new Version3Client(jiraOptions);
    }
  }

  public static isAvailable(config: any): boolean {
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
    const jiraRegex = getEnvVar("JIRA_TICKET_REGEX") || config.jiraTicketRegex || "(?<=[^a-zA-Z0-9_-]|^)([A-Za-z0-9]{2,10}-\\d{1,6})(?=[^a-zA-Z0-9_-]|$)";
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
    if (!this.jiraClient) {
      return tickets;
    }
    const jiraTicketsNumber = tickets.filter((ticket) => ticket.provider === "JIRA").length;
    if (jiraTicketsNumber > 0) {
      uxLog(
        "action",
        this,
        c.cyan(t('jiraProviderCollectingTickets', { jiraTicketsNumber, jiraHost: this.jiraHost })),
      );
    }
    for (const ticket of tickets) {
      if (ticket.provider === "JIRA") {
        let ticketInfo: Version3Models.Issue | null = null;
        try {
          ticketInfo = await this.jiraClient.issues.getIssue({ issueIdOrKey: ticket.id });
        } catch (e) {
          uxLog("warning", this, c.yellow(t('jiraApiErrorGettingTicket', { ticketId: ticket.id, message: (e as Error).message })));
        }
        if (ticketInfo) {
          const body = this.getPlainTextFromDescription(ticketInfo?.fields?.description as Version3Models.Document | string | null | undefined);
          ticket.foundOnServer = true;
          ticket.subject = ticketInfo?.fields?.summary || "";
          ticket.body = body;
          ticket.status = ticketInfo.fields?.status?.id || "";
          ticket.statusLabel = ticketInfo.fields?.status?.name || "";
          const assignee = ticketInfo.fields?.assignee as Version3Models.UserDetails | undefined;
          const reporter = ticketInfo.fields?.reporter as Version3Models.UserDetails | undefined;
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
            uxLog("warning", this, c.yellow(t('jiraProviderUnableToCollectTicket', { ticketId: ticket.id })));
            if (JSON.stringify(ticketInfo).includes("<!DOCTYPE html>")) {
              uxLog("log", this, c.grey(t('jiraProviderAuthConfigIssue')));
            } else {
              uxLog("log", this, c.grey(JSON.stringify(ticketInfo)));
            }
            ticket.foundOnServer = false;
          }
          uxLog("log", this, c.grey(t('jiraProviderCollectedTicket', { ticketId: ticket.id })));
        } else {
          uxLog("warning", this, c.yellow(t('jiraProviderUnableToGetIssue', { ticketId: ticket.id })));
        }
      }
    }
    return tickets;
  }

  public async postDeploymentComments(tickets: Ticket[], org: string, pullRequestInfo: CommonPullRequestInfo | null): Promise<Ticket[]> {
    if (!this.jiraClient) {
      return tickets;
    }
    uxLog("action", this, c.cyan(t('jiraProviderPostingComments', { count: tickets.length })));

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
          prUrl = pullRequestInfo.webUrl;
          if (prUrl) {
            prTitle = pullRequestInfo.title;
            prAuthor = pullRequestInfo?.authorName;
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
          const commentPostRes = await this.jiraClient.issueComments.addComment({ issueIdOrKey: ticket.id, comment: jiraComment });
          if (JSON.stringify(commentPostRes).includes("<!DOCTYPE html>")) {
            throw new SfError(genericHtmlResponseError);
          }
          commentedTickets.push(ticket);
        } catch (e6) {
          uxLog("warning", this, c.yellow(t('jiraProviderErrorPostingComment', { ticketId: ticket.id, message: (e6 as any).message })));
        }

        // Add deployment label to JIRA ticket
        try {
          await this.jiraClient.issues.editIssue({
            issueIdOrKey: ticket.id,
            update: {
              labels: [{ add: tag }],
            },
          });
          taggedTickets.push(ticket);
        } catch (e6) {
          if ((e6 as any).message != null && (e6 as any).message.includes("<!doctype html>")) {
            (e6 as any).message = genericHtmlResponseError;
          }
          uxLog("warning", this, c.yellow(t('jiraProviderErrorAddingLabel', { tag, ticketId: ticket.id, message: (e6 as any).message })));
        }
      }
    }
    // Summary
    if (commentedTickets.length > 0 || taggedTickets.length > 0) {
      uxLog(
        "log",
        this,
        c.grey(t('jiraProviderPostedComments', { count: commentedTickets.length, tickets: commentedTickets.map((ticket) => ticket.id).join(", ") })),
      );
      uxLog(
        "log",
        this,
        c.grey(t('jiraProviderAddedLabel', { tag, count: taggedTickets.length, tickets: taggedTickets.map((ticket) => ticket.id).join(", ") })),
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
