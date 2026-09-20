// Type-only: a value import here would close a runtime cycle index -> provider -> index
import type { Ticket, TicketsFromStringOptions } from "./index.js";
import c from "chalk";
import sortArray from '../utils/sortArray.js';
import { extractRegexMatches, uxLog } from "../utils/index.js";
import { recordTicketCollectionIssue, TicketProviderRoot } from "./ticketProviderRoot.js";
import { getConfig, getEnvVar } from "../../config/index.js";
import { CommonPullRequestInfo } from "../gitProvider/index.js";
import { PROVIDER_BATCH_PROFILES, mapInAdaptiveBatchesSettled } from "../utils/adaptiveBatch.js";
import { httpGet } from "../utils/httpUtils.js";
import { t } from "../utils/i18n.js";

export class GenericTicketingProvider extends TicketProviderRoot {
  public static readonly providerKey = "generic" as const;
  public static readonly providerLabel = "Generic ticketing";
  // No deep fetch: at most a subject and a status, read from genericTicketingProviderDetailsUrlBuilder
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
    // Same sources as isAvailable(): the variables first, then the project configuration.
    // Reading only the variables made a provider declared in .sfdx-hardis.yml match nothing.
    const ticketRefRegexExec = new RegExp(getEnvVar("GENERIC_TICKETING_PROVIDER_REGEX") || config.genericTicketingProviderRegex, "g");
    const regexMatches = await extractRegexMatches(ticketRefRegexExec, text);
    const ticketUrlBuilder = getEnvVar("GENERIC_TICKETING_PROVIDER_URL_BUILDER") || config.genericTicketingProviderUrlBuilder;
    for (const genericTicketRef of regexMatches) {
      const genericTicketUrl = GenericTicketingProvider.buildUrl(ticketUrlBuilder, genericTicketRef);
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

  /**
   * Fills the subject and the status of each generic ticket, when the project declares where they
   * can be read: `genericTicketingProviderDetailsUrlBuilder`, a URL with {REF} that answers a JSON
   * object per ticket, such as `{ "subject": "Crew size becomes mandatory", "status": "Done" }`.
   *
   * Without it the tickets stay bare links, as before. A ticket whose details cannot be read stays
   * a bare link too, and the Pull Request comment says why.
   */
  public async collectTicketsInfo(tickets: Ticket[]) {
    const config = await getConfig("project");
    const detailsUrlBuilder: string | null =
      getEnvVar("GENERIC_TICKETING_PROVIDER_DETAILS_URL_BUILDER") || config.genericTicketingProviderDetailsUrlBuilder || null;
    const genericTickets = tickets.filter((ticket) => ticket.provider === "GENERIC");
    if (!detailsUrlBuilder || genericTickets.length === 0) {
      return tickets;
    }
    const token = getEnvVar("GENERIC_TICKETING_PROVIDER_TOKEN");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    let failedTicketsNumber = 0;
    let firstErrorMessage = "";
    const responses = await mapInAdaptiveBatchesSettled(
      genericTickets,
      (ticket) => httpGet(GenericTicketingProvider.buildUrl(detailsUrlBuilder, ticket.id), { headers, timeout: 15000, responseType: "json" }),
      {
        sizes: PROVIDER_BATCH_PROFILES.default,
        onError: (e: any, ticket) => {
          failedTicketsNumber++;
          firstErrorMessage = firstErrorMessage || e.message;
          uxLog("log", this, c.grey("[GenericTicketingProvider] " + t("genericTicketDetailsError", { ticketId: ticket.id, message: e.message })));
        },
      }
    );
    for (const [index, ticket] of genericTickets.entries()) {
      const data = responses[index]?.data;
      if (!data) {
        continue;
      }
      const subject = GenericTicketingProvider.textField(data, ["subject", "title", "summary"]);
      if (!subject) {
        failedTicketsNumber++;
        firstErrorMessage = firstErrorMessage || `no subject or title in the answer for ${ticket.id}`;
        continue;
      }
      ticket.foundOnServer = true;
      ticket.subject = subject;
      const status = GenericTicketingProvider.textField(data, ["status"]);
      if (status) {
        ticket.status = status;
        ticket.statusLabel = GenericTicketingProvider.textField(data, ["statusLabel"]) || status;
      }
    }
    if (failedTicketsNumber > 0) {
      uxLog("warning", this, c.yellow("[GenericTicketingProvider] " + t("genericTicketDetailsCollectionFailed", {
        failed: failedTicketsNumber,
        total: genericTickets.length,
        message: firstErrorMessage,
      })));
      recordTicketCollectionIssue(
        `Details could not be retrieved for ${failedTicketsNumber} of ${genericTickets.length} ticket(s) (first error: ${firstErrorMessage}). Check genericTicketingProviderDetailsUrlBuilder.`
      );
    }
    return tickets;
  }

  /** Replaces {REF}, and the {ticketId} placeholder some projects use, by the ticket reference */
  public static buildUrl(urlBuilder: string, ticketRef: string): string {
    return urlBuilder.replace(/\{REF\}/g, ticketRef).replace(/\{ticketId\}/g, ticketRef);
  }

  private static textField(data: any, keys: string[]): string {
    if (!data || typeof data !== "object") {
      return "";
    }
    for (const key of keys) {
      if (typeof data[key] === "string" && data[key].trim() !== "") {
        return data[key].replace(/\s+/g, " ").trim();
      }
    }
    return "";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postDeploymentComments(tickets: Ticket[], _org: string, _pullRequestInfo: CommonPullRequestInfo | null) {
    // No remote server here so do nothing
    return tickets;
  }
}
