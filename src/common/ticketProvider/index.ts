import c from "chalk";
import sortArray from "sort-array";
import { JiraProvider } from "./jiraProvider.js";
import { TicketProviderRoot } from "./ticketProviderRoot.js";
import { uxLog } from "../utils/index.js";
import { GenericTicketingProvider } from "./genericProvider.js";
import { AzureBoardsProvider } from "./azureBoardsProvider.js";

export const allTicketProviders = [JiraProvider, GenericTicketingProvider, AzureBoardsProvider];

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
  public static async getProvidersTicketsFromString(text: string, options: any): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    for (const ticketProvider of allTicketProviders) {
      const providerTickets = await ticketProvider.getTicketsFromString(text, options);
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
  provider: "JIRA" | "AZURE" | "GENERIC";
  id: string;
  url: string;
  subject?: string;
  body?: string;
  status?: string;
  statusLabel?: string;
  foundOnServer?: boolean;
}
