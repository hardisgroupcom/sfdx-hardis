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
  /** Account id of the assignee (JIRA accountId, or user name on Server / Data Center; Azure identity id) */
  assigneeId: string | null;
  /** JIRA project key, or Azure Boards team project */
  project: string;
  /** Azure Boards area path; null on JIRA */
  areaPath: string | null;
}

export interface TicketSearchOptions {
  maxResults: number;
  /** Opaque cursor returned by the previous page: relayed as is, never parsed */
  pageToken?: string | null;
  /** When set, the query is bounded to these projects and any result outside them is dropped */
  allowedProjects?: string[] | null;
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

/** What the server said, rather than the generic "Request failed with status code 400" */
export function serverMessageOf(error: any): string {
  const data = error?.response?.data;
  const messages: string[] = [];
  if (Array.isArray(data?.errorMessages)) {
    messages.push(...data.errorMessages.map(String));
  }
  if (data?.errors && typeof data.errors === "object") {
    messages.push(...Object.values(data.errors).map(String));
  }
  // azure-devops-node-api: the parsed answer of the server is on result
  if (typeof error?.result?.message === "string") {
    messages.push(error.result.message);
  }
  return messages.filter(Boolean).join(" | ") || error?.message || String(error);
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
  const message = serverMessageOf(error);
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

/** JIRA writes offsets without a colon (+0200), which Date does not read everywhere */
export function toIsoDateTime(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return isNaN(date.getTime()) ? value : date.toISOString();
}

/**
 * Checked before any write: JIRA refuses a label containing whitespace, and the label is written after the
 * comment. Returns null when no label is asked for; the error is unnamed on purpose (P11).
 */
export function validateTicketLabel(label: string | null | undefined): string | null {
  if (label === undefined || label === null || label === "") {
    return null;
  }
  const trimmed = label.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    throw new SfError(t("ticketLabelInvalid", { label }));
  }
  return trimmed;
}

