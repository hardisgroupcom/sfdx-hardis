import { Ticket } from ".";
import * as sortArray from "sort-array";
import { extractRegexMatches } from "../utils";
import { TicketProviderRoot } from "./ticketProviderRoot";

export class GenericTicketingProvider extends TicketProviderRoot {
  private ticketRefRegex: string;
  private ticketUrlBuilder: string;

  constructor() {
    super();
    this.ticketRefRegex = process.env.GENERIC_TICKETING_PROVIDER_REGEX || null; // Example: ([R|I][0-9]+-[0-9]+)
    this.ticketUrlBuilder = process.env.GENERIC_TICKETING_PROVIDER_URL_BUILDER || null; // Example: https://instance.easyvista.com/index.php?ticket={REF}
    if (this.ticketRefRegex && this.ticketUrlBuilder) {
      this.isActive = true;
    }
  }

  public static isAvailable() {
    return process.env.GENERIC_TICKETING_PROVIDER_REGEX && process.env.GENERIC_TICKETING_PROVIDER_URL_BUILDER;
  }

  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public static async getTicketsFromString(text: string, options = {}): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    if (!this.isAvailable) {
      return tickets;
    }
    // Extract JIRA tickets
    const ticketRefRegexExec = new RegExp(process.env.GENERIC_TICKETING_PROVIDER_REGEX, "g");
    const regexMatches = await extractRegexMatches(ticketRefRegexExec, text);
    for (const genericTicketRef of regexMatches) {
      const genericTicketUrl = process.env.GENERIC_TICKETING_PROVIDER_URL_BUILDER.replace("{REF}", genericTicketRef);
      if (!tickets.some((ticket) => ticket.url === genericTicketUrl)) {
        tickets.push({
          provider: "GENERIC",
          url: genericTicketUrl,
          id: genericTicketRef,
        });
      }
    }
    const ticketsSorted: Ticket[] = sortArray(tickets, { by: ["id"], order: ["asc"] });
    return ticketsSorted;
  }

  public getLabel(): string {
    return "sfdx-hardis Generic ticketing system connector";
  }

  public async collectTicketsInfo(tickets: Ticket[]) {
    // No remote server here so do nothing
    return tickets;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postDeploymentComments(tickets: Ticket[], _org: string, _pullRequestInfo: any) {
    // No remote server here so do nothing
    return tickets;
  }
}
