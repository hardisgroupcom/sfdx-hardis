import * as c from "chalk";
import * as sortArray from "sort-array";
import { JiraProvider } from "./jiraProvider";
import { TicketProviderRoot } from "./ticketProviderRoot";
import { uxLog } from "../utils";
import { GenericTicketingProvider } from "./genericProvider";

export const allTicketProviders = [JiraProvider, GenericTicketingProvider];

export abstract class TicketProvider {
  static getInstances(): TicketProviderRoot[] {
    const ticketProviders: TicketProviderRoot[] = [];
    for (const provider of allTicketProviders) {
      if (provider.isAvailable()) {
        ticketProviders.push(new provider());
      }
    }
    return ticketProviders;
  }

  // Returns all providers ticket references from input string
  public static async getProvidersTicketsFromString(text: string): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    for (const ticketProvider of allTicketProviders) {
      const providerTickets = await ticketProvider.getTicketsFromString(text);
      tickets.push(...providerTickets);
    }
    const ticketsSorted: Ticket[] = sortArray(tickets, { by: ["id"], order: ["asc"] });
    return ticketsSorted;
  }

  // Adds ticket info by calling ticket providers APIs when possible
  public static async collectTicketsInfo(tickets: Ticket[]): Promise<Ticket[]> {
    const ticketProviders = this.getInstances();
    if (ticketProviders.length === 0) {
      uxLog(this, c.gray(`[TicketProvider] No ticket provider has been configured`));
    }
    for (const ticketProvider of ticketProviders) {
      if (ticketProvider.isActive) {
        await ticketProvider.collectTicketsInfo(tickets);
      }
    }
    return tickets;
  }

  // Process Ticket providers actions after a deployment.
  // Can be comments on JIRA, and maybe later status changes ? :)
  public static async postDeploymentActions(tickets: Ticket[], org: string, pullRequestInfo: any) {
    const ticketProviders = this.getInstances();
    for (const ticketProvider of ticketProviders) {
      if (ticketProvider.isActive) {
        await ticketProvider.postDeploymentComments(tickets, org, pullRequestInfo);
      }
    }
    return tickets;
  }
}

export interface Ticket {
  provider: "JIRA" | "GENERIC";
  id: string;
  url: string;
  subject?: string;
  body?: string;
  status?: string;
  statusLabel?: string;
  foundOnServer?: boolean;
}
