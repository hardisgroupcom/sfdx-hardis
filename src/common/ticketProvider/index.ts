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

export type TicketProviderKey = "jira" | "azure" | "servicenow" | "generic";

/**
 * Options handed to every `getTicketsFromString()`.
 *
 * `config` is read once by the caller and passed down, so scanning a Pull Request does not re-read
 * the project configuration once per connector.
 */
export interface TicketsFromStringOptions {
  pullRequestInfo?: CommonPullRequestInfo | null;
  commits?: any[];
  config?: any;
}

/**
 * Static surface every ticketing connector exposes.
 *
 * All of them are declared the same way and live in the same list: what differs between two
 * connectors is the value of their flags, never the shape of their class. `supportsTicketDetails`
 * is the only capability that is not universal - the generic connector has no API to call, so it
 * can collect references but never fetch a ticket in full.
 */
export type TicketProviderClass = {
  new(config: any): TicketProviderRoot;
  providerKey: TicketProviderKey;
  providerLabel: string;
  supportsTicketDetails: boolean;
  isAvailable(config: any): boolean;
  matchesTicketId(ticketId: string, config?: any): boolean;
  getTicketsFromString(text: string, options: TicketsFromStringOptions): Promise<Ticket[]>;
  /** Only implemented by connectors able to complete their own configuration from the git remote */
  autoDetectFromGitRemote?: () => Promise<void>;
};

export const allTicketProviders: TicketProviderClass[] = [
  JiraProvider,
  GenericTicketingProvider,
  AzureBoardsProvider,
  ServiceNowProvider,
];

/** Connectors `sf hardis ticket get` can fetch a full ticket from */
export function ticketDetailsProviderKeys(): TicketProviderKey[] {
  return allTicketProviders.filter((provider) => provider.supportsTicketDetails).map((provider) => provider.providerKey);
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
  public static async getProvidersTicketsFromString(text: string, options: TicketsFromStringOptions = {}): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    const optionsWithConfig: TicketsFromStringOptions = { ...options, config: options.config || (await getConfig("project")) };
    for (const ticketProvider of allTicketProviders) {
      const providerTickets = await ticketProvider.getTicketsFromString(text, optionsWithConfig);
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
   * Azure Boards, INC0012345 -> ServiceNow) unless `providerKey` forces one. Throws an explicit
   * SfError rather than returning null when nothing can handle the identifier, so the caller can
   * report which variables are missing instead of an empty result.
   */
  public static async getTicketDetails(
    ticketId: string,
    options: TicketDetailsOptions & { providerKey?: TicketProviderKey } = {}
  ): Promise<TicketDetails | null> {
    const config = await getConfig("project");
    const trimmedId = (ticketId || "").trim();
    const shapeMatches = allTicketProviders.filter(
      (provider) =>
        provider.supportsTicketDetails &&
        (options.providerKey ? provider.providerKey === options.providerKey : provider.matchesTicketId(trimmedId, config))
    );
    if (shapeMatches.length === 0) {
      throw new SfError(t('ticketDetailsUnknownIdShape', { ticketId: trimmedId }));
    }
    // A provider may be able to complete its own configuration (Azure Boards reads the organization
    // and the project from the git remote). Runs before isAvailable(), which is synchronous and
    // cannot look at the remote itself. Only the candidates matching the identifier are prepared,
    // so a JIRA key never triggers a git call.
    for (const provider of shapeMatches) {
      if (provider.autoDetectFromGitRemote) {
        await provider.autoDetectFromGitRemote();
      }
    }
    const available = shapeMatches.filter((provider) => provider.isAvailable(config));
    if (available.length === 0) {
      throw new SfError(
        t('ticketDetailsProviderNotConfigured', {
          ticketId: trimmedId,
          providers: shapeMatches.map((provider) => provider.providerLabel).join(", "),
        })
      );
    }
    if (available.length > 1) {
      throw new SfError(
        t('ticketDetailsAmbiguousProvider', {
          ticketId: trimmedId,
          providers: available.map((provider) => provider.providerKey).join(", "),
        })
      );
    }
    const providerClass = available[0];
    const provider = new providerClass(config);
    uxLog("action", this, c.cyan('[TicketProvider] ' + t('ticketDetailsFetching', { ticketId: trimmedId, provider: providerClass.providerLabel })));
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
  provider: "JIRA" | "AZURE" | "GENERIC" | "SERVICENOW";
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
  /**
   * Internal identifier of the record in its ticketing system, when it differs from the reference
   * displayed to humans (a ServiceNow sys_id, where the ticket is referenced by its number).
   * Collected once, so posting the deployment comment does not need a second lookup.
   */
  providerRecordId?: string;
}
