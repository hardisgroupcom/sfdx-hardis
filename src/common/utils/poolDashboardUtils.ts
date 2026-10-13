import { DashboardComment, DashboardFormat } from '../gitProvider/gitProviderRoot.js';

// Title the dashboard is found by on the git provider
export const POOL_DASHBOARD_TITLE = 'Scratch Orgs Pool Dashboard';
// How many scratch orgs taken from the pool, and failed creations, the dashboard remembers
export const POOL_HISTORY_SIZE = 20;
export const POOL_FAILURES_SIZE = 5;

export type PoolCommentKind = 'entry' | 'claim' | 'failure' | 'state';

// What a comment of the dashboard carries. Every field but `payload` is readable by anyone who
// can read the repository: never put a credential outside of the encrypted payload.
export interface PoolCommentData {
  v: 1;
  kind: PoolCommentKind;
  // entry
  alias?: string;
  username?: string;
  orgId?: string;
  instanceUrl?: string;
  createdDate?: string;
  expirationDate?: string;
  keyId?: string;
  payload?: string;
  // claim: id of the entry comment that is claimed
  entry?: number;
  by?: string;
  branch?: string;
  pullRequest?: string;
  // claim, failure, state
  date?: string;
  jobUrl?: string;
  // failure
  error?: string;
  // state
  devHubLimits?: PoolDevHubLimits | null;
}

export interface PoolComment {
  id: number;
  createdDate: string;
  data: PoolCommentData;
}

export interface PoolLimit {
  used: number;
  max: number;
}

export interface PoolDevHubLimits {
  activeScratchOrgs: PoolLimit;
  dailyScratchOrgs: PoolLimit;
}

export interface PoolSummaryOrg {
  alias: string;
  username: string;
  instanceUrl: string;
  createdDate: string;
  expirationDate: string;
  daysLeft: number | null;
}

export interface PoolSummaryFetch {
  date: string;
  by: string;
  branch: string;
  pullRequest: string;
  jobUrl: string;
  alias: string;
}

export interface PoolSummaryFailure {
  date: string;
  error: string;
  jobUrl: string;
}

// Everything a human or the VS Code panel reads about a pool. It never contains a credential.
export interface PoolSummary {
  storageService: string;
  dashboardUrl: string | null;
  available: number;
  max: number;
  // The workstation or the job can take a scratch org from the pool
  canTake: boolean;
  keyStatus: 'ok' | 'missing' | 'mismatch' | 'notNeeded';
  orgs: PoolSummaryOrg[];
  history: PoolSummaryFetch[];
  failures: PoolSummaryFailure[];
  lastRefresh: { date: string; jobUrl: string } | null;
  devHubLimits: PoolDevHubLimits | null;
}

// The data travels as one base64url token: no markup of any provider (Markdown, Bitbucket markup,
// the HTML of Azure DevOps) can alter it, where a JSON block would be reformatted or escaped
const DATA_MARKER_REGEX = /\[sfdx-hardis-pool-data:([A-Za-z0-9_-]+)\]/;

export function buildPoolCommentBody(data: PoolCommentData, format: DashboardFormat): string {
  const marker = `[sfdx-hardis-pool-data:${Buffer.from(JSON.stringify(data), 'utf8').toString('base64url')}]`;
  const title = describePoolComment(data);
  if (format === 'html') {
    return `<div>${escapeHtml(title)}</div><div><small>Technical data used by sfdx-hardis, do not edit:</small></div><pre>${marker}</pre>`;
  }
  return `${title}\n\n<details>\n<summary>Technical data used by sfdx-hardis, do not edit</summary>\n\n\`\`\`\n${marker}\n\`\`\`\n\n</details>`;
}

// Null for a comment that is not one of sfdx-hardis (a human wrote on the dashboard)
export function parsePoolComment(comment: DashboardComment): PoolComment | null {
  // A provider can wrap a long token: whitespace inside the marker is not data
  const match = (comment.body || '').replace(/\s+/g, '').match(DATA_MARKER_REGEX);
  if (!match) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
    if (data?.v !== 1 || !['entry', 'claim', 'failure', 'state'].includes(data?.kind)) {
      return null;
    }
    return { id: comment.id, createdDate: comment.createdDate, data };
  } catch {
    return null;
  }
}

export function daysUntil(date: string | undefined, now: Date = new Date()): number | null {
  const time = Date.parse(date || '');
  if (isNaN(time)) {
    return null;
  }
  return Math.floor((time - now.getTime()) / (24 * 60 * 60 * 1000));
}

// What the comments of a dashboard say about the pool
export interface PoolState {
  // Every entry comment still on the dashboard
  entries: PoolComment[];
  // Entries nobody claimed, oldest first: the scratch orgs that can be taken
  available: PoolComment[];
  // Claims of each entry comment id, oldest first
  claimsByEntry: Map<number, PoolComment[]>;
  // The claim that won each scratch org taken from the pool, newest first
  history: PoolComment[];
  // Claims that are not the oldest one of their entry: the jobs that lost, or died before saying so
  lostClaims: PoolComment[];
  failures: PoolComment[];
  states: PoolComment[];
}

// keyId: only the entries encrypted with this key are available. Null when the key is unknown.
export function analyzePoolComments(comments: PoolComment[], keyId: string | null): PoolState {
  const sorted = [...comments].sort((a, b) => a.id - b.id);
  const entries = sorted.filter((comment) => comment.data.kind === 'entry');
  const claimsByEntry = new Map<number, PoolComment[]>();
  for (const claim of sorted.filter((comment) => comment.data.kind === 'claim')) {
    const entryId = Number(claim.data.entry);
    claimsByEntry.set(entryId, [...(claimsByEntry.get(entryId) || []), claim]);
  }
  const history: PoolComment[] = [];
  const lostClaims: PoolComment[] = [];
  for (const claims of claimsByEntry.values()) {
    // The oldest claim of an entry is the one that took its scratch org, whether the entry
    // comment is already removed or still waits for the next pool refresh to remove it
    history.push(claims[0]);
    lostClaims.push(...claims.slice(1));
  }
  return {
    entries,
    available: entries.filter((entry) => !claimsByEntry.has(entry.id) && (keyId === null || entry.data.keyId === keyId)),
    claimsByEntry,
    history: history.sort((a, b) => b.id - a.id),
    lostClaims,
    failures: sorted.filter((comment) => comment.data.kind === 'failure').reverse(),
    states: sorted.filter((comment) => comment.data.kind === 'state').reverse(),
  };
}

export function buildPoolSummary(
  state: PoolState,
  options: { storageService: string; dashboardUrl: string | null; max: number; keyId: string | null; now?: Date },
): PoolSummary {
  const unclaimed = state.entries.filter((entry) => !state.claimsByEntry.has(entry.id));
  let keyStatus: PoolSummary['keyStatus'] = 'ok';
  if (options.keyId === null) {
    keyStatus = 'missing';
  } else if (unclaimed.length > 0 && state.available.length === 0) {
    keyStatus = 'mismatch';
  }
  const lastState = state.states[0]?.data;
  return {
    storageService: options.storageService,
    dashboardUrl: options.dashboardUrl,
    available: state.available.length,
    max: options.max,
    canTake: keyStatus === 'ok',
    keyStatus,
    orgs: state.available.map((entry) => ({
      alias: entry.data.alias || '',
      username: entry.data.username || '',
      instanceUrl: entry.data.instanceUrl || '',
      createdDate: entry.data.createdDate || '',
      expirationDate: entry.data.expirationDate || '',
      daysLeft: daysUntil(entry.data.expirationDate, options.now),
    })),
    history: state.history.slice(0, POOL_HISTORY_SIZE).map((claim) => ({
      date: claim.data.date || '',
      by: claim.data.by || '',
      branch: claim.data.branch || '',
      pullRequest: claim.data.pullRequest || '',
      jobUrl: claim.data.jobUrl || '',
      alias: claim.data.alias || '',
    })),
    failures: state.failures.slice(0, POOL_FAILURES_SIZE).map((failure) => ({
      date: failure.data.date || '',
      error: failure.data.error || '',
      jobUrl: failure.data.jobUrl || '',
    })),
    lastRefresh: lastState ? { date: lastState.date || '', jobUrl: lastState.jobUrl || '' } : null,
    devHubLimits: lastState?.devHubLimits || null,
  };
}

// The dashboard is English only, like the Pull Request comments: it is read by a whole team
export function buildPoolDashboardBody(summary: PoolSummary, format: DashboardFormat): string {
  const blocks: DashboardBlock[] = [];
  blocks.push({
    text: `Scratch org pool managed by sfdx-hardis. ${summary.available} scratch org(s) available of ${summary.max}. Do not edit this text or the comments below: they are the storage of the pool. Times are UTC.`,
  });
  blocks.push({ heading: 'Pool health' });
  blocks.push({
    table: {
      headers: ['Indicator', 'Value'],
      rows: [
        ['Available scratch orgs', `${summary.available} / ${summary.max}`],
        ['Last refresh', summary.lastRefresh ? formatDate(summary.lastRefresh.date) : 'Never'],
        ['Last refresh job', jobLink(summary.lastRefresh?.jobUrl)],
        ['Dev Hub active scratch orgs', formatLimit(summary.devHubLimits?.activeScratchOrgs)],
        ['Dev Hub daily scratch orgs', formatLimit(summary.devHubLimits?.dailyScratchOrgs)],
      ],
    },
  });
  blocks.push({ heading: 'Available scratch orgs' });
  if (summary.orgs.length === 0) {
    blocks.push({ text: 'The pool is empty. It is filled by the scheduled job running sf hardis:scratch:pool:refresh.' });
  } else {
    blocks.push({
      table: {
        headers: ['Alias', 'Username', 'Created', 'Expires', 'Days left'],
        rows: summary.orgs.map((org) => [org.alias, org.username, formatDay(org.createdDate), formatDay(org.expirationDate), org.daysLeft === null ? '' : String(org.daysLeft)]),
      },
    });
  }
  blocks.push({ heading: `Last ${POOL_HISTORY_SIZE} scratch orgs taken from the pool` });
  if (summary.history.length === 0) {
    blocks.push({ text: 'No scratch org was taken from the pool yet.' });
  } else {
    blocks.push({
      table: {
        headers: ['Date', 'Scratch org', 'Taken by', 'Branch', 'Pull Request', 'Job'],
        rows: summary.history.map((fetch) => [formatDate(fetch.date), fetch.alias, fetch.by, fetch.branch, fetch.pullRequest, jobLink(fetch.jobUrl)]),
      },
    });
  }
  if (summary.failures.length > 0) {
    blocks.push({ heading: 'Last failed scratch org creations' });
    blocks.push({
      table: {
        headers: ['Date', 'Error', 'Job'],
        rows: summary.failures.map((failure) => [formatDate(failure.date), failure.error, jobLink(failure.jobUrl)]),
      },
    });
  }
  return blocks.map((block) => renderBlock(block, format)).join(format === 'html' ? '' : '\n\n');
}

// A cell is a text, or a link
type DashboardCell = string | { label: string; url: string };

interface DashboardBlock {
  heading?: string;
  text?: string;
  table?: { headers: string[]; rows: DashboardCell[][] };
}

// First line of a comment, for the human who opens the dashboard
function describePoolComment(data: PoolCommentData): string {
  switch (data.kind) {
    case 'entry':
      return `Scratch org available: ${data.alias} (${data.username}), expires on ${formatDay(data.expirationDate || '')}`;
    case 'claim':
      return `Scratch org ${data.alias} taken by ${data.by || 'unknown'} on ${formatDate(data.date || '')}${data.branch ? `, branch ${data.branch}` : ''}`;
    case 'failure':
      return `Scratch org creation failed on ${formatDate(data.date || '')}: ${data.error || ''}`;
    default:
      return `Pool refreshed on ${formatDate(data.date || '')}`;
  }
}

function renderBlock(block: DashboardBlock, format: DashboardFormat): string {
  if (block.heading) {
    return format === 'html' ? `<h3>${escapeHtml(block.heading)}</h3>` : `## ${block.heading}`;
  }
  if (block.table) {
    if (format === 'html') {
      const head = block.table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
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
  return format === 'html' ? `<p>${escapeHtml(block.text || '')}</p>` : block.text || '';
}

function renderCell(cell: DashboardCell, format: DashboardFormat): string {
  if (typeof cell !== 'string') {
    return format === 'html' ? `<a href="${escapeHtml(cell.url)}">${escapeHtml(cell.label)}</a>` : `[${cell.label}](${cell.url})`;
  }
  return format === 'html' ? escapeHtml(cell) : cell.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function jobLink(url: string | undefined): DashboardCell {
  return url ? { label: 'job', url } : '';
}

function formatLimit(limit: PoolLimit | undefined): string {
  return limit ? `${limit.used} / ${limit.max}` : 'Unknown';
}

function formatDate(date: string): string {
  const time = Date.parse(date);
  return isNaN(time) ? date : new Date(time).toISOString().slice(0, 16).replace('T', ' ');
}

function formatDay(date: string): string {
  const time = Date.parse(date);
  return isNaN(time) ? date : new Date(time).toISOString().slice(0, 10);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
