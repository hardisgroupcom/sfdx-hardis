import { UtilsTickets as utilsTickets } from "./utils";
import { JiraProvider } from "./jiraProvider";
import { TicketProviderRoot } from "./ticketProviderRoot";

export abstract class TicketProvider {
  static getInstances(): TicketProviderRoot[] {
    const ticketProviders: TicketProviderRoot[] = [];
    // JIRA
    if (UtilsTickets.isJiraAvailable()) {
      ticketProviders.push(new JiraProvider());
    }
    return ticketProviders;
  }

  public static async collectTicketsFromString(text: string): Promise<Ticket[]> {
    const tickets = await utilsTickets.getTicketsFromString(text);
    const ticketProviders = this.getInstances();
    for (const ticketProvider of ticketProviders) {
      await ticketProvider.collectTicketsInfo(tickets);
    }
    return tickets;
  }

  public static async postDeploymentActions(tickets: Ticket[], org: string, pullRequestInfo: any) {
    const ticketProviders = this.getInstances();
    for (const ticketProvider of ticketProviders) {
      await ticketProvider.postDeploymentComments(tickets, org, pullRequestInfo);
    }
    return tickets;
  }
}

export interface Ticket {
  provider: "JIRA";
  id: string;
  url: string;
  subject?: string;
  body?: string;
  status?: string;
  statusLabel?: string;
  foundOnServer?: boolean;
}

export const UtilsTickets = utilsTickets;
