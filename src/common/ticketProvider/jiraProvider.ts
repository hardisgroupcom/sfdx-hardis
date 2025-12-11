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

export class JiraProvider extends TicketProviderRoot {
  private jiraClient: Version3Client | null = null;
  private jiraHost: string | null = null;
  private jiraAuthMode: "JIRA_EMAIL+JIRA_TOKEN" | "JIRA_PAT" | "JIRA_PAT(DATA_CENTER_WORKAROUND)";
  private jiraIsAuthenticated: boolean = false;

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
      this.jiraAuthMode = "JIRA_EMAIL+JIRA_TOKEN"
      uxLog("log", this, c.grey("[JiraProvider] Using JIRA_EMAIL and JIRA_TOKEN for authentication"));
    }
    // Personal access token
    else if (getEnvVar("JIRA_PAT")) {
      jiraOptions.authentication = {
        oauth2: {
          accessToken: getEnvVar("JIRA_PAT") || "",
        },
      };
      this.isActive = true;
      this.jiraAuthMode = "JIRA_PAT"
      uxLog("log", this, c.grey("[JiraProvider] Using JIRA_PAT for authentication"));
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

  public async authenticate(): Promise<boolean> {
    if (!this.jiraClient) {
      return false;
    }
    if (this.jiraIsAuthenticated) {
      return true;
    }
    const user = await this.jiraClient!.myself.getCurrentUser();
    if (user?.active) {
      this.jiraIsAuthenticated = true;
      uxLog("log", this, "JIRA authentication successful with mode: " + this.jiraAuthMode);
      return true;
    }
    if (this.jiraAuthMode === "JIRA_PAT") {
      uxLog("log", this, "Authentication failed with JIRA_PAT: trying workaround for Jira Data Center...");
      // Override the request method to inject Bearer PAT
      const originalSendRequest = this.jiraClient.sendRequest.bind(
        this.jiraClient,
      );
      this.jiraClient.sendRequest = async (
        requestConfig: any,
        callback: any,
      ) => {
        requestConfig.headers = {
          ...requestConfig.headers,
          Authorization: `Bearer ${getEnvVar("JIRA_PAT")}`,
        };
        return originalSendRequest(requestConfig, callback);
      };
      this.jiraAuthMode = "JIRA_PAT(DATA_CENTER_WORKAROUND)";
      return this.authenticate();
    }
    uxLog(
      "error",
      this,
      `JIRA authentication failed with mode ${this.jiraAuthMode}: Active user check failed. ${user ? JSON.stringify(user) : user}`,
    );
    return false;
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
        c.cyan(`[JiraProvider] Now trying to collect ${jiraTicketsNumber} tickets infos from JIRA server ` + this.jiraHost + " ..."),
      );
    }
    for (const ticket of tickets) {
      if (ticket.provider === "JIRA") {
        let ticketInfo: Version3Models.Issue | null = null;
        try {
          ticketInfo = await this.jiraClient.issues.getIssue({ issueIdOrKey: ticket.id });
        } catch (e) {
          uxLog("warning", this, c.yellow(`[JiraApi] Error while trying to get ${ticket.id} information: ${(e as Error).message}`));
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
            uxLog("warning", this, c.yellow("[JiraProvider] Unable to collect JIRA ticket info for " + ticket.id));
            if (JSON.stringify(ticketInfo).includes("<!DOCTYPE html>")) {
              uxLog("log", this, c.grey("[JiraProvider] This is probably a JIRA auth config issue, as HTML is returned"));
            } else {
              uxLog("log", this, c.grey(JSON.stringify(ticketInfo)));
            }
            ticket.foundOnServer = false;
          }
          uxLog("log", this, c.grey("[JiraProvider] Collected data for ticket " + ticket.id));
        } else {
          uxLog("warning", this, c.yellow("[JiraProvider] Unable to get JIRA issue " + ticket.id));
        }
      }
    }
    return tickets;
  }

  public async postDeploymentComments(tickets: Ticket[], org: string, pullRequestInfo: CommonPullRequestInfo | null): Promise<Ticket[]> {
    if (!this.jiraClient) {
      return tickets;
    }
    uxLog("action", this, c.cyan(`[JiraProvider] Try to post comments on ${tickets.length} tickets...`));

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
          uxLog("warning", this, c.yellow(`[JiraProvider] Error while posting comment on ${ticket.id}: ${(e6 as any).message}`));
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
          uxLog("warning", this, c.yellow(`[JiraProvider] Error while adding label ${tag} on ${ticket.id}: ${(e6 as any).message}`));
        }
      }
    }
    // Summary
    if (commentedTickets.length > 0 || taggedTickets.length > 0) {
      uxLog(
        "log",
        this,
        c.grey(`[JiraProvider] Posted comments on ${commentedTickets.length} ticket(s): ` + commentedTickets.map((ticket) => ticket.id).join(", ")),
      );
      uxLog(
        "log",
        this,
        c.grey(`[JiraProvider] Added label ${tag} on ${taggedTickets.length} ticket(s): ` + taggedTickets.map((ticket) => ticket.id).join(", ")),
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
