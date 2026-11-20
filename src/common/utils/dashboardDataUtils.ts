import { DashboardComment, DashboardFormat, DashboardRef, GitProviderRoot } from '../gitProvider/gitProviderRoot.js';

// What sfdx-hardis stores in the comments of a git provider dashboard (the scratch org pool, the
// development orgs), and how the body of such a dashboard is rendered, in Markdown or in the HTML
// of Azure DevOps work items.

// A cell is a text, or a link
export type DashboardCell = string | { label: string; url: string };

export interface DashboardBlock {
  heading?: string;
  text?: string;
  table?: { headers: string[]; rows: DashboardCell[][] };
}

/**
 * The data travels as one base64url token: no markup of any provider (Markdown, Bitbucket markup,
 * the HTML of Azure DevOps) can alter it, where a JSON block would be reformatted or escaped.
 */
export function encodeDashboardData(name: string, data: unknown): string {
  return `[sfdx-hardis-${name}-data:${Buffer.from(JSON.stringify(data), 'utf8').toString('base64url')}]`;
}

/** The comment body: a line for the human who opens the dashboard, then the data, folded */
export function buildDashboardCommentBody(title: string, marker: string, format: DashboardFormat): string {
  if (format === 'html') {
    return `<div>${escapeDashboardHtml(title)}</div><div><small>Technical data used by sfdx-hardis, do not edit:</small></div><pre>${marker}</pre>`;
  }
  return `${title}\n\n<details>\n<summary>Technical data used by sfdx-hardis, do not edit</summary>\n\n\`\`\`\n${marker}\n\`\`\`\n\n</details>`;
}

/** Null for a body that holds no data of this name, or data that cannot be read */
export function decodeDashboardData(name: string, body: string | null | undefined): any | null {
  // A provider can wrap a long token: whitespace inside the marker is not data
  const match = (body || '').replace(/\s+/g, '').match(new RegExp(`\\[sfdx-hardis-${name}-data:([A-Za-z0-9_-]+)\\]`));
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * The open dashboard of this title. With `create`, it is created when there is none: another job
 * can create it at the same moment, so everybody keeps the oldest one and closes its own.
 */
export async function findOrCreateDashboard(
  provider: GitProviderRoot,
  title: string,
  create: boolean,
  createEmpty: () => Promise<DashboardRef>
): Promise<DashboardRef | null> {
  const existing = await provider.findDashboard(title);
  if (existing || !create) {
    return existing;
  }
  const created = await createEmpty();
  const found = await provider.findDashboard(title).catch(() => null);
  if (found && found.id < created.id) {
    await provider.closeDashboard(created).catch(() => undefined);
    return found;
  }
  return created;
}

/**
 * Opens a new dashboard holding the same comments, closes the old one, and returns the new one.
 *
 * `copyBody` gets the ids the copies already made received (old id -> new id), for comments that
 * name another comment. `copyOrder` puts the comments that are named first.
 */
export async function replaceDashboard<T extends { id: number }>(options: {
  provider: GitProviderRoot;
  oldDashboard: DashboardRef;
  createEmpty: () => Promise<DashboardRef>;
  listComments: (dashboard: DashboardRef) => Promise<T[]>;
  copyBody: (comment: T, newIds: Map<number, number>) => string;
  copyOrder?: (comments: T[]) => T[];
  // Called as soon as the new dashboard exists, before the copy: on a provider with one open
  // dashboard, the old one is closed by then, and a copy that fails must leave the caller on the
  // new one
  onCreated?: (dashboard: DashboardRef) => void;
}): Promise<DashboardRef> {
  const { provider, oldDashboard } = options;
  const order = options.copyOrder || ((comments: T[]) => comments);
  const newIds = new Map<number, number>();
  const copyComments = async (comments: T[], target: DashboardRef) => {
    for (const comment of order(comments.filter((candidate) => !newIds.has(candidate.id)))) {
      newIds.set(comment.id, await provider.createDashboardComment(target, options.copyBody(comment, newIds)));
    }
  };
  if (!provider.allowsTwoOpenDashboards()) {
    // The old one must be closed first. The new one is created without looking for it: the
    // listing of a provider can still return the dashboard that was closed a moment ago.
    const comments = await options.listComments(oldDashboard);
    await provider.closeDashboard(oldDashboard);
    const newDashboard = await options.createEmpty();
    options.onCreated?.(newDashboard);
    await copyComments(comments, newDashboard);
    return newDashboard;
  }
  // The old dashboard stays the one every job finds until the copy is complete: a copy that fails
  // loses nothing, and the next update tries again
  const newDashboard = await options.createEmpty();
  try {
    await copyComments(await options.listComments(oldDashboard), newDashboard);
    await provider.closeDashboard(oldDashboard);
    // What jobs wrote on the old dashboard during the copy
    await copyComments(await options.listComments(oldDashboard), newDashboard);
  } catch (e) {
    await provider.closeDashboard(newDashboard).catch(() => undefined);
    throw e;
  }
  return newDashboard;
}

export function renderDashboardBlocks(blocks: DashboardBlock[], format: DashboardFormat): string {
  return blocks.map((block) => renderBlock(block, format)).join(format === 'html' ? '' : '\n\n');
}

export function formatDashboardDate(date: string): string {
  const time = Date.parse(date);
  return isNaN(time) ? date : new Date(time).toISOString().slice(0, 16).replace('T', ' ');
}

export function formatDashboardDay(date: string): string {
  const time = Date.parse(date);
  return isNaN(time) ? date : new Date(time).toISOString().slice(0, 10);
}

export function escapeDashboardHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The comments sorted by creation, oldest first: the ids grow with the creation order */
export function sortDashboardComments<T extends Pick<DashboardComment, 'id'>>(comments: T[]): T[] {
  return [...comments].sort((a, b) => a.id - b.id);
}

function renderBlock(block: DashboardBlock, format: DashboardFormat): string {
  if (block.heading) {
    return format === 'html' ? `<h3>${escapeDashboardHtml(block.heading)}</h3>` : `## ${block.heading}`;
  }
  if (block.table) {
    if (format === 'html') {
      const head = block.table.headers.map((header) => `<th>${escapeDashboardHtml(header)}</th>`).join('');
      const rows = block.table.rows.map((row) => `<tr>${row.map((cell) => `<td>${renderCell(cell, format)}</td>`).join('')}</tr>`).join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    const lines = [
      `| ${block.table.headers.join(' | ')} |`,
      `| ${block.table.headers.map(() => '---').join(' | ')} |`,
      ...block.table.rows.map((row) => `| ${row.map((cell) => renderCell(cell, format)).join(' | ')} |`),
    ];
    return lines.join('\n');
  }
  return format === 'html' ? `<p>${escapeDashboardHtml(block.text || '')}</p>` : block.text || '';
}

function renderCell(cell: DashboardCell, format: DashboardFormat): string {
  if (typeof cell !== 'string') {
    return format === 'html' ? `<a href="${escapeDashboardHtml(cell.url)}">${escapeDashboardHtml(cell.label)}</a>` : `[${cell.label}](${cell.url})`;
  }
  return format === 'html' ? escapeDashboardHtml(cell) : cell.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
