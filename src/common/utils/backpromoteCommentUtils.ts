/*
 * The "Backpromotes" Pull Request comment: the only source of the backpromote history.
 *
 * Every Pull Request of a backpromote window gets one such comment, found again by a hidden marker
 * like the CI/CD "Deployment Actions" comment (which a backpromote never reads nor writes). It holds
 * two tables: one row per sandbox (name and org id) that received the Pull Request, and one row per
 * deployment action of the Pull Request run by a backpromote in a sandbox. The exact state travels
 * in a hidden JSON block, the tables are rendered for the reader of the Pull Request page.
 */
import c from 'chalk';
import * as os from 'os';
import * as path from 'path';
import fs from './fsUtils.js';
import { GitProvider } from '../gitProvider/index.js';
import { retryOnThrottling } from './adaptiveBatch.js';
import { uxLog } from './index.js';
import { t } from './i18n.js';

export const BACKPROMOTES_MARKER = '<!-- sfdx-hardis backpromotes -->';
const DATA_START = '<!-- sfdx-hardis backpromotes-data ';
const DATA_END = ' -->';

export type BackpromoteLeftOutReason = 'excluded' | 'keptOrg' | 'conflictPending' | 'noOverwrite';

export interface BackpromoteLeftOutItem {
  key: string;
  reason: BackpromoteLeftOutReason;
  /** Commit of the backpromote branch holding the merged file with its markers, for a pending conflict */
  commit?: string;
}

export interface BackpromoteSandboxRow {
  sandboxName: string;
  orgId: string;
  date: string;
  user: string;
  parentBranch: string;
  status: 'complete' | 'partial';
  leftOut: BackpromoteLeftOutItem[];
  version: string;
}

export interface BackpromoteActionRow {
  actionId: string;
  label: string;
  phase: 'pre' | 'post';
  sandboxName: string;
  orgId: string;
  date: string;
  status: 'success' | 'failed' | 'pending';
  user: string;
}

export interface BackpromotesCommentState {
  sandboxRows: BackpromoteSandboxRow[];
  actionRows: BackpromoteActionRow[];
}

export function emptyBackpromotesState(): BackpromotesCommentState {
  return { sandboxRows: [], actionRows: [] };
}

// ---- Parsing and rendering (pure) ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const LEFT_OUT_REASONS: BackpromoteLeftOutReason[] = ['excluded', 'keptOrg', 'conflictPending', 'noOverwrite'];

/** The state held by a comment body, empty when the body has no data block or an unreadable one */
export function parseBackpromotesComment(body: string | null | undefined): BackpromotesCommentState {
  const state = emptyBackpromotesState();
  const text = body || '';
  const start = text.indexOf(DATA_START);
  if (start === -1) {
    return state;
  }
  const end = text.indexOf(DATA_END, start + DATA_START.length);
  if (end === -1) {
    return state;
  }
  let raw: unknown;
  try {
    // The escapes written by encodeCommentData are plain JSON escapes: JSON.parse undoes them
    raw = JSON.parse(text.substring(start + DATA_START.length, end));
  } catch {
    return state;
  }
  if (!isRecord(raw)) {
    return state;
  }
  for (const entry of Array.isArray(raw.sandboxRows) ? raw.sandboxRows : []) {
    if (!isRecord(entry) || typeof entry.sandboxName !== 'string' || typeof entry.orgId !== 'string') {
      continue;
    }
    state.sandboxRows.push({
      sandboxName: entry.sandboxName,
      orgId: entry.orgId,
      date: String(entry.date || ''),
      user: String(entry.user || ''),
      parentBranch: String(entry.parentBranch || ''),
      status: entry.status === 'partial' ? 'partial' : 'complete',
      leftOut: (Array.isArray(entry.leftOut) ? entry.leftOut : [])
        .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.key === 'string')
        .map((item) => ({
          key: String(item.key),
          reason: LEFT_OUT_REASONS.includes(item.reason as BackpromoteLeftOutReason) ? (item.reason as BackpromoteLeftOutReason) : 'excluded',
          ...(typeof item.commit === 'string' && item.commit ? { commit: item.commit } : {}),
        })),
      version: String(entry.version || ''),
    });
  }
  for (const entry of Array.isArray(raw.actionRows) ? raw.actionRows : []) {
    if (!isRecord(entry) || typeof entry.actionId !== 'string' || typeof entry.sandboxName !== 'string' || typeof entry.orgId !== 'string') {
      continue;
    }
    state.actionRows.push({
      actionId: entry.actionId,
      label: String(entry.label || entry.actionId),
      phase: entry.phase === 'pre' ? 'pre' : 'post',
      sandboxName: entry.sandboxName,
      orgId: entry.orgId,
      date: String(entry.date || ''),
      status: entry.status === 'success' ? 'success' : entry.status === 'pending' ? 'pending' : 'failed',
      user: String(entry.user || ''),
    });
  }
  return state;
}

// The data block lives inside an HTML comment: a `--` sequence would end it early, so the JSON is
// stored with its dashes escaped, and any other risky character escaped by JSON itself.
function encodeCommentData(json: string): string {
  return json.replace(/-/g, '\\u002d').replace(/>/g, '\\u003e');
}

function cellText(text: string): string {
  return (text || '').replace(/\r?\n/g, ' ').replace(/\|/g, '&#124;');
}

function shortDate(date: string): string {
  return (date || '').substring(0, 16).replace('T', ' ');
}

const LEFT_OUT_LABELS: Record<BackpromoteLeftOutReason, string> = {
  excluded: 'left out',
  keptOrg: 'org version kept',
  conflictPending: 'conflict pending',
  noOverwrite: 'no overwrite',
};

/** The comment body: marker, hidden data, the sandbox table and the actions table */
export function renderBackpromotesComment(state: BackpromotesCommentState): string {
  const lines: string[] = [];
  lines.push(BACKPROMOTES_MARKER);
  lines.push(`${DATA_START}${encodeCommentData(JSON.stringify({ sandboxRows: state.sandboxRows, actionRows: state.actionRows }))}${DATA_END}`);
  lines.push('## :arrow_heading_down: Backpromotes');
  lines.push('');
  lines.push('_Written by `sf hardis:work:backpromote`: which developer sandboxes received this Pull Request, and which of its deployment actions ran there._');
  lines.push('');
  if (state.sandboxRows.length === 0) {
    lines.push('No sandbox received this Pull Request yet.');
  } else {
    lines.push('| Sandbox | Date | By | From | Status | Left out |');
    lines.push('|---------|------|----|------|--------|----------|');
    for (const row of [...state.sandboxRows].sort((a, b) => a.sandboxName.localeCompare(b.sandboxName) || a.date.localeCompare(b.date))) {
      const leftOut = row.leftOut.length === 0 ? '' : row.leftOut.map((item) => `${cellText(item.key)} (${LEFT_OUT_LABELS[item.reason]})`).join('<br/>');
      const status = row.status === 'complete' ? ':white_check_mark: complete' : ':warning: partial';
      lines.push(`| ${cellText(row.sandboxName)} <sub>${cellText(row.orgId)}</sub> | ${shortDate(row.date)} | ${cellText(row.user)} | ${cellText(row.parentBranch)} | ${status} | ${leftOut} |`);
    }
  }
  if (state.actionRows.length > 0) {
    lines.push('');
    lines.push('### Deployment actions run by backpromotes');
    lines.push('');
    lines.push('| Action | When | Sandbox | Date | By | Status |');
    lines.push('|--------|------|---------|------|----|--------|');
    for (const row of [...state.actionRows].sort((a, b) => a.sandboxName.localeCompare(b.sandboxName) || a.phase.localeCompare(b.phase) || a.actionId.localeCompare(b.actionId))) {
      const status = row.status === 'success' ? ':white_check_mark: done' : row.status === 'pending' ? ':wave: to do by hand' : ':x: failed';
      lines.push(`| ${cellText(row.label)} <sub>${cellText(row.actionId)}</sub> | ${row.phase === 'pre' ? 'pre-deploy' : 'post-deploy'} | ${cellText(row.sandboxName)} <sub>${cellText(row.orgId)}</sub> | ${shortDate(row.date)} | ${cellText(row.user)} | ${status} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** One row per sandbox name and org id: a redeploy updates the row instead of adding one */
export function upsertSandboxRow(state: BackpromotesCommentState, row: BackpromoteSandboxRow): BackpromotesCommentState {
  const others = state.sandboxRows.filter((entry) => !(entry.sandboxName === row.sandboxName && entry.orgId === row.orgId));
  return { sandboxRows: [...others, row], actionRows: state.actionRows };
}

/** One row per action id, sandbox name and org id */
export function upsertActionRow(state: BackpromotesCommentState, row: BackpromoteActionRow): BackpromotesCommentState {
  const others = state.actionRows.filter((entry) => !(entry.actionId === row.actionId && entry.sandboxName === row.sandboxName && entry.orgId === row.orgId));
  return { sandboxRows: state.sandboxRows, actionRows: [...others, row] };
}

export function findSandboxRow(state: BackpromotesCommentState | null | undefined, sandboxName: string, orgId: string): BackpromoteSandboxRow | null {
  return (state?.sandboxRows || []).find((row) => row.sandboxName === sandboxName && row.orgId === orgId) || null;
}

export function findActionRow(state: BackpromotesCommentState | null | undefined, actionId: string, sandboxName: string, orgId: string): BackpromoteActionRow | null {
  return (state?.actionRows || []).find((row) => row.actionId === actionId && row.sandboxName === sandboxName && row.orgId === orgId) || null;
}

// ---- Provider access, with the run cache ----

export class BackpromoteCommentStore {
  private readonly cacheDir: string | null;
  private readonly memory = new Map<number, BackpromotesCommentState>();
  // Reads in flight, so that two parallel readers of the same Pull Request cost one API call
  private readonly pending = new Map<number, Promise<BackpromotesCommentState>>();

  /** The reads of a run are cached under its id, so --plan then --auto do not read a comment twice */
  constructor(runId: string | null, private readonly commandThis: any = null) {
    this.cacheDir = runId ? path.join(os.tmpdir(), 'sfdx-hardis', 'backpromote', 'comments', runId) : null;
  }

  /** The state of the comment of a Pull Request, empty when the Pull Request has no comment yet */
  async read(prNumber: number, options: { fresh?: boolean } = {}): Promise<BackpromotesCommentState> {
    if (!options.fresh) {
      const cached = this.memory.get(prNumber) || (await this.readCacheFile(prNumber));
      if (cached) {
        this.memory.set(prNumber, cached);
        return cached;
      }
      const inFlight = this.pending.get(prNumber);
      if (inFlight) {
        return inFlight;
      }
    }
    const reading = this.readFromProvider(prNumber);
    this.pending.set(prNumber, reading);
    try {
      return await reading;
    } finally {
      this.pending.delete(prNumber);
    }
  }

  private async readFromProvider(prNumber: number): Promise<BackpromotesCommentState> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      throw new Error(t('backpromoteGitProviderRequired'));
    }
    // A dropped keep-alive connection or a throttling is tried again: one lost read must not end a plan
    const body = await retryOnThrottling(() => gitProvider.getPullRequestCommentByMarker(BACKPROMOTES_MARKER, prNumber), {
      onRetry: (error, waitMs) => uxLog('log', this.commandThis, c.grey(t('providerCallRetried', { pr: prNumber, waitSeconds: Math.round(waitMs / 1000), message: (error as Error)?.message || String(error) }))),
    });
    const state = parseBackpromotesComment(body);
    this.memory.set(prNumber, state);
    await this.writeCacheFile(prNumber, state);
    return state;
  }

  /**
   * Change the comment of a Pull Request: the comment is read again right before writing so that
   * a row another developer wrote meanwhile is kept, then the change is applied and written back.
   */
  async update(prNumber: number, change: (state: BackpromotesCommentState) => BackpromotesCommentState): Promise<BackpromotesCommentState> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      throw new Error(t('backpromoteGitProviderRequired'));
    }
    const current = await this.read(prNumber, { fresh: true });
    const next = change(current);
    await gitProvider.upsertPullRequestCommentByMarker(BACKPROMOTES_MARKER, renderBackpromotesComment(next), prNumber);
    // Some providers return without writing when their repository context is missing: the comment
    // is read back, and the run only trusts (and caches) what the provider really holds
    const written = parseBackpromotesComment(await gitProvider.getPullRequestCommentByMarker(BACKPROMOTES_MARKER, prNumber));
    if (JSON.stringify(written) !== JSON.stringify(next)) {
      this.memory.delete(prNumber);
      throw new Error(t('backpromoteCommentNotWritten', { pr: prNumber }));
    }
    this.memory.set(prNumber, next);
    await this.writeCacheFile(prNumber, next);
    uxLog('log', this.commandThis, c.grey(t('backpromoteCommentUpdated', { pr: prNumber })));
    return next;
  }

  private cacheFile(prNumber: number): string | null {
    return this.cacheDir ? path.join(this.cacheDir, `${prNumber}.json`) : null;
  }

  private async readCacheFile(prNumber: number): Promise<BackpromotesCommentState | null> {
    const file = this.cacheFile(prNumber);
    if (!file || !fs.existsSync(file)) {
      return null;
    }
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      return isRecord(raw) && Array.isArray(raw.sandboxRows) && Array.isArray(raw.actionRows) ? (raw as unknown as BackpromotesCommentState) : null;
    } catch {
      return null;
    }
  }

  private async writeCacheFile(prNumber: number, state: BackpromotesCommentState): Promise<void> {
    const file = this.cacheFile(prNumber);
    if (!file) {
      return;
    }
    try {
      await fs.ensureDir(path.dirname(file));
      await fs.writeFile(file, JSON.stringify(state), 'utf8');
    } catch {
      // A cache miss next time costs one comment read
    }
  }
}

/** True when a git provider with a token is configured: the history cannot be read without one */
export async function hasGitProviderForBackpromote(): Promise<boolean> {
  try {
    return (await GitProvider.getInstance()) != null;
  } catch {
    return false;
  }
}
