import { Version2Client, Version3Client, Version3Models } from "jira.js";
import { TicketProviderRoot } from "./ticketProviderRoot.js";
import c from "chalk";
import sortArray from "sort-array";
import { Ticket } from "./index.js";
import { getBranchMarkdown, getOrgMarkdown } from "../utils/notifUtils.js";
import { extractRegexMatches, uxLog } from "../utils/index.js";
import { SfError } from "@salesforce/core";
import { CONSTANTS, getConfig, getEnvVar } from "../../config/index.js";
import { CommonPullRequestInfo } from "../gitProvider/index.js";
import { t } from '../utils/i18n.js';
import axios from "axios";

export class JiraProvider extends TicketProviderRoot {
  // Version3Client for Jira Cloud, Version2Client for Jira Server / Data Center
  private jiraClient: Version2Client | Version3Client | null = null;
  private jiraHost: string | null = null;
  private clientCredentialsEnabled = false;
  private clientCredentialsInitialized = false;

  constructor(config: any) {
    super();
    const rawHost = getEnvVar("JIRA_HOST") || config.jiraHost || "";
    const sanitizedHost = rawHost.startsWith("http") ? rawHost : `https://${rawHost}`;
    this.jiraHost = sanitizedHost.replace(/\/$/, "");
    // Client Credentials (Jira Cloud only - uses Atlassian OAuth2 API)
    if (getEnvVar("JIRA_CLIENT_ID") && getEnvVar("JIRA_CLIENT_SECRET")) {
      this.isActive = true;
      this.clientCredentialsEnabled = true;
      uxLog("log", this, c.grey("[JiraProvider] Using JIRA_CLIENT_ID and JIRA_CLIENT_SECRET for authentication"));
    }
    // Basic Auth (email + API token for Cloud, username + password for Server/DC)
    else if (getEnvVar("JIRA_EMAIL") && getEnvVar("JIRA_TOKEN")) {
      const authConfig = {
        basic: {
          email: getEnvVar("JIRA_EMAIL") || "",
          apiToken: getEnvVar("JIRA_TOKEN") || "",
        },
      };
      this.jiraClient = this.createJiraClient(authConfig);
      this.isActive = true;
      uxLog("log", this, c.grey('[JiraProvider] ' + t('jiraProviderAuthEmailToken')));
    }
    // Personal access token
    else if (getEnvVar("JIRA_PAT")) {
      const authConfig = {
        oauth2: {
          accessToken: getEnvVar("JIRA_PAT") || "",
        },
      };
      this.jiraClient = this.createJiraClient(authConfig);
      this.isActive = true;
      uxLog("log", this, c.grey('[JiraProvider] ' + t('jiraProviderAuthPat')));
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
    if (this.isJiraCloud()) {
      return new Version3Client({ host, authentication: authConfig });
    }
    // Jira Server / Data Center only supports REST API v2
    return new Version2Client({ host, authentication: authConfig });
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
    if (this.jiraClient) {
      return this.jiraClient;
    }
    if (!this.isActive) {
      return null;
    }
    // Client Credentials OAuth2 flow (Jira Cloud only)
    if (this.clientCredentialsEnabled && !this.clientCredentialsInitialized) {
      try {
        const accessToken = await this.getOAuthToken();
        const cloudId = await this.getCloudId(accessToken);

        if (cloudId) {
          // Client Credentials always target Jira Cloud via the Atlassian API gateway
          this.jiraClient = new Version3Client({
            host: `https://api.atlassian.com/ex/jira/${cloudId}`,
            authentication: {
              oauth2: {
                accessToken: accessToken,
              },
            },
          });
        } else {
          uxLog("error", this, c.yellow("[JiraProvider] Could not resolve Cloud ID for JIRA_HOST from accessible resources."));
        }
      } catch (e: any) {
        uxLog("error", this, c.yellow(`[JiraProvider] Error initializing OAuth2 client: ${e.message}`));
      } finally {
        this.clientCredentialsInitialized = true;
      }
    }
    return this.jiraClient;
  }

  private async getOAuthToken(): Promise<string> {
    const clientId = getEnvVar("JIRA_CLIENT_ID") || "";
    const clientSecret = getEnvVar("JIRA_CLIENT_SECRET") || "";

    const tokenResponse = await axios.post("https://api.atlassian.com/oauth/token", {
      audience: "api.atlassian.com",
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    return tokenResponse.data.access_token;
  }

  private async getCloudId(accessToken: string): Promise<string> {
    const resourcesResponse = await axios.get("https://api.atlassian.com/oauth/token/accessible-resources", {
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
    if (!activeClient) {
      return tickets;
    }
    const jiraTicketsNumber = tickets.filter((ticket) => ticket.provider === "JIRA").length;
    if (jiraTicketsNumber > 0) {
      uxLog(
        "action",
        this,
        c.cyan('[JiraProvider] ' + t('jiraProviderCollectingTickets', { jiraTicketsNumber, jiraHost: this.jiraHost })),
      );
    }
    for (const ticket of tickets) {
      if (ticket.provider === "JIRA") {
        let ticketInfo: any = null;
        try {
          // Cast needed: Version2Client and Version3Client share the same method signature,
          // but TypeScript cannot resolve the union of their overloaded signatures.
          ticketInfo = await (activeClient as Version2Client).issues.getIssue({ issueIdOrKey: ticket.id });
        } catch (e) {
          uxLog("warning", this, c.yellow('[JiraApi] ' + t('jiraApiErrorGettingTicket', { ticketId: ticket.id, message: (e as Error).message })));
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
            if (JSON.stringify(ticketInfo).includes("<!DOCTYPE html>")) {
              uxLog("log", this, c.grey('[JiraProvider] ' + t('jiraProviderAuthConfigIssue')));
            } else {
              uxLog("log", this, c.grey(JSON.stringify(ticketInfo)));
            }
            ticket.foundOnServer = false;
          }
          uxLog("log", this, c.grey('[JiraProvider] ' + t('jiraProviderCollectedTicket', { ticketId: ticket.id })));
        } else {
          uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderUnableToGetIssue', { ticketId: ticket.id })));
        }
      }
    }
    return tickets;
  }

  public async postDeploymentComments(tickets: Ticket[], org: string, pullRequestInfo: CommonPullRequestInfo | null): Promise<Ticket[]> {
    const activeClient = await this.getJiraClient();
    if (!activeClient) {
      return tickets;
    }
    uxLog("action", this, c.cyan('[JiraProvider] ' + t('jiraProviderPostingComments', { count: tickets.length })));

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
        // Cast needed: Version2Client and Version3Client share the same method signature,
        // but TypeScript cannot resolve the union of their overloaded signatures.
        try {
          const commentPostRes = await (activeClient as Version2Client).issueComments.addComment({ issueIdOrKey: ticket.id, comment: jiraComment });
          if (JSON.stringify(commentPostRes).includes("<!DOCTYPE html>")) {
            throw new SfError(genericHtmlResponseError);
          }
          commentedTickets.push(ticket);
        } catch (e6) {
          uxLog("warning", this, c.yellow('[JiraProvider] ' + t('jiraProviderErrorPostingComment', { ticketId: ticket.id, message: (e6 as any).message })));
        }

        // Add deployment label to JIRA ticket
        try {
          await (activeClient as Version2Client).issues.editIssue({
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
