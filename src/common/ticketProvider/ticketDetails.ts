// Deep, provider-agnostic view of a single ticket: everything an agent (or a human report) needs
// to understand a user story without opening the ticketing system.
//
// The Ticket type of index.ts stays what it is: a light reference collected in bulk for pull request
// comments and release notes. TicketDetails is the opposite trade-off - one ticket, every field,
// comments, links and attachments included.
//
// Security note: this module is the single place where ticket-controlled data (attachment URLs and
// file names) is turned into network calls and files on disk. The guards therefore live here rather
// than in each provider: same-host enforcement, download size cap, file name sanitization, and no
// sub-process is ever spawned on downloaded content.
import * as path from 'path';
import sanitizeHtml from 'sanitize-html';
import fs from '../utils/fsUtils.js';
import { proxyFetch } from '../utils/httpUtils.js';

export const TICKET_ATTACHMENT_MAX_BYTES_DEFAULT = 20 * 1024 * 1024; // 20 MB
/** A comment body longer than this is truncated: a single pasted log must not blow up the payload */
export const TICKET_TEXT_MAX_CHARS = 200_000;

export type TicketDetailsProvider = 'JIRA' | 'AZURE' | 'SERVICENOW';

/**
 * How the attachment can be consumed downstream:
 * - `text`: converted to text in `textContent`
 * - `image`: saved to disk, ready for a vision-capable reader
 * - `document`: saved to disk, readable by a tool that understands the format (PDF, Office...)
 * - `binary`: saved to disk, no text extraction attempted
 */
export type TicketAttachmentKind = 'text' | 'image' | 'document' | 'binary';

export interface TicketAttachment {
  filename: string;
  contentType: string;
  size: number;
  created: string;
  author: string;
  url: string;
  kind: TicketAttachmentKind;
  /** Absolute path of the downloaded file, or null when the download was skipped or failed */
  localPath: string | null;
  /** Text content, only for `text` attachments */
  textContent: string | null;
  truncated: boolean;
  error: string | null;
}

export interface TicketCommentDetail {
  author: string;
  date: string;
  body: string;
}

/** A subtask, a linked issue, a parent, or a related record of another table */
export interface TicketRelatedItem {
  relation: string;
  id: string;
  title: string;
  status: string;
  url: string;
}

export interface TicketDetails {
  provider: TicketDetailsProvider;
  id: string;
  url: string;
  subject: string;
  type: string;
  status: string;
  priority: string;
  assignee: string;
  reporter: string;
  created: string;
  updated: string;
  resolved: string;
  sprint: string;
  storyPoints: string;
  parent: string;
  epic: string;
  labels: string[];
  components: string[];
  fixVersions: string[];
  description: string;
  acceptanceCriteria: string;
  comments: TicketCommentDetail[];
  commentsTruncated: boolean;
  subtasks: TicketRelatedItem[];
  links: TicketRelatedItem[];
  attachments: TicketAttachment[];
  attachmentsDir: string | null;
  /** Lines of the ticket hinting at an operation that will not be carried by deployable metadata */
  manualActions: string[];
  /** Provider-specific fields that have no place in the common shape */
  extra: Record<string, any>;
}

export interface TicketDetailsOptions {
  /** false: attachment metadata is collected but nothing is downloaded */
  downloadAttachments?: boolean;
  /** Directory the attachments are saved into (created if missing) */
  attachmentsDir?: string;
  maxAttachmentBytes?: number;
}

export function newTicketDetails(provider: TicketDetailsProvider, id: string): TicketDetails {
  return {
    provider,
    id,
    url: '',
    subject: '',
    type: '',
    status: '',
    priority: '',
    assignee: '',
    reporter: '',
    created: '',
    updated: '',
    resolved: '',
    sprint: '',
    storyPoints: '',
    parent: '',
    epic: '',
    labels: [],
    components: [],
    fixVersions: [],
    description: '',
    acceptanceCriteria: '',
    comments: [],
    commentsTruncated: false,
    subtasks: [],
    links: [],
    attachments: [],
    attachmentsDir: null,
    manualActions: [],
    extra: {},
  };
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

// Block-level tags whose boundaries carry meaning once the markup is gone
const HTML_BLOCK_TAGS = ['p', 'div', 'br', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'];

/**
 * Turns the HTML returned by Jira renderedFields, Azure Boards fields or ServiceNow journals into
 * readable plain text. sanitize-html does the stripping (rather than a regex) so that a crafted
 * ticket body cannot smuggle markup through, and entities are decoded correctly.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) {
    return '';
  }
  // Mark the block boundaries before the tags are removed, else everything collapses on one line
  let marked = String(html);
  marked = marked.replace(/<\/(td|th)>/gi, ' | ');
  for (const tag of HTML_BLOCK_TAGS) {
    marked = marked.replace(new RegExp(`</?${tag}(\\s[^>]*)?/?>`, 'gi'), '\n');
  }
  const text = sanitizeHtml(marked, { allowedTags: [], allowedAttributes: {}, disallowedTagsMode: 'discard' });
  return normalizeText(decodeHtmlEntities(text));
}

/**
 * sanitize-html escapes the text it keeps, so `&` comes back as `&amp;`. The result is plain text
 * that is never re-inserted into HTML, so decoding it back is what the reader expects.
 * `&amp;` is decoded last, otherwise `&amp;lt;` would wrongly become `<`.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Collapses the runs of blank lines and trailing spaces left by the conversions */
export function normalizeText(text: string | null | undefined): string {
  if (!text) {
    return '';
  }
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Caps a free-text field so one pasted log cannot dominate the payload */
export function capText(text: string, maxChars: number = TICKET_TEXT_MAX_CHARS): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars) + `\n\n[... truncated at ${maxChars} characters]`;
}

// Keywords hinting at an operation that deployable metadata will not carry, and that therefore
// needs an sfdx-hardis deployment action to be replayed in every org. French + English, because
// tickets are written in the language of the project.
const MANUAL_ACTION_KEYWORDS = [
  // French
  'action manuelle', 'actions manuelles', 'manuellement', 'étape manuelle', 'déploiement manuel',
  'à configurer', 'à paramétrer', 'à activer', 'à désactiver', 'à créer', 'à renseigner', 'à saisir',
  'post-déploiement', 'post déploiement', 'après déploiement', 'après livraison',
  'configuration requise', 'paramétrage',
  'named credential', 'identifiant', 'mot de passe',
  'custom metadata', 'métadonnée personnalisée',
  'permission set', "ensemble d'autorisations", 'habilitation',
  'migration de données', 'chargement de données',
  'job planifié', 'tâche planifiée',
  // English
  'manual action', 'manual step', 'manually', 'post-deploy', 'post deploy',
  'configuration required', 'setup required',
  'assign permission', 'permission set assignment',
  'schedule job', 'scheduled job', 'data migration',
];

/**
 * Surfaces the lines of the ticket that mention a non-deployable operation, so the planning phase
 * can turn them into sfdx-hardis deployment actions instead of discovering them at promotion time.
 */
export function detectManualActions(texts: (string | null | undefined)[], maxHits = 20): string[] {
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) {
      continue;
    }
    for (const rawLine of String(text).split('\n')) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      const lowerLine = line.toLowerCase();
      if (!MANUAL_ACTION_KEYWORDS.some((keyword) => lowerLine.includes(keyword))) {
        continue;
      }
      const capped = line.length > 300 ? line.slice(0, 300) + '...' : line;
      if (seen.has(capped)) {
        continue;
      }
      seen.add(capped);
      hits.push(capped);
      if (hits.length >= maxHits) {
        return hits;
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.xml', '.yml', '.yaml', '.log', '.html', '.htm', '.apex', '.cls', '.js', '.ts', '.sql'];
const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp'];

export function classifyAttachment(contentType: string, filename: string): TicketAttachmentKind {
  const type = (contentType || '').toLowerCase().split(';')[0].trim();
  const ext = path.extname(filename || '').toLowerCase();
  if (IMAGE_CONTENT_TYPES.includes(type) || IMAGE_EXTENSIONS.includes(ext)) {
    return 'image';
  }
  if (type.startsWith('text/') || type === 'application/json' || type === 'application/xml' || TEXT_EXTENSIONS.includes(ext)) {
    return 'text';
  }
  if (
    type === 'application/pdf' ||
    type.includes('officedocument') ||
    type.includes('msword') ||
    type.includes('ms-excel') ||
    DOCUMENT_EXTENSIONS.includes(ext)
  ) {
    return 'document';
  }
  return 'binary';
}

// Characters that must never reach the filesystem from a ticket-supplied name: control characters,
// path separators, and the set Windows reserves. Written as an explicit scan rather than a regex
// range, so no escaping subtlety can silently widen or narrow the set.
const WINDOWS_RESERVED_FILENAME_CHARS = '<>:"/\\|?*';

function stripUnsafeFilenameChars(name: string): string {
  let out = '';
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    const unsafe = code < 0x20 || code === 0x7f || WINDOWS_RESERVED_FILENAME_CHARS.includes(char);
    out += unsafe ? '_' : char;
  }
  return out;
}

/**
 * Makes a ticket-supplied file name safe to join to a directory: no traversal, no separator, no
 * control character, no reserved Windows name, bounded length.
 */
export function sanitizeAttachmentFileName(filename: string, fallback: string): string {
  const base = path.basename(String(filename || '').replace(/\\/g, '/'));
  let safe = stripUnsafeFilenameChars(base).replace(/^\.+/, '').trim();
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(safe)) {
    safe = '_' + safe;
  }
  if (!safe) {
    safe = fallback;
  }
  if (safe.length > 120) {
    const ext = path.extname(safe).slice(0, 12);
    safe = safe.slice(0, 120 - ext.length) + ext;
  }
  return safe;
}

/**
 * True when the attachment URL points at the same host as the ticketing instance we authenticated
 * against. A ticket payload is attacker-influenced data: without this check, a crafted attachment
 * link would make the CLI send the ticketing credentials to an arbitrary host.
 */
export function isSameHost(attachmentUrl: string, baseUrl: string): boolean {
  try {
    const attachment = new URL(attachmentUrl);
    const base = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`);
    if (attachment.protocol !== 'https:' && attachment.protocol !== 'http:') {
      return false;
    }
    return attachment.host.toLowerCase() === base.host.toLowerCase();
  } catch {
    return false;
  }
}

/** Reads at most maxBytes from the response body, so a huge attachment cannot exhaust the heap */
async function readCapped(response: any, maxBytes: number): Promise<{ buffer: Buffer; truncated: boolean }> {
  const body: any = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const all = Buffer.from(await response.arrayBuffer());
    return all.length > maxBytes ? { buffer: all.subarray(0, maxBytes), truncated: true } : { buffer: all, truncated: false };
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const chunk = Buffer.from(value);
    if (total + chunk.length > maxBytes) {
      chunks.push(chunk.subarray(0, maxBytes - total));
      truncated = true;
      try {
        await reader.cancel();
      } catch {
        // The stream is already being torn down: nothing more to do
      }
      break;
    }
    chunks.push(chunk);
    total += chunk.length;
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

export interface DownloadAttachmentInput {
  attachment: TicketAttachment;
  /** Base URL of the ticketing instance: the attachment URL must resolve to the same host */
  baseUrl: string;
  headers: Record<string, string>;
  targetDir: string;
  maxBytes: number;
  /** Prefix added to the file name to keep two same-named attachments apart */
  index: number;
}

/**
 * Downloads one attachment into targetDir and fills in localPath / textContent / truncated / error.
 * Never throws: a failing attachment records its error and the others keep going.
 *
 * Binary and document attachments are saved as-is and never handed to an external converter - the
 * caller reads them with its own tooling. Converting a PDF or a Word document is a choice with its
 * own dependencies (markitdown, pandoc...); making it here would impose them on every command that
 * touches a ticket, and would spawn a sub-process on attacker-influenced content inside the
 * credential-handling path. The caller converts what it needs, from a file that is already on disk.
 */
export async function downloadTicketAttachment(input: DownloadAttachmentInput): Promise<TicketAttachment> {
  const { attachment, baseUrl, headers, targetDir, maxBytes, index } = input;
  if (!attachment.url) {
    attachment.error = 'No download URL provided by the ticketing system';
    return attachment;
  }
  if (!isSameHost(attachment.url, baseUrl)) {
    // Credentials are about to be sent: refuse anything that is not the instance we authenticated to
    attachment.error = `Refused: attachment URL host does not match the ticketing instance (${attachment.url})`;
    return attachment;
  }
  try {
    const response: any = await proxyFetch(attachment.url, { method: 'GET', headers });
    if (!response.ok) {
      attachment.error = `Download failed with status ${response.status}`;
      return attachment;
    }
    const { buffer, truncated } = await readCapped(response, maxBytes);
    attachment.truncated = truncated;
    if (!attachment.size) {
      attachment.size = buffer.length;
    }
    await fs.ensureDir(targetDir);
    const safeName = sanitizeAttachmentFileName(attachment.filename, `attachment-${index}`);
    const localPath = path.resolve(targetDir, `${index}-${safeName}`);
    // Defense in depth: even a sanitized name must not escape the target directory
    if (!localPath.startsWith(path.resolve(targetDir) + path.sep)) {
      attachment.error = 'Refused: attachment file name resolves outside the target directory';
      return attachment;
    }
    await fs.outputFile(localPath, buffer);
    attachment.localPath = localPath;
    if (attachment.kind === 'text') {
      const raw = buffer.toString('utf8');
      const asText = /^\s*</.test(raw) && /<\/?[a-z]/i.test(raw) ? htmlToPlainText(raw) : normalizeText(raw);
      attachment.textContent = capText(asText);
    }
  } catch (e: any) {
    attachment.error = `Download failed: ${e.message}`;
  }
  return attachment;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function mdSection(title: string, body: string): string {
  return body && body.trim() ? `\n## ${title}\n\n${body.trim()}\n` : '';
}

function mdRelatedItems(items: TicketRelatedItem[]): string {
  return items
    .map(
      (item) =>
        `- **${item.relation || 'related'}** ${item.id}${item.status ? ` \`${item.status}\`` : ''} — ${item.title || ''}${item.url ? ` ([link](${item.url}))` : ''}`
    )
    .join('\n');
}

/**
 * Deterministic markdown rendering of the ticket. Produced by the CLI rather than retyped by an
 * agent, so the extract is identical on every run and no content is silently paraphrased.
 */
export function renderTicketDetailsMarkdown(details: TicketDetails): string {
  const lines: string[] = [];
  lines.push(`# ${details.id} — ${details.subject || '(no title)'}`);
  lines.push('');
  const fields: [string, string][] = [
    ['Provider', details.provider],
    ['Type', details.type],
    ['Status', details.status],
    ['Priority', details.priority],
    ['Assignee', details.assignee],
    ['Reporter', details.reporter],
    ['Sprint', details.sprint],
    ['Story points', details.storyPoints],
    ['Parent', details.parent],
    ['Epic', details.epic],
    ['Components', details.components.join(', ')],
    ['Fix versions', details.fixVersions.join(', ')],
    ['Labels', details.labels.join(', ')],
    ['Created', details.created],
    ['Updated', details.updated],
    ['Resolved', details.resolved],
    ['URL', details.url ? `[${details.url}](${details.url})` : ''],
  ];
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  for (const [label, value] of fields) {
    if (value) {
      lines.push(`| ${label} | ${value} |`);
    }
  }
  for (const [key, value] of Object.entries(details.extra || {})) {
    if (value && typeof value !== 'object') {
      lines.push(`| ${key} | ${value} |`);
    }
  }
  lines.push('');

  let body = lines.join('\n');
  body += mdSection('Description', details.description);
  body += mdSection('Acceptance criteria', details.acceptanceCriteria);

  if (details.subtasks.length) {
    body += mdSection(`Subtasks (${details.subtasks.length})`, mdRelatedItems(details.subtasks));
  }
  if (details.links.length) {
    body += mdSection(`Linked items (${details.links.length})`, mdRelatedItems(details.links));
  }
  if (details.comments.length) {
    const comments = details.comments
      .map((comment) => `### ${comment.date || '(no date)'} — ${comment.author || '(unknown)'}\n\n${comment.body || ''}`)
      .join('\n\n');
    const title = `Comments (${details.comments.length}${details.commentsTruncated ? ', truncated' : ''})`;
    body += mdSection(title, comments);
  }
  if (details.attachments.length) {
    const attachments = details.attachments
      .map((attachment) => {
        const header = `### ${attachment.filename} (${attachment.kind}, ${attachment.contentType || 'unknown type'}, ${attachment.size} bytes)`;
        const meta: string[] = [];
        if (attachment.created || attachment.author) {
          meta.push(`Uploaded ${attachment.created || '(unknown date)'} by ${attachment.author || '(unknown)'}`);
        }
        if (attachment.localPath) {
          meta.push(`Saved to \`${attachment.localPath}\``);
        }
        if (attachment.truncated) {
          meta.push('Content truncated at the configured size limit.');
        }
        if (attachment.error) {
          meta.push(`**Not downloaded:** ${attachment.error}`);
        }
        const content = attachment.textContent ? `\n\n\`\`\`\n${attachment.textContent}\n\`\`\`` : '';
        return `${header}\n\n${meta.join('  \n')}${content}`;
      })
      .join('\n\n');
    body += mdSection(`Attachments (${details.attachments.length})`, attachments);
  }
  if (details.manualActions.length) {
    const intro =
      'Lines mentioning an operation that deployable metadata will not carry. Each one that survives the design phase must become an sfdx-hardis deployment action.\n\n';
    body += mdSection(
      `Possible manual actions (${details.manualActions.length})`,
      intro + details.manualActions.map((action) => `- ${action}`).join('\n')
    );
  }
  return body.trimEnd() + '\n';
}
