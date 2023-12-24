import { Version3Client } from "jira.js";
import { TicketProviderRoot } from "./ticketProviderRoot";
import { Ticket } from ".";
import { getBranchMarkdown, getOrgMarkdown } from "../utils/notifUtils";

export class JiraProvider extends TicketProviderRoot {
  private jiraClient: InstanceType<typeof Version3Client>;

  constructor() {
    super();
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

  public getLabel(): string {
    return "sfdx-hardis JIRA connector";
  }

  public async collectTicketsInfo(tickets: Ticket[]) {
    for (const ticket of tickets) {
      if (ticket.provider === "JIRA") {
        const ticketInfo = await this.jiraClient.issues.getIssue({ issueIdOrKey: ticket.id });
        if (ticketInfo) {
          ticket.foundOnServer = true;
          ticket.subject = ticketInfo.fields.summary;
          ticket.body = ticketInfo.fields?.description?.content.map((content) => content.text).join("\n") || "";
          ticket.status = ticketInfo.fields?.status?.id || "";
          ticket.statusLabel = ticketInfo.fields?.status?.name || "";
        }
      }
    }
    return tickets;
  }

  public async postDeploymentComments(tickets: Ticket[], org: string) {
    const orgMarkdown = await getOrgMarkdown(org, "jira");
    const branchMarkdown = await getBranchMarkdown("jira");
    for (const ticket of tickets) {
      if (ticket.foundOnServer) {
        const comment = `Deployed by [sfdx-hardis](https://sfdx-hardis.cloudity.com/) in ${orgMarkdown} from ${branchMarkdown}`;
        await this.jiraClient.issueComments.addComment({ issueIdOrKey: ticket.id, comment: comment });
      }
    }
    return tickets;
  }
}
