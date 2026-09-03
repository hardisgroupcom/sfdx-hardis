// Type-only: a value import here would close a runtime cycle index -> provider -> index
import type { Ticket, TicketsFromStringOptions } from "./index.js";
import sortArray from '../utils/sortArray.js';
import { extractRegexMatches } from "../utils/index.js";
import { TicketProviderRoot } from "./ticketProviderRoot.js";
import { getConfig, getEnvVar } from "../../config/index.js";
import { CommonPullRequestInfo } from "../gitProvider/index.js";

export class GenericTicketingProvider extends TicketProviderRoot {
  public static readonly providerKey = "generic" as const;
  public static readonly providerLabel = "Generic ticketing";
  // No API to call: this connector collects references and builds their URL, nothing more
  public static readonly supportsTicketDetails = false;

  private ticketRefRegex: string | null;
  private ticketUrlBuilder: string | null;

  constructor(config: any) {
    super();
    this.ticketRefRegex = getEnvVar("GENERIC_TICKETING_PROVIDER_REGEX") || config.genericTicketingProviderRegex; // Example: ([R|I][0-9]+-[0-9]+)
    this.ticketUrlBuilder = getEnvVar("GENERIC_TICKETING_PROVIDER_URL_BUILDER") || config.genericTicketingProviderUrlBuilder; // Example: https://instance.easyvista.com/index.php?ticket={REF}
    if (this.ticketRefRegex && this.ticketUrlBuilder) {
      this.isActive = true;
    }
  }

  public static isAvailable(config: any): boolean {
    return (
      getEnvVar("GENERIC_TICKETING_PROVIDER_REGEX") || config.genericTicketingProviderRegex
    ) && (
        getEnvVar("GENERIC_TICKETING_PROVIDER_URL_BUILDER") || config.genericTicketingProviderUrlBuilder
      );
  }

  public static async getTicketsFromString(text: string, options: TicketsFromStringOptions = {}): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    const config = options.config || (await getConfig("project"));
    if (!this.isAvailable(config)) {
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

  /**
   * True when the identifier is exactly what the project's own regex describes.
   *
   * Only used to route an identifier to a connector: this one never fetches a ticket
   * (`supportsTicketDetails` is false), so a match here can only ever end as "no connector able to
   * fetch this ticket is configured".
   */
  public static matchesTicketId(ticketId: string, config: any = {}): boolean {
    const ticketRefRegex = getEnvVar("GENERIC_TICKETING_PROVIDER_REGEX") || config?.genericTicketingProviderRegex;
    if (!ticketRefRegex) {
      return false;
    }
    try {
      return new RegExp(`^(?:${ticketRefRegex})$`).test((ticketId || "").trim());
    } catch {
      // A malformed project regex must not break the routing of the other connectors
      return false;
    }
  }

  public getLabel(): string {
    return "sfdx-hardis Generic ticketing system connector";
  }

  public async collectTicketsInfo(tickets: Ticket[]) {
    // No remote server here so do nothing
    return tickets;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postDeploymentComments(tickets: Ticket[], _org: string, _pullRequestInfo: CommonPullRequestInfo | null) {
    // No remote server here so do nothing
    return tickets;
  }
}
