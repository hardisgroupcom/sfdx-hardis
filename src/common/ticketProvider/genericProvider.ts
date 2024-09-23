import { Ticket } from "./index.js";
import sortArray from "sort-array";
import { extractRegexMatches } from "../utils/index.js";
import { TicketProviderRoot } from "./ticketProviderRoot.js";
import { getEnvVar } from "../../config/index.js";

export class GenericTicketingProvider extends TicketProviderRoot {
  private ticketRefRegex: string | null;
  private ticketUrlBuilder: string | null;

  constructor() {
    super();
    this.ticketRefRegex = getEnvVar("GENERIC_TICKETING_PROVIDER_REGEX"); // Example: ([R|I][0-9]+-[0-9]+)
    this.ticketUrlBuilder = getEnvVar("GENERIC_TICKETING_PROVIDER_URL_BUILDER"); // Example: https://instance.easyvista.com/index.php?ticket={REF}
    if (this.ticketRefRegex && this.ticketUrlBuilder) {
      this.isActive = true;
    }
  }

  public static isAvailable() {
    return getEnvVar("GENERIC_TICKETING_PROVIDER_REGEX") && getEnvVar("GENERIC_TICKETING_PROVIDER_URL_BUILDER");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public static async getTicketsFromString(text: string, options = {}): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    if (!this.isAvailable()) {
      return tickets;
    }
    // Extract tickets using GENERIC_TICKETING_PROVIDER_REGEX regexp
    const ticketRefRegexExec = new RegExp(getEnvVar("GENERIC_TICKETING_PROVIDER_REGEX") || "", "g");
    const regexMatches = await extractRegexMatches(ticketRefRegexExec, text);
    const ticketUrlBuilder = getEnvVar("GENERIC_TICKETING_PROVIDER_URL_BUILDER") || "";
    for (const genericTicketRef of regexMatches) {
      const genericTicketUrl = ticketUrlBuilder.replace("{REF}", genericTicketRef);
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
