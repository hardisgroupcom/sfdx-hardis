import { UtilsTickets as utilsTickets } from "./utils";
import * as c from 'chalk';
import { JiraProvider } from "./jiraProvider";
import { TicketProviderRoot } from "./ticketProviderRoot";
import { uxLog } from "../utils";

export abstract class TicketProvider {
  static getInstances(): TicketProviderRoot[] {
    const ticketProviders: TicketProviderRoot[] = [];
    // JIRA
    if (UtilsTickets.isJiraAvailable()) {
      ticketProviders.push(new JiraProvider());
    }
    return ticketProviders;
  }

  public static async collectTicketsInfo(tickets: Ticket[]): Promise<Ticket[]> {
    const ticketProviders = this.getInstances();
    if (ticketProviders.length === 0) {
      uxLog(
        this,
        c.gray(`[TicketProvider] No ticket provider has been configured`),
      );
    }
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
