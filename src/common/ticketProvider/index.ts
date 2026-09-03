import c from "chalk";
import sortArray from '../utils/sortArray.js';
import { JiraProvider } from "./jiraProvider.js";
import { clearTicketCollectionIssues, TicketProviderRoot } from "./ticketProviderRoot.js";
import { uxLog } from "../utils/index.js";
import { GenericTicketingProvider } from "./genericProvider.js";
import { AzureBoardsProvider } from "./azureBoardsProvider.js";
import { CommonPullRequestInfo } from "../gitProvider/index.js";
import { getConfig } from "../../config/index.js";
import { t } from '../utils/i18n.js';
import { SfError } from "@salesforce/core";
import { ServiceNowProvider } from "./serviceNowProvider.js";
import { TicketDetails, TicketDetailsOptions } from "./ticketDetails.js";

export const allTicketProviders = [JiraProvider, GenericTicketingProvider, AzureBoardsProvider];

/**
 * Providers able to answer a deep, single-ticket fetch (`sf hardis ticket get`).
 *
 * Deliberately a separate list from `allTicketProviders`: that one drives what is collected on every
 * pull request, and adding a provider to it changes the content of existing PR comments and release
 * notes. Deep fetch is opt-in per invocation, so a new connector can land here without touching the
 * behavior of projects that already use the bulk flows.
 */
export const ticketDetailsProviders: TicketDetailsProviderDescriptor[] = [
  { key: "jira", label: "JIRA", providerClass: JiraProvider },
  { key: "azure", label: "Azure Boards", providerClass: AzureBoardsProvider },
  { key: "servicenow", label: "ServiceNow", providerClass: ServiceNowProvider },
];

export type TicketDetailsProviderKey = "jira" | "azure" | "servicenow";

/**
 * Static surface a deep-fetch connector exposes to `getTicketDetails`.
 *
 * `autoDetectFromGitRemote` is optional: only Azure Boards can complete its own configuration, by
 * reading the organization and the project from the git remote.
 */
export type TicketDetailsProviderClass = {
  new(config: any): TicketProviderRoot;
  isAvailable(config: any): boolean;
  matchesTicketId(ticketId: string): boolean;
  autoDetectFromGitRemote?: () => Promise<void>;
};

export interface TicketDetailsProviderDescriptor {
  key: TicketDetailsProviderKey;
  label: string;
  providerClass: TicketDetailsProviderClass;
}

export abstract class TicketProvider {
  static getInstances(config: any): TicketProviderRoot[] {
    const ticketProviders: TicketProviderRoot[] = [];
    for (const provider of allTicketProviders) {
      if (provider.isAvailable(config)) {
        ticketProviders.push(new provider(config));
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
    clearTicketCollectionIssues();
    const config = await getConfig("project");
    const ticketProviders = this.getInstances(config);
    if (ticketProviders.length === 0) {
      uxLog("error", this, c.grey('[TicketProvider] ' + t('ticketProviderNotConfigured')));
    }
    for (const ticketProvider of ticketProviders) {
      if (ticketProvider.isActive) {
        await ticketProvider.collectTicketsInfo(tickets);
      }
    }
    return tickets;
  }

  /**
   * Deep fetch of a single ticket, with its description, comments, links and attachments.
   *
   * The provider is deduced from the shape of the identifier (PROJ-123 -> JIRA, 1234 / AB-1234 ->
   * Azure Boards, INC0012345 -> ServiceNow) unless `providerKey` forces one. Throws a explicit
   * SfError rather than returning null when nothing can handle the identifier, so the caller can
   * report which variables are missing instead of an empty result.
   */
  public static async getTicketDetails(
    ticketId: string,
    options: TicketDetailsOptions & { providerKey?: TicketDetailsProviderKey } = {}
  ): Promise<TicketDetails | null> {
    const config = await getConfig("project");
    const trimmedId = (ticketId || "").trim();
    const shapeMatches = ticketDetailsProviders.filter((descriptor) =>
      options.providerKey ? descriptor.key === options.providerKey : descriptor.providerClass.matchesTicketId(trimmedId)
    );
    if (shapeMatches.length === 0) {
      throw new SfError(t('ticketDetailsUnknownIdShape', { ticketId: trimmedId }));
    }
    // A provider may be able to complete its own configuration (Azure Boards reads the organization
    // and the project from the git remote). Runs before isAvailable(), which is synchronous and
    // cannot look at the remote itself. Only the candidates matching the identifier are prepared,
    // so a JIRA key never triggers a git call.
    for (const descriptor of shapeMatches) {
      if (descriptor.providerClass.autoDetectFromGitRemote) {
        await descriptor.providerClass.autoDetectFromGitRemote();
      }
    }
    const available = shapeMatches.filter((descriptor) => descriptor.providerClass.isAvailable(config));
    if (available.length === 0) {
      throw new SfError(
        t('ticketDetailsProviderNotConfigured', {
          ticketId: trimmedId,
          providers: shapeMatches.map((descriptor) => descriptor.label).join(", "),
        })
      );
    }
    if (available.length > 1) {
      throw new SfError(
        t('ticketDetailsAmbiguousProvider', {
          ticketId: trimmedId,
          providers: available.map((descriptor) => descriptor.key).join(", "),
        })
      );
    }
    const descriptor = available[0];
    const provider = new descriptor.providerClass(config);
    uxLog("action", this, c.cyan('[TicketProvider] ' + t('ticketDetailsFetching', { ticketId: trimmedId, provider: descriptor.label })));
    return provider.getTicketDetails(trimmedId, options);
  }

  // Process Ticket providers actions after a deployment.
  // Can be comments on JIRA, and maybe later status changes ? 😊
  public static async postDeploymentActions(tickets: Ticket[], org: string, pullRequestInfo: CommonPullRequestInfo | null) {
    const config = await getConfig("project");
    const ticketProviders = this.getInstances(config);
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
  author?: string;
  authorLabel?: string;
  assignee?: string;
  assigneeLabel?: string;
  reporter?: string;
  reporterLabel?: string;
  foundOnServer?: boolean;
}
