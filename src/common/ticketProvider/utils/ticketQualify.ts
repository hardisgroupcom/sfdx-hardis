import { SfError } from "@salesforce/core";
import { marked, Token } from "marked";
import { t } from "../../utils/i18n.js";
import { TICKET_ERROR, httpStatusOf } from "./ticketOperations.js";

/**
 * Pure helpers of the qualification options of the ticket commands: project scope, marker detection,
 * markdown conversion to each provider's comment format, and the single retry on a 5xx answer.
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

export interface TicketCommentVisibility {
  type: "role" | "group";
  value: string;
}

export interface TicketPointsOptions {
  /** JIRA: custom field id (customfield_NNNNN), required. Azure Boards: field reference name, optional */
  field?: string | null;
  overwrite?: boolean;
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

/** Project keys and Azure team project names are compared without case, as both systems do */
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

/** Quotes and parentheses must balance, so that a condition cannot close the project clause it is wrapped in */
export function assertBalanced(where: string): void {
  let depth = 0;
  let inQuote: string | null = null;
  for (let index = 0; index < where.length; index++) {
    const char = where[index];
    if (inQuote) {
      if (char === "\\") {
        index++;
      } else if (char === inQuote) {
        inQuote = null;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")" && --depth < 0) {
      break;
    }
  }
  if (depth !== 0 || inQuote) {
    throw new SfError(t("ticketQueryUnbalanced"), TICKET_ERROR.queryInvalid);
  }
}

const jqlString = (value: string) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Index of the first ORDER BY outside a quoted literal, or -1 */
function findOrderBy(jql: string): number {
  let inQuote: string | null = null;
  for (let index = 0; index < jql.length; index++) {
    const char = jql[index];
    if (inQuote) {
      if (char === "\\") {
        index++;
      } else if (char === inQuote) {
        inQuote = null;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if ((index === 0 || /\s/.test(jql[index - 1])) && /^ORDER\s+BY\s/i.test(jql.slice(index))) {
      return index;
    }
  }
  return -1;
}

/** JQL bounded to the allowed projects: `project in (...) AND (<query>) ORDER BY ...` */
export function scopeJql(allowedProjects: string[], jql: string): string {
  const orderIndex = findOrderBy(jql);
  const where = (orderIndex >= 0 ? jql.slice(0, orderIndex) : jql).trim();
  const order = orderIndex >= 0 ? jql.slice(orderIndex).trim() : "ORDER BY created ASC";
  assertBalanced(where);
  const projectClause = `project in (${allowedProjects.map(jqlString).join(", ")})`;
  return where ? `${projectClause} AND (${where}) ${order}` : `${projectClause} ${order}`;
}

const wiqlString = (value: string) => `'${String(value).replace(/'/g, "''")}'`;

/** A WIQL condition only: statement keywords are refused, quotes and parentheses must balance */
export function assertWiqlCondition(condition: string): string {
  const value = String(condition || "");
  if (/\b(SELECT|FROM|ORDER\s+BY|ASOF|MODE)\b/i.test(value.replace(/'(?:[^']|'')*'/g, "''"))) {
    throw new SfError(t("ticketWiqlConditionOnly"), TICKET_ERROR.queryInvalid);
  }
  assertBalanced(value);
  return value.trim();
}

/** Full WIQL statement bounded to the team projects */
export function scopeWiql(projects: string[], condition: string): string {
  const where = assertWiqlCondition(condition);
  const projectClause = `[System.TeamProject] IN (${projects.map(wiqlString).join(", ")})`;
  const fullWhere = where ? `${projectClause} AND (${where})` : projectClause;
  return `SELECT [System.Id] FROM WorkItems WHERE ${fullWhere} ORDER BY [System.CreatedDate] ASC`;
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
  return options.comments.some(
    (comment) => comment.authorId === options.myId && normalizeMarkerText(comment.body).startsWith(prefix)
  );
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

/** "role:Developers" or "group:jira-users" */
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

/** Azure Boards tags: "a; b ;c" -> ["a", "b", "c"] */
export function splitTags(tags: string | null | undefined): string[] {
  return String(tags || "")
    .split(";")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** Story points: a plain non-negative number */
export function parseStoryPoints(value: string | undefined | null): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (!/^\d+(\.\d+)?$/.test(String(value).trim())) {
    throw new SfError(t("ticketPointsInvalid", { value }));
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

// Azure DevOps comment CSS drops block margins: an empty line, written as its own editor writes one,
// goes before every heading but the first
export function withHtmlHeadingSpacers(html: string): string {
  let headings = 0;
  return html.replace(/<h[1-6]>/g, (tag) => (headings++ === 0 ? tag : `<div><br></div>${tag}`));
}

// HTML-escaped, @ included: the display name of a mention cannot inject markup
export const escapeHtml = (text: string) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/@/g, "&#64;");

// ---------------------------------------------------------------------------------------------
// Mentions: always from the assignee read on the same ticket, never from the comment text
// ---------------------------------------------------------------------------------------------

export const MENTION_LEAD = "Pour : ";

const JIRA_CLOUD_ACCOUNT_RE = /^[A-Za-z0-9:_-]+$/;
const JIRA_SERVER_NAME_RE = /^[A-Za-z0-9._@+-]+$/;
const AZURE_GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Inserted right after the first block (the prefix). A malformed account id is dropped */
export function withAdfMention(doc: any, assignee: TicketAssignee | null | undefined): any {
  if (!assignee || !JIRA_CLOUD_ACCOUNT_RE.test(assignee.id || "")) {
    return doc;
  }
  const line = {
    type: "paragraph",
    content: [{ type: "text", text: MENTION_LEAD }, { type: "mention", attrs: { id: assignee.id, text: `@${assignee.displayName || ""}` } }],
  };
  return { ...doc, content: [...doc.content.slice(0, 1), line, ...doc.content.slice(1)] };
}

export function withWikiMention(wiki: string, assignee: TicketAssignee | null | undefined): string {
  if (!assignee || !JIRA_SERVER_NAME_RE.test(assignee.id || "")) {
    return wiki;
  }
  const blocks = wiki.split("\n\n");
  blocks.splice(1, 0, `${MENTION_LEAD}[~${assignee.id}]`);
  return blocks.join("\n\n");
}

export function withHtmlMention(html: string, assignee: TicketAssignee | null | undefined): string {
  if (!assignee || !AZURE_GUID_RE.test(assignee.id || "")) {
    return html;
  }
  const line = `<p>${MENTION_LEAD}<a href="#" data-vss-mention="version:2.0,${assignee.id}">@${escapeHtml(assignee.displayName || "")}</a></p>`;
  const end = html.search(/<\/(p|h\d|ul|ol)>/);
  if (end < 0) {
    return line + html;
  }
  const close = html.indexOf(">", end) + 1;
  return html.slice(0, close) + line + html.slice(close);
}
