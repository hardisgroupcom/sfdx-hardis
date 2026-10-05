import c from "chalk";
import sortArray from '../utils/sortArray.js';
import { JIRA_HOST_PLACEHOLDER, JiraProvider } from "./jiraProvider.js";
import { clearTicketCollectionIssues, TicketProviderRoot } from "./ticketProviderRoot.js";
import { uxLog } from "../utils/index.js";
import { GenericTicketingProvider } from "./genericProvider.js";
import { AzureBoardsProvider } from "./azureBoardsProvider.js";
import { CommonPullRequestInfo } from "../gitProvider/index.js";
import { getConfig } from "../../config/index.js";
import { t } from '../utils/i18n.js';
import { SfError } from "@salesforce/core";
import { ServiceNowProvider } from "./serviceNowProvider.js";
import { AhaProvider } from "./ahaProvider.js";
import { TicketDetails, TicketDetailsOptions } from "./ticketDetails.js";

export type TicketProviderKey = "jira" | "azure" | "servicenow" | "aha" | "generic";

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
  /**
   * True for a connector that only reads references when `ticketingProvider` names it. Needed by a
   * connector whose references look like those of another one (PROJ-123 is a JIRA key and an Aha!
   * feature): without a declared provider, the references stay with the connectors that always run.
   */
  onlyWhenDeclared?: boolean;
};

export const allTicketProviders: TicketProviderClass[] = [
  JiraProvider,
  GenericTicketingProvider,
  AzureBoardsProvider,
  ServiceNowProvider,
  AhaProvider,
];

/** Connectors `sf hardis ticket get` can fetch a full ticket from */
export function ticketDetailsProviderKeys(): TicketProviderKey[] {
  return allTicketProviders.filter((provider) => provider.supportsTicketDetails).map((provider) => provider.providerKey);
}

/**
 * The connectors that read the references of a project.
 *
 * `ticketingProvider` set in .sfdx-hardis.yml: the connector it names, and no other. Not set: every
 * connector except those that only run when declared, which is where a PROJ-123 reference is a JIRA
 * key by default.
 */
export function activeTicketProviders(config: any = {}): TicketProviderClass[] {
  const declared = String(config?.ticketingProvider || "").toUpperCase();
  const named = declared ? allTicketProviders.filter((provider) => provider.providerKey.toUpperCase() === declared) : [];
  return named.length > 0 ? named : allTicketProviders.filter((provider) => !provider.onlyWhenDeclared);
}

export abstract class TicketProvider {
  // The connectors left out by ticketingProvider are named once per run, not once per Pull Request
  private static skippedProvidersReported = false;

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
    const activeProviders = activeTicketProviders(optionsWithConfig.config);
    this.reportSkippedProviders(optionsWithConfig.config, activeProviders);
    for (const ticketProvider of activeProviders) {
      const providerTickets = await ticketProvider.getTicketsFromString(text, optionsWithConfig);
      tickets.push(...providerTickets);
    }
    // JIRA recognizes any PROJ-123 identifier, even with no JIRA host configured, and then links
    // it to a placeholder host. When another provider claims the same identifier with a real URL,
    // that one is the ticket: the placeholder would only add a dead link next to it. And when the
    // project declares another ticketing system, a placeholder is never a ticket: it is a release
    // name or a date ("Release 2026-09") that happens to have the shape of a JIRA key.
    // Only a ticketing system the project itself declares counts here. Azure
    // Boards, for one, reports itself available from the SYSTEM_* variables an
    // Azure DevOps pipeline sets by itself: a team running there while tracking
    // its work in JIRA would otherwise lose every JIRA reference, silently,
    // for the single reason that JIRA_HOST is not set yet.
    const otherProviderConfigured = GenericTicketingProvider.isAvailable(optionsWithConfig.config);
    const withoutPlaceholders = tickets.filter(
      (ticket) =>
        !(
          ticket.provider === "JIRA" &&
          ticket.url?.startsWith(JIRA_HOST_PLACEHOLDER) &&
          (otherProviderConfigured ||
            tickets.some((other) => other !== ticket && other.id === ticket.id && other.provider !== "JIRA"))
        )
    );
    const ticketsSorted: Ticket[] = sortArray(withoutPlaceholders, { by: ["id"], order: ["asc"] });
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
   * The provider is deduced from the shape of the identifier (PROJ-123 -> JIRA, or the connector
   * `ticketingProvider` names when it recognizes that shape too, 1234 / AB-1234 -> Azure Boards,
   * INC0012345 -> ServiceNow) unless `providerKey` forces one. Throws an explicit
   * SfError rather than returning null when nothing can handle the identifier, so the caller can
   * report which variables are missing instead of an empty result.
   */
  public static async getTicketDetails(
    ticketId: string,
    options: TicketDetailsOptions & { providerKey?: TicketProviderKey } = {}
  ): Promise<TicketDetails | null> {
    const config = await getConfig("project");
    const trimmedId = (ticketId || "").trim();
    const detailsProviders = allTicketProviders.filter((provider) => provider.supportsTicketDetails);
    let shapeMatches = detailsProviders.filter((provider) =>
      options.providerKey ? provider.providerKey === options.providerKey : provider.matchesTicketId(trimmedId, config)
    );
    if (!options.providerKey) {
      // Several connectors can recognize the same identifier: the ones reading the references of
      // the project come first. An identifier none of them recognizes (a ServiceNow number typed in
      // a JIRA project) is still routed by its shape, among the connectors that always run.
      const active = activeTicketProviders(config);
      const activeMatches = shapeMatches.filter((provider) => active.includes(provider));
      shapeMatches = activeMatches.length > 0 ? activeMatches : shapeMatches.filter((provider) => !provider.onlyWhenDeclared);
    }
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

  /**
   * A connector whose variables are defined, and that `ticketingProvider` leaves out, finds no
   * ticket anymore: say which ones, so missing references are not a mystery.
   */
  private static reportSkippedProviders(config: any, activeProviders: TicketProviderClass[]): void {
    if (this.skippedProvidersReported || !config?.ticketingProvider) {
      return;
    }
    this.skippedProvidersReported = true;
    const skipped = allTicketProviders.filter((provider) => !activeProviders.includes(provider) && provider.isAvailable(config));
    if (skipped.length > 0) {
      uxLog("log", this, c.grey('[TicketProvider] ' + t('ticketProvidersSkipped', {
        declared: config.ticketingProvider,
        skipped: skipped.map((provider) => provider.providerLabel).join(", "),
      })));
    }
  }
}

export interface Ticket {
  provider: "JIRA" | "AZURE" | "GENERIC" | "SERVICENOW" | "AHA";
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
