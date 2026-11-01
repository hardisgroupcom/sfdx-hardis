import { SfError } from "@salesforce/core";
import { marked, Token } from "marked";
import { t } from "../../utils/i18n.js";
import { TICKET_ERROR, httpStatusOf } from "./ticketOperations.js";
import { markdownToPlainText } from "./markdownToTicketFormats.js";

/**
 * Pure helpers of the qualification options of the ticket commands: project scope, marker detection,
 * strict markdown, and the single retry on a 5xx answer. Nothing here is specific to one ticketing
 * system: what is lives in that system's provider class.
 *
 * Nothing here calls the network: the providers do, the commands decide.
 */

/** Authenticated account of a ticketing system (`sf hardis ticket whoami`) */
export interface TicketIdentity {
  id: string | null;
  displayName: string | null;
  email: string | null;
}

/** Issue types and statuses of one project (`sf hardis ticket meta`) */
export interface TicketProjectMeta {
  project: string;
  issueTypes: { id: string; name: string }[];
  statuses: { id: string; name: string }[];
  statusesByType: Record<string, string[]>;
}

export interface TicketProjectSummary {
  key: string;
  name: string;
}

/** The assignee of a ticket, read from the ticket itself: the only source a mention is built from */
export interface TicketAssignee {
  id: string | null;
  displayName: string | null;
}

/** Comment restricted to the members of a role or a group; refused by a system that cannot restrict comments */
export interface TicketCommentVisibility {
  type: "role" | "group";
  value: string;
}

export interface TicketPointsOptions {
  /** Field the points are written to, as the ticketing system names it; some systems require it */
  field?: string | null;
  overwrite?: boolean;
}

/**
 * The options of a qualification run, checked by the provider of each ticket before anything is
 * written (TicketProviderRoot.validateQualifyOptions), so that a rule of one ticketing system never
 * lives in a command.
 */
export interface TicketQualifyOptions {
  label?: string | null;
  points?: number | null;
  pointsField?: string | null;
  visibility?: TicketCommentVisibility | null;
}

/** Result of one step run after the comment: it never cancels the comment already posted */
export interface TicketStepResult {
  status: "done" | "skipped" | "failed" | "not-requested";
  value?: string | number | null;
  field?: string | null;
  reason?: string;
  error?: { name: string; message: string };
}

export const NOT_REQUESTED: TicketStepResult = { status: "not-requested" };

// ---------------------------------------------------------------------------------------------
// Project scope
// ---------------------------------------------------------------------------------------------

/** "ACME, OPS" -> ["ACME", "OPS"]; null when the flag is absent, so "no scope" stays distinct from "empty scope" */
export function parseAllowedProjects(value: string | undefined | null): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }
  const projects = String(value)
    .split(",")
    .map((project) => project.trim())
    .filter(Boolean);
  if (projects.length === 0) {
    throw new SfError(t("ticketAllowedProjectsEmpty"));
  }
  return projects;
}

/** Project keys and names are compared without case */
export function isProjectAllowed(project: string | null | undefined, allowedProjects: string[] | null): boolean {
  if (allowedProjects === null) {
    return true;
  }
  const value = String(project || "").toLowerCase();
  return value !== "" && allowedProjects.some((allowed) => allowed.toLowerCase() === value);
}

/** Refused before any write: nothing reaches a ticket outside the allowed projects */
export function assertProjectAllowed(ticketId: string, project: string | null | undefined, allowedProjects: string[] | null): void {
  if (!isProjectAllowed(project, allowedProjects)) {
    throw new SfError(
      t("ticketOutOfScope", { ticketId, project: project || "?", projects: (allowedProjects || []).join(", ") }),
      TICKET_ERROR.outOfScope
    );
  }
}

/**
 * The projects a search reads: the ones asked for, which must all be allowed, or else the allowed
 * ones. Generic: each provider then turns the projects into its own query.
 */
export function scopeSearchProjects(requested: string[] | null, allowedProjects: string[] | null): string[] | undefined {
  if (allowedProjects === null) {
    return requested?.length ? requested : undefined;
  }
  if (!requested?.length) {
    return allowedProjects;
  }
  const outside = requested.filter((project) => !isProjectAllowed(project, allowedProjects));
  if (outside.length > 0) {
    throw new SfError(
      t("ticketSearchOutOfScope", { projects: outside.join(", "), allowed: allowedProjects.join(", ") }),
      TICKET_ERROR.outOfScope
    );
  }
  return requested;
}

// ---------------------------------------------------------------------------------------------
// Marker (idempotence)
// ---------------------------------------------------------------------------------------------

/** Emoji, joiners and whitespace runs are ignored: an editor may rewrite them, the prefix stays the same */
export function normalizeMarkerText(text: string | null | undefined): string {
  return String(text || "")
    .normalize("NFC")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A ticket is marked when it carries the marker label, or when the authenticated account already
 * posted a comment starting with the prefix. Comments of other accounts never count: anyone can
 * paste the prefix.
 */
export function isTicketMarked(options: {
  labels: string[];
  comments: { authorId: string | null; body: string }[];
  myId: string | null;
  prefix?: string | null;
  label?: string | null;
}): boolean {
  const label = (options.label || "").toLowerCase();
  if (label && options.labels.some((existing) => existing.toLowerCase() === label)) {
    return true;
  }
  const prefix = normalizeMarkerText(options.prefix);
  if (!prefix || !options.myId) {
    return false;
  }
  // The providers return comments as plain text: a markdown prefix (**bold**, ## heading) is compared
  // in that form too, and in its raw form for a system that keeps the markdown
  const prefixes = [...new Set([prefix, normalizeMarkerText(markdownToPlainText(String(options.prefix)))])].filter(Boolean);
  return options.comments.some((comment) => {
    const body = normalizeMarkerText(comment.body);
    return comment.authorId === options.myId && prefixes.some((candidate) => body.startsWith(candidate));
  });
}

/** The prefix becomes the first line, never twice */
export function withCommentPrefix(body: string, prefix: string | null | undefined): string {
  if (!prefix || !prefix.trim()) {
    return body;
  }
  if (normalizeMarkerText(body).startsWith(normalizeMarkerText(prefix))) {
    return body;
  }
  return `${prefix.trim()}\n\n${body}`;
}

/** "role:Developers" or "group:developers" */
export function parseCommentVisibility(value: string | undefined | null): TicketCommentVisibility | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const match = /^(role|group):(.+)$/.exec(String(value).trim());
  if (!match || !match[2].trim()) {
    throw new SfError(t("ticketVisibilityInvalid", { value }));
  }
  return { type: match[1] as "role" | "group", value: match[2].trim() };
}

/** Story points: a plain non-negative number */
export function parseStoryPoints(value: string | undefined | null): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (!/^\d+(\.\d+)?$/.test(String(value).trim())) {
    throw new SfError(t("ticketPointsInvalid", { value }), TICKET_ERROR.pointsInvalid);
  }
  return Number(value);
}

/** What a failed step says in the JSON result: the stable name and the message, never a stack */
export function stepFailure(error: any): TicketStepResult {
  return { status: "failed", error: { name: error?.name || "Error", message: error?.message || String(error) } };
}

// ---------------------------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------------------------

/**
 * One retry, after a pause, when a read answers 5xx. Only for calls that change nothing: a write
 * answered 5xx may have been saved, and running it twice would post the comment twice.
 */
export async function retryReadOn5xx<T>(call: () => Promise<T>, delayMs = 3000): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const status = httpStatusOf(error);
    if (status === undefined || status < 500) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return call();
  }
}

// ---------------------------------------------------------------------------------------------
// Strict markdown (--strict-markdown)
// ---------------------------------------------------------------------------------------------

// Every ASCII punctuation that markdown, wiki markup or HTML could read as syntax. ":" and "." too:
// GFM turns a bare http://... or www.... into a link, brackets or not
const escapeMarkdown = (text: string) => text.replace(/[\\`*_{}[\]()#+\-.!<>|~@&:]/g, "\\$&");

function strictInline(tokens: Token[] | undefined): string {
  return ((tokens || []) as any[])
    .map((token) => {
      if (token.type === "strong") {
        return `**${strictInline(token.tokens)}**`;
      }
      if (token.type === "codespan" && !token.text.includes("`")) {
        return `\`${token.text}\``;
      }
      if (token.type === "escape") {
        return token.raw;
      }
      if (token.type === "text" && Array.isArray(token.tokens) && token.tokens.length > 0) {
        return strictInline(token.tokens);
      }
      // Links, images, raw HTML, emphasis, line breaks and plain text: kept as literal text
      return escapeMarkdown(String(token.raw ?? ""));
    })
    .join("");
}

/**
 * Markdown reduced to headings, bullet and numbered lists, paragraphs, **bold** and `code`; every
 * other construct (link, image, HTML, code block, table, quote, mention) is escaped so the regular
 * conversions render it as literal text. Text copied from a ticket can then inject nothing.
 */
export function toStrictMarkdown(markdown: string): string {
  const blocks = (marked.lexer(String(markdown ?? ""), { gfm: true }) as any[]).map((token) => {
    if (token.type === "space") {
      return "";
    }
    if (token.type === "heading") {
      return `${"#".repeat(token.depth)} ${strictInline(token.tokens)}`;
    }
    if (token.type === "paragraph" || token.type === "text") {
      return strictInline(token.tokens ?? [{ type: "text", raw: token.text }]);
    }
    if (token.type === "list") {
      return token.items
        .map((item: any, index: number) => {
          const bullet = token.ordered ? `${(Number(token.start) || 1) + index}.` : "-";
          const [first, ...rest] = item.tokens as any[];
          const head = first?.type === "text" || first?.type === "paragraph" ? strictInline(first.tokens) : escapeMarkdown(first?.raw ?? "");
          return [`${bullet} ${head}`, ...rest.map((nested: any) => `  ${escapeMarkdown(String(nested.raw ?? "").trim())}`)].join("\n");
        })
        .join("\n");
    }
    return escapeMarkdown(String(token.raw ?? "").trim());
  });
  return blocks.filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------------------------
// Mentions: always from the assignee read on the same ticket, never from the comment text. Each
// provider writes the mention in its own format; only the words before it are shared
// ---------------------------------------------------------------------------------------------

/** Words written before the mention of the assignee, in the language of the run */
export function mentionLead(): string {
  return t("ticketMentionLead") + " ";
}
