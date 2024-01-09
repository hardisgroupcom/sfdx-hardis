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
    this.ticketUrlBuilder = process.env.GENERIC_TICKETING_PROVIDER_URL_BUILDER || null; // Example: https://instance.easyvista.com/index.php?
    if (this.ticketRefRegex && this.ticketUrlBuilder) {
      this.isActive = true;
    }
  }

  public static isAvailable() {
    return process.env.GENERIC_TICKETING_PROVIDER_REGEX && process.env.GENERIC_TICKETING_PROVIDER_URL_BUILDER;
  }

  public static async getTicketsFromString(text: string): Promise<Ticket[]> {
    if (!this.isAvailable) {
        return ;
    }
    const tickets: Ticket[] = [];
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
}
