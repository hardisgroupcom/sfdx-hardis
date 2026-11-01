import { SfError } from "@salesforce/core";

import { t } from "../../utils/i18n.js";

/**
 * Names carried by SfError.name for the ticket commands.
 * Callers branch their recovery logic on these identifiers, never on the message text: the values
 * are part of the command contract and must not change.
 */
export const TICKET_ERROR = {
  providerNotConfigured: "TicketProviderNotConfigured",
  providerNotSupported: "TicketProviderNotSupported",
  queryInvalid: "TicketQueryInvalid",
  notFound: "TicketNotFound",
  rateLimited: "TicketRateLimited",
  /** The ticket belongs to a project outside --allowed-projects: nothing was written */
  outOfScope: "TicketOutOfScope",
  /** --skip-if-marked: the ticket already carries the marker label or a prefixed comment of this account */
  alreadyMarked: "TicketAlreadyMarked",
  /** The status does not exist for the type of the ticket, or the ticketing system refused the move */
  transitionInvalid: "TicketTransitionInvalid",
  /** Story points refused: not a number, no field named where the ticketing system requires one, or a value it rejected */
  pointsInvalid: "TicketPointsInvalid",
} as const;

export type TicketOperation = "list" | "comment" | "label" | "whoami" | "meta" | "transition" | "points";

/** One entry of `sf hardis ticket list` */
export interface TicketSummary {
  id: string;
  url: string;
  subject: string;
  type: string;
  status: string;
  priority: string;
  assignee: string | null;
  created: string;
  updated: string;
  labels: string[];
  /** Account id of the assignee, the same id `ticket whoami` returns */
  assigneeId: string | null;
  /** Project the ticket belongs to */
  project: string;
  /** Area or component path the ticketing system files the ticket under; null when it has none */
  areaPath: string | null;
}

export const TICKET_SEARCH_ORDER_FIELDS = ["created", "updated"] as const;
export type TicketSearchOrderField = (typeof TICKET_SEARCH_ORDER_FIELDS)[number];

/**
 * What `sf hardis ticket list` searches for, in a form every ticketing system understands. Each
 * provider converts it to its own query language inside its class: generic code never builds one.
 */
export interface TicketSearchCriteria {
  /** Projects the tickets belong to. A provider that needs one may default to its configured project */
  projects?: string[];
  /** Status names, any of them */
  statuses?: string[];
  /** Ticket type names (Bug, Story...), any of them */
  types?: string[];
  /** "me" (the authenticated account), "none" (unassigned), or the account of the assignee */
  assignee?: string | null;
  /** Labels, any of them */
  labels?: string[];
  /** Words searched in the summary and the description */
  text?: string | null;
  /** YYYY-MM-DD: created on or after that day */
  createdAfter?: string | null;
  /** YYYY-MM-DD: updated on or after that day */
  updatedAfter?: string | null;
  /** Leave out the tickets in a done status (done, closed, resolved, removed...) */
  openOnly?: boolean;
  /** created by default */
  orderBy?: TicketSearchOrderField;
  descending?: boolean;
}

/** True when the criteria filter something: an empty search would read every ticket */
export function hasSearchFilter(criteria: TicketSearchCriteria): boolean {
  return Boolean(
    criteria.projects?.length ||
      criteria.statuses?.length ||
      criteria.types?.length ||
      criteria.assignee ||
      criteria.labels?.length ||
      criteria.text ||
      criteria.createdAfter ||
      criteria.updatedAfter ||
      criteria.openOnly
  );
}

/** A calendar day, YYYY-MM-DD, that exists; null when absent */
export function parseSearchDate(value: string | null | undefined, flag: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const day = String(value).trim();
  const date = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new SfError(t("ticketSearchDateInvalid", { flag, value }), TICKET_ERROR.queryInvalid);
  }
  return day;
}

export interface TicketSearchOptions {
  maxResults: number;
  /** Opaque cursor returned by the previous page: relayed as is, never parsed */
  pageToken?: string | null;
}

export interface TicketSearchResult {
  tickets: TicketSummary[];
  nextPageToken: string | null;
  truncated: boolean;
  /** Set when nothing matched, with what to check: an empty result is often a wrong project */
  warning?: string | null;
}

export interface TicketErrorContext {
  providerLabel: string;
  operation: TicketOperation;
  ticketId?: string;
  /** What the server said, read by the provider from its own error shape. Defaults to the error message */
  serverMessage?: string;
}

const NOT_SUPPORTED_KEYS: Record<TicketOperation, string> = {
  list: "ticketListNotSupported",
  comment: "ticketCommentNotSupported",
  label: "ticketLabelNotSupported",
  whoami: "ticketWhoamiNotSupported",
  meta: "ticketMetaNotSupported",
  transition: "ticketTransitionNotSupported",
  points: "ticketPointsNotSupported",
};

export function ticketProviderNotSupported(providerLabel: string, operation: TicketOperation): SfError {
  return new SfError(t(NOT_SUPPORTED_KEYS[operation], { provider: providerLabel }), TICKET_ERROR.providerNotSupported);
}

export function httpStatusOf(error: any): number | undefined {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  return typeof status === "number" ? status : undefined;
}

function isNamedTicketError(error: any): boolean {
  return (Object.values(TICKET_ERROR) as string[]).includes(error?.name);
}

/** Turns an HTTP failure into the named error of the contract; anything else stays unnamed, with the server reason */
export function toTicketError(error: any, context: TicketErrorContext): Error {
  if (isNamedTicketError(error)) {
    return error;
  }
  const status = httpStatusOf(error);
  const message = context.serverMessage || error?.message || String(error);
  const cause = error instanceof Error ? error : undefined;
  if (status === 429) {
    return new SfError(t("ticketRateLimited", { provider: context.providerLabel }), TICKET_ERROR.rateLimited, undefined, cause);
  }
  if (status === 401) {
    return new SfError(
      t("ticketProviderCredentialsRefused", { provider: context.providerLabel, message }),
      TICKET_ERROR.providerNotConfigured,
      undefined,
      cause
    );
  }
  if (status === 400 && context.operation === "list") {
    return new SfError(t("ticketQueryInvalid", { message }), TICKET_ERROR.queryInvalid, undefined, cause);
  }
  // A move or a value the server refuses (workflow condition, validator, wrong field type, revision changed)
  if ((status === 400 || status === 409) && context.operation === "transition") {
    return new SfError(t("ticketTransitionRefused", { ticketId: context.ticketId || "", message }), TICKET_ERROR.transitionInvalid, undefined, cause);
  }
  if ((status === 400 || status === 409) && context.operation === "points") {
    return new SfError(t("ticketPointsRefused", { ticketId: context.ticketId || "", message }), TICKET_ERROR.pointsInvalid, undefined, cause);
  }
  // A 403 is a missing permission on a ticket that exists: it stays an ordinary error
  if (status === 404 && context.ticketId) {
    return new SfError(t("ticketNotFound", { ticketId: context.ticketId }), TICKET_ERROR.notFound, undefined, cause);
  }
  if (!cause) {
    return new Error(message);
  }
  // Unnamed on purpose, but with the server reason rather than "Request failed with status code 403"
  return message !== cause.message ? new SfError(message, undefined, undefined, cause) : cause;
}

/**
 * Checked before any write, since the label is written after the comment. Returns null when no label is
 * asked for; the error is unnamed on purpose. A ticketing system with stricter label rules checks them
 * in its validateQualifyOptions().
 */
export function validateTicketLabel(label: string | null | undefined): string | null {
  if (label === undefined || label === null || label === "") {
    return null;
  }
  const trimmed = label.trim();
  if (!trimmed) {
    throw new SfError(t("ticketLabelInvalid", { label }));
  }
  return trimmed;
}

