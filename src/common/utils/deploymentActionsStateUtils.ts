import c from "chalk";
import { debuglog } from "util";
import { GitProvider } from '../gitProvider/index.js';
import { PullRequestCommentRef } from '../gitProvider/gitProviderRoot.js';
import { ActionWhen, PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { readActions } from './actionUtils.js';
import { uxLog } from './index.js';
import { t } from './i18n.js';
import { gitProviderBatchSizes, mapInAdaptiveBatchesSettled } from './adaptiveBatch.js';
import { WebSocketClient } from '../websocketClient.js';
import { getBannerMarkdownAndLink, getPrCommentBannerMarkdown, PrCommentBannerKey } from '../../config/index.js';
import { extractPrCommentNavLine, getPrCommentNavLinks, isPrCommentNavEnabled, renderPrCommentNav, wrapPrCommentNav } from '../gitProvider/prCommentNav.js';

// Enable with NODE_DEBUG=sfdxhardis
const debug = debuglog("sfdxhardis");

export const DEPLOYMENT_ACTIONS_MARKER = '<!-- sfdx-hardis deployment-actions-state -->';

// Prefix of the hidden marker set on every manual action checklist item, in all the Pull Request
// comments where such checklists appear (check results, deployment results, deployment actions state).
// Ticking one of these checkboxes records the manual action as done for the org branch.
export const MANUAL_ACTION_CHECKBOX_MARKER_PREFIX = '<!-- sfdx-hardis-manual-action ';

// Prefix of the hidden marker set on every failed (or stopped) action checklist item. Ticking one
// of these checkboxes records the action as closed by hand for the org branch.
export const FAILED_ACTION_CHECKBOX_MARKER_PREFIX = '<!-- sfdx-hardis-failed-action ';

// Reference to an action of a Pull Request, used to link a failed action with the ones it stopped
export interface DeploymentActionRef {
  pr: number;
  actionId: string;
}

// Org branch of the tries made in a developer org (same value as DEV_SANDBOXES_BRANCH_NAME of
// actionUtils, not imported to keep this module free of a dependency cycle)
export const DEV_SANDBOXES_ORG_BRANCH = 'dev-sandboxes';

// What the two checkbox marker prefixes start with, to list the comments holding either in one call
const CHECKBOX_MARKER_COMMON_PREFIX = '<!-- sfdx-hardis-';

// Hard bound on the stopped actions remembered on a failed entry, to keep the comment size in check
const MAX_STOPPED_ACTIONS = 50;

export interface DeploymentActionStateEntry {
  actionId: string;
  actionLabel: string;
  orgBranch: string;
  when: ActionWhen;
  executionOrder: number;
  // 'warning' is a failed action whose definition allows failure: the deployment went on, so the
  // outcome must not read as an error in the comment, but the action did not succeed either.
  // 'pending' is never stored: the release notes of a branch use it for an action with no entry in
  // the org of that branch yet.
  // 'not-run' is an action stopped because a previous action of the same run failed: it is stored
  // so it can be retried or closed by hand, and like 'failed' it runs again on the next deployment.
  // 'moved' is an action whose definition was moved to a fix Pull Request (movedFrom).
  status: 'success' | 'failed' | 'warning' | 'manual' | 'skipped' | 'pending' | 'not-run' | 'moved';
  jobId: string;
  jobUrl: string;
  date: string;
  output?: string;
  // Values a custom function returned. Persisted so a runOnlyOnceByOrg action, skipped on later
  // deployments, can still feed ${{ actions.<id>.outputs.<name> }} references.
  outputs?: Record<string, any>;
  // Who closed or retried the action by hand, and how. Displayed in the results table.
  note?: string;
  // Fix Pull Request the action was moved to ('moved' entries)
  movedTo?: number;
  // Failed action that stopped this one ('not-run' entries)
  blockedBy?: DeploymentActionRef;
  // Actions this failure stopped, in execution order ('failed' entries)
  stoppedActions?: DeploymentActionRef[];
  prNumber?: number;
  prUrl?: string;
}

/**
 * PrePostCommand enriched with deployment when and execution order,
 * needed to sort and describe actions in the PR comment details section.
 */
export type ActionDef = PrePostCommand & {
  when: ActionWhen;
  executionOrder: number;
};

interface DeploymentActionsMultiPrState {
  entriesByPr: Map<number, DeploymentActionStateEntry[]>;
  dirtyPrs: Set<number>;
  // PRs whose comments have already been scanned for checked manual action checkboxes in this process
  syncedCheckboxPrs: Set<number>;
}

const MAX_OUTPUT_CHARS = 1500;
const MAX_OUTPUT_LINES = 40;

export function getJobInfo(): { jobId: string; jobUrl: string } {
  const jobId =
    process.env.GITHUB_RUN_ID ||
    process.env.CI_JOB_ID ||
    process.env.BUILD_BUILDID ||
    process.env.BITBUCKET_BUILD_NUMBER ||
    `local-${Date.now()}`;
  return { jobId, jobUrl: '' };
}

export async function getJobInfoWithUrl(): Promise<{ jobId: string; jobUrl: string }> {
  const { jobId } = getJobInfo();
  let jobUrl = '';
  try {
    jobUrl = (await GitProvider.getJobUrl()) || '';
  } catch (_e) {
    // ignore
  }
  return { jobId, jobUrl };
}

function truncateOutput(output: string | undefined): string {
  if (!output) return '';
  let result = output;
  const lines = result.split('\n');
  if (result.length > MAX_OUTPUT_CHARS) {
    result = result.substring(result.length - MAX_OUTPUT_CHARS);
  }
  if (lines.length > MAX_OUTPUT_LINES) {
    const last = lines.slice(-MAX_OUTPUT_LINES).join('\n');
    if (last.length <= MAX_OUTPUT_CHARS) {
      result = last;
    }
  }
  if (result.length < output.length) {
    result = `... (output truncated, total length was ${output.length} characters)\n` + result;
  }
  return result;
}

function getMultiPrState(): DeploymentActionsMultiPrState {
  if (!globalThis._deploymentActionsMultiPrState) {
    globalThis._deploymentActionsMultiPrState = {
      entriesByPr: new Map(),
      dirtyPrs: new Set(),
      syncedCheckboxPrs: new Set(),
    };
  }
  if (!globalThis._deploymentActionsMultiPrState.syncedCheckboxPrs) {
    globalThis._deploymentActionsMultiPrState.syncedCheckboxPrs = new Set();
  }
  return globalThis._deploymentActionsMultiPrState;
}

/**
 * Load action definitions from a PR's .sfdx-hardis.PRNB.yml config file
 * by delegating to the existing readActions utility.
 */
async function loadActionDefsFromPrYaml(prNumber: number): Promise<Map<string, ActionDef>> {
  const prId = String(prNumber);
  const defs = new Map<string, ActionDef>();
  try {
    for (const when of ['pre-deploy', 'post-deploy'] as ActionWhen[]) {
      const commands = await readActions('pr', when, undefined, prId);
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        if (cmd.id) defs.set(cmd.id, { ...cmd, when, executionOrder: i });
      }
    }
  } catch (_e) {
    // If the file cannot be read or parsed, return empty defs
  }
  return defs;
}

/**
 * Load deployment actions state from all source PRs.
 * Each PR's "Deployment Actions" comment is read and parsed independently.
 * Call once before the execution loop.
 */
export async function loadDeploymentActionsState(sourcePrNumbers: number[]): Promise<void> {
  const state = getMultiPrState();
  // Only load PRs we haven't loaded yet (post-deploy may have different PRs than pre-deploy)
  const uniquePrs = [...new Set(sourcePrNumbers)].filter(n => n > 0 && !state.entriesByPr.has(n));
  const showProgress = uniquePrs.length > 1;
  if (showProgress) {
    WebSocketClient.sendProgressStartMessage(t('loadingDeploymentActionsStateFromPrs', { count: uniquePrs.length }), uniquePrs.length);
  }
  // One comment read per Pull Request, in the adaptive batches of the git provider's ladder, shrunk
  // only when the provider throttles
  const bodies = await mapInAdaptiveBatchesSettled(uniquePrs, (prNumber) => GitProvider.tryGetDeploymentActionsCommentBodyForPr(prNumber), {
    sizes: gitProviderBatchSizes(await GitProvider.getInstance()),
    onBackoff: (size, e, waitMs) => uxLog("log", null, c.grey('[DeploymentActions] ' + t('providerThrottledBackoff', { count: size, waitSeconds: Math.round(waitMs / 1000), message: (e as Error)?.message || '' }))),
    onError: (e, prNumber) => uxLog("warning", null, c.yellow(`Could not load deployment actions state from PR #${prNumber}: ${(e as Error).message}`)),
    onProgress: (done, total) => {
      if (showProgress) {
        WebSocketClient.sendProgressStepMessage(done, total);
      }
    },
  });
  for (const [index, prNumber] of uniquePrs.entries()) {
    const body = bodies[index];
    if (body) {
      const entries = parseDeploymentActionsCommentBody(body);
      state.entriesByPr.set(prNumber, entries);
      uxLog("log", null, c.grey(`[DeploymentActions] ${t('loadedDeploymentActionsStateEntries', { count: entries.length, pr: prNumber })}`));
      // Full entries are diagnostic data: keep them out of the console unless DEBUG is enabled
      debug(`Deployment actions state entries loaded from PR #${prNumber}: ${JSON.stringify(entries, null, 2)}`);
    } else {
      state.entriesByPr.set(prNumber, []);
    }
  }
  if (showProgress) {
    WebSocketClient.sendProgressEndMessage(uniquePrs.length);
  }
}

/**
 * Check if an action already ran successfully in an org.
 * Searches across ALL loaded PR state buckets.
 */
export function checkActionInState(actionId: string, orgBranch: string): DeploymentActionStateEntry | null {
  const state = getMultiPrState();
  for (const entries of state.entriesByPr.values()) {
    const found = entries.find(e => e.actionId === actionId && e.orgBranch.trim() === orgBranch.trim() && e.status === 'success');
    if (found) return found;
  }
  return null;
}

/**
 * State entry of an action in an org branch, whatever its status, read from the bucket of the
 * Pull Request that owns it. The state of that Pull Request must have been loaded first.
 */
export function getActionStateEntry(prNumber: number, actionId: string, orgBranch: string): DeploymentActionStateEntry | null {
  const entries = getMultiPrState().entriesByPr.get(prNumber) || [];
  return entries.find((e) => e.actionId === actionId && e.orgBranch.trim() === orgBranch.trim()) || null;
}

/**
 * All the loaded state entries of a Pull Request (empty when its state was not loaded).
 */
export function getStateEntriesForPr(prNumber: number): DeploymentActionStateEntry[] {
  return [...(getMultiPrState().entriesByPr.get(prNumber) || [])];
}

/**
 * Upsert an entry in the specified PR's state bucket.
 * sourcePrNumber must be > 0 (a real PR number).
 */
export function upsertActionInState(entry: DeploymentActionStateEntry, sourcePrNumber: number): void {
  if (sourcePrNumber <= 0) return; // No PR context - cannot track
  const state = getMultiPrState();
  if (!state.entriesByPr.has(sourcePrNumber)) {
    state.entriesByPr.set(sourcePrNumber, []);
  }
  const entries = state.entriesByPr.get(sourcePrNumber)!;
  const idx = entries.findIndex(e => e.actionId === entry.actionId && e.orgBranch === entry.orgBranch);
  // A skip is the absence of an outcome, not an outcome: it must never erase what is already known
  // about the action in this org, whatever that is.
  //
  // Without this, a ticked check-only manual action ping-pongs forever on deployment jobs: the
  // checkbox sync records success, the context skip overwrites it with skipped, and the next job's
  // sync cannot find the success entry and records the tick again, re-dating the entry and
  // rewriting the Pull Request comment on every run.
  //
  // It matters just as much for a manual action still waiting to be performed. Any later job whose
  // scope holds the Pull Request skips that action as "already run in this org" and used to write
  // `skipped` over the `manual` entry - which drops the action from the "Pending manual actions"
  // list. The release manager then has no checkbox left to tick, and the org branch displays a
  // skip for a step nobody ever performed.
  if (idx >= 0 && entry.status === 'skipped' && entries[idx].status !== 'skipped') {
    return;
  }
  // A stop is not an outcome either: it must not hide an action already performed or waiting for
  // its manual execution, and a moved action keeps pointing at its fix Pull Request.
  if (idx >= 0 && entry.status === 'not-run' && ['success', 'manual', 'moved'].includes(entries[idx].status)) {
    return;
  }
  // Moving an action never rewrites history in an org where it already succeeded
  if (idx >= 0 && entry.status === 'moved' && entries[idx].status === 'success') {
    return;
  }
  // An action failing again, or retried successfully, keeps the list of the actions its first
  // failure stopped, until a run records a new list: they are still waiting, and a retry of one of
  // them finds the ones after it through this list.
  if (idx >= 0 && ['failed', 'success', 'moved'].includes(entry.status) && !entry.stoppedActions && entries[idx].stoppedActions) {
    entry = { ...entry, stoppedActions: entries[idx].stoppedActions };
  }
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }
  state.dirtyPrs.add(sourcePrNumber);
}

/**
 * Persist dirty PR state back to their respective PR comments.
 * Each PR gets its own "Deployment Actions" comment containing only its own actions.
 *
 * Before writing, re-reads the existing comment and merges to avoid losing
 * entries that were written by a different deployment (e.g. a different org branch)
 * or that were missed during the initial load.
 * Action definitions are read from the PR's .sfdx-hardis.PRNB.yml file.
 */
export async function persistDeploymentActionsState(): Promise<void> {
  const state = getMultiPrState();
  for (const prNumber of state.dirtyPrs) {
    const inMemoryEntries = state.entriesByPr.get(prNumber) || [];
    // Re-read the current PR comment and merge to preserve entries from other org branches
    const { mergedEntries, existingBody } = await mergeWithExistingComment(prNumber, inMemoryEntries);
    // Update the in-memory state with the merged result so subsequent persists stay consistent
    state.entriesByPr.set(prNumber, mergedEntries);
    // Load action definitions from the PR's YAML file to populate the details section
    const actionDefs = await loadActionDefsFromPrYaml(prNumber);
    const body = buildDeploymentActionsCommentBody(mergedEntries, actionDefs, prNumber, existingBody);
    await GitProvider.tryUpsertDeploymentActionsCommentForPr(prNumber, body);
  }
  state.dirtyPrs.clear();
}

/**
 * Merge in-memory entries with the entries currently stored in a PR's comment.
 * In-memory entries take precedence for the same actionId+orgBranch pair;
 * entries that only exist in the comment (from other org branches / deployments) are preserved.
 * The existing comment body is returned along, so the rebuilt comment can keep parts of it
 * that this process cannot recompute (the navigation links).
 */
async function mergeWithExistingComment(
  prNumber: number,
  inMemoryEntries: DeploymentActionStateEntry[],
): Promise<{ mergedEntries: DeploymentActionStateEntry[]; existingBody: string | null }> {
  let existingEntries: DeploymentActionStateEntry[] = [];
  let existingBody: string | null = null;
  try {
    existingBody = await GitProvider.tryGetDeploymentActionsCommentBodyForPr(prNumber);
    if (existingBody) {
      existingEntries = parseDeploymentActionsCommentBody(existingBody);
    }
  } catch (_e) {
    // If re-read fails, proceed with in-memory entries only
  }
  if (existingEntries.length === 0) {
    return { mergedEntries: inMemoryEntries, existingBody };
  }
  // Start from in-memory entries (they are the most up-to-date for this run)
  const merged = [...inMemoryEntries];
  // Append any existing entries that are NOT already present in memory
  for (const existing of existingEntries) {
    const alreadyInMemory = merged.some(e => e.actionId === existing.actionId && e.orgBranch === existing.orgBranch);
    if (!alreadyInMemory) {
      merged.push(existing);
    }
  }
  return { mergedEntries: merged, existingBody };
}

export function parseDeploymentActionsCommentBody(body: string): DeploymentActionStateEntry[] {
  // Matrix format: one row per action, one column per org branch
  if (body.includes('| Action | When |')) {
    return parseMatrixDeploymentActionsCommentBody(body);
  }
  // Legacy format: one row per action + org branch pair
  return parseLegacyDeploymentActionsCommentBody(body);
}

// Action ids are free-form YAML strings: one containing whitespace would break the hidden
// markers, whose regexes match the id with \S+. Ids are percent-encoded when written and
// decoded when read; usual alphanumeric ids are left untouched, so legacy comments still parse.
function encodeActionId(actionId: string): string {
  return encodeURIComponent(actionId || '');
}

function decodeActionId(encodedId: string): string {
  try {
    return decodeURIComponent(encodedId || '');
  } catch (_e) {
    // Legacy raw id containing a stray '%': keep it as-is
    return encodedId || '';
  }
}

// Keep arbitrary YAML labels from breaking the markdown structure: newlines collapse to
// spaces and pipes render through their HTML entity (displayed as '|' by the git providers)
function sanitizeCellText(text: string): string {
  return (text || '').replace(/\r?\n/g, ' ').replace(/\|/g, '&#124;');
}

function unsanitizeCellText(text: string): string {
  return (text || '').replaceAll('&#124;', '|');
}

function statusFromIcon(cell: string): DeploymentActionStateEntry['status'] {
  return cell.includes('\u2705') ? 'success' :
    cell.includes('\u274c') ? 'failed' :
      cell.includes('\u26a0') ? 'warning' :
        cell.includes('\ud83d\udc4b') ? 'manual' :
          cell.includes('\u26aa') ? 'skipped' :
            cell.includes('\u23f8') ? 'not-run' :
              cell.includes('\u21aa') ? 'moved' : 'failed';
}

function parseMatrixDeploymentActionsCommentBody(body: string): DeploymentActionStateEntry[] {
  const entries: DeploymentActionStateEntry[] = [];
  let branches: string[] = [];
  for (const line of body.split('\n')) {
    if (branches.length === 0) {
      const headerMatch = line.match(/^\|\s*Action\s*\|\s*When\s*\|(.*)\|\s*$/);
      if (headerMatch) {
        branches = headerMatch[1].split('|').map((b) => b.trim()).filter((b) => b !== '');
      }
      continue;
    }
    // | <!-- actionId:ID order:N --> Label | when | cell for branch 1 | cell for branch 2 | ... |
    const rowMatch = line.match(/^\|\s*<!--\s*actionId:(\S+?)(?:\s+order:(\d+))?\s*-->\s*(.*?)\s*\|\s*(pre-deploy|post-deploy)\s*\|(.*)\|\s*$/);
    if (!rowMatch) continue;
    const actionId = decodeActionId(rowMatch[1].trim());
    const executionOrder = rowMatch[2] ? parseInt(rowMatch[2], 10) : 0;
    const actionLabel = unsanitizeCellText(rowMatch[3].trim());
    const when = rowMatch[4] as ActionWhen;
    const cells = rowMatch[5].split('|').map((cell) => cell.trim());
    for (let i = 0; i < branches.length && i < cells.length; i++) {
      const cell = cells[i];
      if (cell === '' || cell === '\u2b1c') {
        continue; // \u2b1c : not run in this org branch yet
      }
      // The date lives before the <br/>: the job link URL after it may itself contain a date
      const cellHead = cell.split('<br/>')[0];
      const dateMatch = cellHead.match(/(\d{4}-\d{2}-\d{2})/);
      const jobLinkMatch = cell.match(/\[([^\]]+)\]\(([^)]+)\)/);
      entries.push({
        actionId,
        actionLabel,
        orgBranch: branches[i],
        when,
        executionOrder,
        status: statusFromIcon(cell),
        jobId: jobLinkMatch ? jobLinkMatch[1] : '',
        jobUrl: jobLinkMatch ? jobLinkMatch[2] : '',
        date: dateMatch ? dateMatch[1] : '',
        output: '',
        // Replayed to a runOnlyOnceByOrg action skipped on this run, so the actions consuming
        // its outputs keep resolving after the first deployment
        outputs: decodeOutputsMarker(cell),
        ...decodeMetaMarker(cell),
      });
    }
  }
  return entries;
}

function parseLegacyDeploymentActionsCommentBody(body: string): DeploymentActionStateEntry[] {
  const entries: DeploymentActionStateEntry[] = [];
  const lines = body.split('\n');
  for (const line of lines) {
    // | <!-- actionId:ID order:N --> Label | orgBranch | when | status | [jobId](jobUrl) |
    const rowMatch = line.match(/^\|\s*<!--\s*actionId:(\S+?)(?:\s+order:(\d+))?\s*-->\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|/);
    if (!rowMatch) continue;

    const actionId = decodeActionId(rowMatch[1].trim());
    const executionOrder = rowMatch[2] ? parseInt(rowMatch[2], 10) : 0;
    const actionLabel = rowMatch[3].trim();
    const orgBranch = rowMatch[4].trim();
    const when: ActionWhen = rowMatch[5].trim() === 'pre-deploy' ? 'pre-deploy' : 'post-deploy';
    const statusCell = rowMatch[6].trim();
    const jobCell = rowMatch[7].trim();

    const status: DeploymentActionStateEntry['status'] = statusFromIcon(statusCell);
    const dateMatch = statusCell.match(/\(([^)]+)\)/);
    const date = dateMatch ? dateMatch[1] : '';
    const jobLinkMatch = jobCell.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const jobId = jobLinkMatch ? jobLinkMatch[1] : jobCell;
    const jobUrl = jobLinkMatch ? jobLinkMatch[2] : '';
    entries.push({ actionId, actionLabel, orgBranch, when, executionOrder, status, jobId, jobUrl, date, output: '' });
  }
  return entries;
}

// Status icons of the "Status by org branch" matrix, in the order they are listed in the legend
const MATRIX_STATUS_LEGEND: { icon: string; label: string }[] = [
  { icon: '✅', label: 'done' },              // ✅
  { icon: '❌', label: 'failed' },            // ❌
  { icon: '⚠️', label: 'warning (failed, allowed to fail)' }, // ⚠️
  { icon: '👋', label: 'waiting for manual execution' }, // 👋
  { icon: '⚪', label: 'skipped' },           // ⚪
  { icon: '⏸️', label: 'not run, a previous action failed' }, // ⏸️
  { icon: '↪️', label: 'moved to another Pull Request' }, // ↪️
  { icon: '❓', label: 'unknown' },           // ❓
  { icon: '⬜', label: 'not run in this org branch yet' },     // ⬜
];

/**
 * Legend of the status matrix, listing only the statuses actually present in it.
 * A legend explaining outcomes that do not appear in the table above it is noise.
 */
function buildMatrixStatusLegend(usedIcons: string[]): string {
  const used = new Set(usedIcons);
  const parts = MATRIX_STATUS_LEGEND.filter((entry) => used.has(entry.icon)).map((entry) => `${entry.icon} ${entry.label}`);
  return parts.length > 0 ? `\n*Legend: ${parts.join(' · ')}*\n` : '';
}

/**
 * Outputs of a custom function, carried inside the matrix cell as an HTML comment.
 *
 * The whole deployment actions state round-trips through the markdown of the Pull Request
 * comment, so anything not written here is lost between two jobs. An HTML comment is invisible
 * in the rendered comment, and base64 keeps the JSON free of the characters that would break the
 * table or close the comment early ("|", newlines, "-->").
 */
const OUTPUTS_MARKER_REGEX = /<!--\s*outputs:([A-Za-z0-9+/=]+)\s*-->/;

/**
 * Outputs bigger than this are not persisted: the comment has a size guard, and a replayed value
 * that large is a payload, not an identifier a later action interpolates.
 */
const MAX_PERSISTED_OUTPUTS_CHARS = 2000;

export function encodeOutputsMarker(outputs?: Record<string, any>): string {
  if (!outputs || Object.keys(outputs).length === 0) {
    return '';
  }
  try {
    const encoded = Buffer.from(JSON.stringify(outputs), 'utf8').toString('base64');
    if (encoded.length > MAX_PERSISTED_OUTPUTS_CHARS) {
      return '';
    }
    return `<!-- outputs:${encoded} -->`;
  } catch (_e) {
    // A value that cannot be serialized (a cycle) must not break the whole comment
    return '';
  }
}

export function decodeOutputsMarker(cell: string): Record<string, any> | undefined {
  const match = OUTPUTS_MARKER_REGEX.exec(cell || '');
  if (!match) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch (_e) {
    return undefined;
  }
}

/**
 * Recovery details of an entry (note, moved to, blocked by, stopped actions), carried inside the
 * matrix cell as an HTML comment for the same reasons as the outputs marker.
 */
const META_MARKER_REGEX = /<!--\s*meta:([A-Za-z0-9+/=]+)\s*-->/;

type DeploymentActionStateMeta = Pick<DeploymentActionStateEntry, 'note' | 'movedTo' | 'blockedBy' | 'stoppedActions'>;

export function encodeMetaMarker(entry: DeploymentActionStateMeta): string {
  const meta: DeploymentActionStateMeta = {};
  if (entry.note) meta.note = entry.note;
  if (entry.movedTo) meta.movedTo = entry.movedTo;
  if (entry.blockedBy) meta.blockedBy = entry.blockedBy;
  if (entry.stoppedActions && entry.stoppedActions.length > 0) meta.stoppedActions = entry.stoppedActions.slice(0, MAX_STOPPED_ACTIONS);
  if (Object.keys(meta).length === 0) {
    return '';
  }
  return `<!-- meta:${Buffer.from(JSON.stringify(meta), 'utf8').toString('base64')} -->`;
}

export function decodeMetaMarker(cell: string): DeploymentActionStateMeta {
  const match = META_MARKER_REGEX.exec(cell || '');
  if (!match) {
    return {};
  }
  try {
    const parsed = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const meta: DeploymentActionStateMeta = {};
    if (typeof parsed.note === 'string') meta.note = parsed.note;
    if (Number.isInteger(parsed.movedTo)) meta.movedTo = parsed.movedTo;
    if (isActionRef(parsed.blockedBy)) meta.blockedBy = parsed.blockedBy;
    if (Array.isArray(parsed.stoppedActions)) meta.stoppedActions = parsed.stoppedActions.filter(isActionRef);
    return meta;
  } catch (_e) {
    return {};
  }
}

function isActionRef(value: any): value is DeploymentActionRef {
  return value && typeof value === 'object' && Number.isInteger(value.pr) && typeof value.actionId === 'string';
}

function getStatusIcon(status: DeploymentActionStateEntry['status']): string {
  switch (status) {
    case 'success': return '\u2705';   // ✅
    case 'failed': return '\u274c';   // ❌
    case 'warning': return '\u26a0\ufe0f'; // ⚠️
    case 'manual': return '\ud83d\udc4b'; // 👋
    case 'skipped': return '\u26aa';   // ⚪
    case 'not-run': return '\u23f8\ufe0f'; // ⏸️
    case 'moved': return '\u21aa\ufe0f'; // ↪️
    default: return '\u2753';   // ❓
  }
}

/**
 * Returns a numeric weight for sorting org branches from dev (low) to prod (high).
 * Branches at the same weight are sorted alphabetically.
 */
function getOrgBranchWeight(orgBranch: string): number {
  const b = orgBranch.toLowerCase();
  if (b.startsWith('prod') || b === 'main' || b === 'master') return 4;
  if (b.startsWith('preprod') || b.startsWith('staging')) return 3;
  if (b.startsWith('uat') || b.startsWith('recette')) return 2;
  if (b.startsWith('integ') || b.startsWith('int')) return 1;
  return 0;
}

/**
 * Banner identifying the Deployment Actions comment, with the state of its actions:
 * an action in error wins over a manual action still to perform.
 * Returns null when there is nothing to qualify yet, so no banner is displayed.
 */
function getActionsBannerKey(entries: DeploymentActionStateEntry[]): PrCommentBannerKey | null {
  if (entries.length === 0) {
    return null;
  }
  // A 'warning' entry (failed, allowed to fail) did not block the deployment: it must not turn the
  // comment red, so it is not an error here and falls through to pending / completed.
  // A stopped action is waiting for the failure that stopped it to be solved: same red banner
  // Tries in a developer org (dev-sandboxes) are information for their author, not a problem of the
  // pipeline: they never turn the banner red
  if (entries.some((e) => (e.status === 'failed' || e.status === 'not-run') && e.orgBranch !== DEV_SANDBOXES_ORG_BRANCH)) {
    return 'actions-error';
  }
  if (entries.some((e) => e.status === 'manual')) {
    return 'actions-pending';
  }
  return 'actions-completed';
}

/**
 * Navigation block of the Deployment Actions comment. The comment can be rebuilt by a job run
 * for another Pull Request (a promotion window deployment processing this PR's actions), whose
 * process does not know this PR's comment links: the navigation already present in the previous
 * comment body is then kept instead of being wiped.
 */
function buildActionsNavBlock(previousBody?: string | null): string {
  if (!isPrCommentNavEnabled()) {
    return '';
  }
  let navLine = renderPrCommentNav(getPrCommentNavLinks(), 'actions');
  if (navLine === '' && previousBody) {
    navLine = extractPrCommentNavLine(previousBody) || '';
  }
  return wrapPrCommentNav(navLine) + '\n\n';
}

export function buildDeploymentActionsCommentBody(entries: DeploymentActionStateEntry[], actionDefs?: Map<string, ActionDef>, prNumber?: number, previousBody?: string | null): string {
  // Sort by: org weight (integ → prod), then when (pre-deploy before post-deploy), then execution order
  const sorted = [...entries].sort((a, b) => {
    const weightDiff = getOrgBranchWeight(a.orgBranch) - getOrgBranchWeight(b.orgBranch);
    if (weightDiff !== 0) return weightDiff;
    const whenA = a.when === 'pre-deploy' ? 0 : 1;
    const whenB = b.when === 'pre-deploy' ? 0 : 1;
    if (whenA !== whenB) return whenA - whenB;
    return (a.executionOrder ?? 0) - (b.executionOrder ?? 0);
  });

  // The banner image replaces the title heading, kept as the image alt text so it only shows
  // when the image is hidden or cannot be loaded; without a banner the heading is kept
  const bannerMarkdown = getPrCommentBannerMarkdown(getActionsBannerKey(sorted), '🛠️ Deployment Actions');
  const headingMarkdown = bannerMarkdown === '' ? '## 🛠️ Deployment Actions\n\n' : '';
  let body = `${DEPLOYMENT_ACTIONS_MARKER}\n${buildActionsNavBlock(previousBody)}${bannerMarkdown}${headingMarkdown}`;
  body += `> ⚠️ This section is automatically managed by sfdx-hardis. Do not edit it manually, except to tick a checkbox in the "Pending manual actions" or "Failed actions" list once the action has been done.\n\n`;

  // Pending manual actions: a checkable to-do per action still waiting to be performed in an org.
  // Ticking a box is detected by the next check or deployment job, which records the action as done.
  const pendingManualEntries = sorted.filter((e) => e.status === 'manual');
  if (pendingManualEntries.length > 0) {
    body += `### Pending manual actions\n\n`;
    body += `Tick a box once the action has been performed in the org: the next sfdx-hardis job will record it as done.\n\n`;
    for (const e of pendingManualEntries) {
      body += `- [ ] ${buildManualActionCheckboxMarker(e.actionId, e.orgBranch, prNumber || 0, e.when)} ${sanitizeCellText(e.actionLabel)} *(org branch: ${e.orgBranch})*\n`;
    }
    body += `\n`;
  }

  // Failed actions: a checkable item per action that failed (or was stopped by a failure) in an org.
  // Retry it with sf hardis:project:action:run, or tick the box once it has been done by hand.
  const failedEntries = sorted.filter((e) => (e.status === 'failed' || e.status === 'not-run') && e.orgBranch !== DEV_SANDBOXES_ORG_BRANCH);
  if (failedEntries.length > 0) {
    body += `### Failed actions\n\n`;
    body += `Retry an action with \`sf hardis:project:action:run\` (or the **Retry** button of the VS Code Deployment Actions tab), move it to a fix Pull Request, or tick its box once it has been done by hand: the next sfdx-hardis job will record it as done.\n\n`;
    for (const e of failedEntries) {
      const stopped = e.status === 'not-run' ? ' - not run, a previous action failed' : '';
      body += `- [ ] ${buildFailedActionCheckboxMarker(e.actionId, e.orgBranch, prNumber || 0, e.when)} ${sanitizeCellText(e.actionLabel)} *(org branch: ${e.orgBranch}${stopped})*\n`;
    }
    body += `\n`;
  }

  // Status matrix: one row per action, one column per org branch, so the reader sees at a glance
  // in which orgs an action has been performed and where it is still pending.
  const branches = [...new Set(sorted.map((e) => e.orgBranch))].sort((a, b) => {
    const wDiff = getOrgBranchWeight(a) - getOrgBranchWeight(b);
    if (wDiff !== 0) return wDiff;
    return a.localeCompare(b);
  });
  const matrixActionIds: string[] = [];
  for (const e of sorted) {
    if (!matrixActionIds.includes(e.actionId)) matrixActionIds.push(e.actionId);
  }
  if (actionDefs) {
    for (const [actionId] of actionDefs) {
      if (!matrixActionIds.includes(actionId)) matrixActionIds.push(actionId);
    }
  }
  const usedMatrixIcons: string[] = [];
  if (branches.length > 0 && matrixActionIds.length > 0) {
    body += `### Status by org branch\n\n`;
    body += `| Action | When |${branches.map((b) => ` ${b} |`).join('')}\n`;
    body += `|--------|------|${branches.map(() => ':---:|').join('')}\n`;
    for (const actionId of matrixActionIds) {
      const actionEntries = sorted.filter((e) => e.actionId === actionId);
      const def = actionDefs?.get(actionId);
      const label = sanitizeCellText(actionEntries[0]?.actionLabel ?? def?.label ?? actionId);
      const when = actionEntries[0]?.when ?? def?.when ?? 'post-deploy';
      const order = actionEntries[0]?.executionOrder ?? def?.executionOrder ?? 0;
      const cells = branches.map((branch) => {
        const e = actionEntries.find((entry) => entry.orgBranch === branch);
        if (!e) {
          usedMatrixIcons.push('⬜');
          return '⬜';
        }
        const dateStr = e.date ? ` ${e.date.substring(0, 10)}` : '';
        // A moved action names the Pull Request it runs from now: the git providers link "#42"
        const jobRef = e.status === 'moved' && e.movedTo
          ? `<br/>moved to #${e.movedTo}`
          : e.jobUrl ? `<br/>[${e.jobId}](${e.jobUrl})` : '';
        const statusIcon = getStatusIcon(e.status);
        usedMatrixIcons.push(statusIcon);
        return `${statusIcon}${dateStr}${jobRef}${encodeOutputsMarker(e.outputs)}${encodeMetaMarker(e)}`;
      });
      body += `| <!-- actionId:${encodeActionId(actionId)} order:${order} --> ${label} | ${when} |${cells.map((cellContent) => ` ${cellContent} |`).join('')}\n`;
    }
    body += buildMatrixStatusLegend(usedMatrixIcons);
    body += `\n*Last updated: ${new Date().toISOString().replace('T', ' ').substring(0, 16)} UTC*\n`;
  }

  // Details section - one collapsible per unique action, covering all orgs it ran in.
  // When actionDefs is provided (from the PR YAML), action properties are shown even for
  // actions that were skipped or not yet run.
  const actionGroups = new Map<string, DeploymentActionStateEntry[]>();
  for (const e of sorted) {
    if (!actionGroups.has(e.actionId)) actionGroups.set(e.actionId, []);
    actionGroups.get(e.actionId)!.push(e);
  }

  // Also include actions present in the YAML but not yet in any state entry
  if (actionDefs) {
    for (const [actionId] of actionDefs) {
      if (!actionGroups.has(actionId)) {
        actionGroups.set(actionId, []);
      }
    }
  }

  if (actionGroups.size > 0) {
    body += `\n<details>\n<summary>Action Details</summary>\n`;

    // Sort unique actions by when then executionOrder.
    // Actions with no entries use the ActionDef for ordering; entries take precedence otherwise.
    const uniqueActionIds = [...actionGroups.keys()].sort((a, b) => {
      const ea = actionGroups.get(a)?.[0];
      const eb = actionGroups.get(b)?.[0];
      const defA = actionDefs?.get(a);
      const defB = actionDefs?.get(b);
      const whenA = ((ea?.when ?? defA?.when) === 'pre-deploy') ? 0 : 1;
      const whenB = ((eb?.when ?? defB?.when) === 'pre-deploy') ? 0 : 1;
      if (whenA !== whenB) return whenA - whenB;
      const orderA = ea?.executionOrder ?? defA?.executionOrder ?? 0;
      const orderB = eb?.executionOrder ?? defB?.executionOrder ?? 0;
      return orderA - orderB;
    });

    for (const actionId of uniqueActionIds) {
      const actionEntries = actionGroups.get(actionId)!;
      const def = actionDefs?.get(actionId);
      const firstEntry = actionEntries[0];
      const displayLabel = firstEntry?.actionLabel ?? def?.label ?? actionId;
      const displayWhen = firstEntry?.when ?? def?.when ?? 'post-deploy';
      const displayOrder = firstEntry?.executionOrder ?? def?.executionOrder;
      const orderAttr = displayOrder != null ? ` order:${displayOrder}` : '';

      body += `\n<details>\n<!-- actionId:${encodeActionId(actionId)}${orderAttr} -->\n`;
      body += `<summary>${displayLabel} (${displayWhen})</summary>\n\n`;

      body += buildActionPropertiesSection(actionId, def);

      if (actionEntries.length > 0) {
        const sortedOrgEntries = [...actionEntries].sort((a, b) => {
          const wDiff = getOrgBranchWeight(a.orgBranch) - getOrgBranchWeight(b.orgBranch);
          if (wDiff !== 0) return wDiff;
          return a.orgBranch.localeCompare(b.orgBranch);
        });

        body += buildActionResultsTable(sortedOrgEntries);
        // Outputs cannot live in a table cell (code blocks do not render there), so they follow the
        // table, one block per org branch that produced some output.
        for (const e of sortedOrgEntries) {
          if ((e.output || '').trim() !== '') {
            body += `**Output - ${e.orgBranch}**\n\n`;
            body += '```\n' + truncateOutput(e.output) + '\n```\n\n';
          }
        }
      } else {
        body += `*No results yet - action has not been executed in any org.*\n\n`;
      }

      body += '</details>\n';
    }

    body += `\n</details>\n`;
  }
  // Same footer as the other sfdx-hardis Pull Request comments
  const cloudityBanner = getBannerMarkdownAndLink();
  if (cloudityBanner) {
    body += `\n${cloudityBanner}\n`;
  }
  return body;
}

/**
 * Human-readable status of a state entry, for the results table of the details section.
 * Same wording as the matrix legend, so the two tables read alike.
 */
function getStatusLabel(status: DeploymentActionStateEntry['status']): string {
  switch (status) {
    case 'success': return 'success';
    case 'failed': return 'failed';
    case 'warning': return 'warning (failed, allowed to fail)';
    case 'manual': return 'waiting for manual execution';
    case 'skipped': return 'skipped';
    case 'not-run': return 'not run, a previous action failed';
    case 'moved': return 'moved to another Pull Request';
    default: return 'unknown';
  }
}

/**
 * Results of an action, one row per org branch it ran in.
 */
function buildActionResultsTable(entries: DeploymentActionStateEntry[]): string {
  // The Note column only appears when an entry carries one (closed by hand, run locally, moved)
  const withNotes = entries.some((e) => (e.note || '').trim() !== '' || e.movedTo);
  let table = `**Results by org**\n\n`;
  table += withNotes ? `| Org branch | Status | Date | Job | Note |\n` : `| Org branch | Status | Date | Job |\n`;
  table += withNotes ? `|------------|--------|------|-----|------|\n` : `|------------|--------|------|-----|\n`;
  for (const e of entries) {
    const status = e.status === 'moved' && e.movedTo
      ? `${getStatusIcon(e.status)} moved to #${e.movedTo}`
      : `${getStatusIcon(e.status)} ${getStatusLabel(e.status)}`;
    const date = e.date ? e.date.substring(0, 10) : '';
    const job = e.jobUrl ? `[${e.jobId}](${e.jobUrl})` : (e.jobId || '');
    table += withNotes
      ? `| ${e.orgBranch} | ${status} | ${date} | ${job} | ${sanitizeCellText(e.note || '')} |\n`
      : `| ${e.orgBranch} | ${status} | ${date} | ${job} |\n`;
  }
  return table + '\n';
}

/**
 * Build the properties description for an action in the details section: a two-column table,
 * then the manual instructions as a block (they are numbered, multi-line steps that would not
 * read in a cell).
 */
function buildActionPropertiesSection(actionId: string, def?: ActionDef): string {
  const rows: [string, string][] = [['ID', `\`${actionId}\``]];
  if (!def) {
    rows.push(['Properties', '*not available - YAML file not found*']);
    return buildPropertiesTable(rows);
  }

  rows.push(['Type', def.type]);
  rows.push(['Context', def.context ?? 'all']);
  rows.push(['Run only once per org', def.runOnlyOnceByOrg !== false ? 'yes' : 'no']);
  rows.push(['Allow failure', def.allowFailure === true ? 'yes' : 'no']);
  if (def.customUsername) {
    rows.push(['Custom username', `\`${def.customUsername}\``]);
  }
  if (Array.isArray(def.includeTargetBranches) && def.includeTargetBranches.length > 0) {
    rows.push(['Include target branches', def.includeTargetBranches.join(', ')]);
  }
  if (Array.isArray(def.excludeTargetBranches) && def.excludeTargetBranches.length > 0) {
    rows.push(['Exclude target branches', def.excludeTargetBranches.join(', ')]);
  }

  if (def.type === 'command' && def.command) {
    rows.push(['Command', `\`${def.command}\``]);
  } else if (def.type === 'apex' && def.parameters?.apexScript) {
    rows.push(['Apex script', `\`${def.parameters.apexScript}\``]);
  } else if (def.type === 'data' && def.parameters?.sfdmuProject) {
    rows.push(['SFDMU project', `\`${def.parameters.sfdmuProject}\``]);
  } else if (def.type === 'publish-community' && def.parameters?.communityName) {
    rows.push(['Community name', def.parameters.communityName]);
  } else if (def.type === 'schedule-batch') {
    if (def.parameters?.className) rows.push(['Class name', `\`${def.parameters.className}\``]);
    if (def.parameters?.cronExpression) rows.push(['Cron expression', `\`${def.parameters.cronExpression}\``]);
    if (def.parameters?.jobName) rows.push(['Job name', def.parameters.jobName]);
  } else if (def.type === 'run-batch') {
    if (def.parameters?.className) rows.push(['Class name', `\`${def.parameters.className}\``]);
    rows.push(['Run mode', def.parameters?.runMode === 'no-wait' ? 'no-wait' : 'wait']);
    if (def.parameters?.batchSize) rows.push(['Batch size', String(def.parameters.batchSize)]);
    if (def.parameters?.waitTimeoutMinutes) rows.push(['Wait timeout (minutes)', String(def.parameters.waitTimeoutMinutes)]);
    if (def.parameters?.successEvenIfBatchErrors === true) rows.push(['Success even if batch errors', 'true']);
  } else if (def.type === 'remove-packagexml-items' && Array.isArray(def.parameters?.packageXmlItems)) {
    rows.push(['Package.xml items to remove', def.parameters.packageXmlItems.map((item: string) => `\`${item}\``).join(', ')]);
  }

  if (def.parameters) {
    const knownParams = new Set(['apexScript', 'sfdmuProject', 'communityName', 'instructions', 'className', 'cronExpression', 'jobName', 'packageXmlItems', 'runMode', 'batchSize', 'waitTimeoutMinutes', 'successEvenIfBatchErrors']);
    for (const [k, v] of Object.entries(def.parameters)) {
      if (!knownParams.has(k)) {
        rows.push([k, String(v)]);
      }
    }
  }

  let section = buildPropertiesTable(rows);
  if (def.type === 'manual' && def.parameters?.instructions) {
    section += `**Instructions**\n\n${def.parameters.instructions.trim()}\n\n`;
  }
  return section;
}

function buildPropertiesTable(rows: [string, string][]): string {
  let table = `| Property | Value |\n`;
  table += `|----------|-------|\n`;
  for (const [property, value] of rows) {
    table += `| ${property} | ${sanitizeCellValue(value)} |\n`;
  }
  return table + '\n';
}

// A value rendered as inline code (a command, a script path) cannot use the HTML entity for the
// pipe: entities are not decoded inside code spans, so the reader would see '&#124;'. The
// backslash escape is what the table syntax provides for that case.
function sanitizeCellValue(value: string): string {
  const text = (value || '').replace(/\r?\n/g, ' ');
  return text.includes('`') ? text.replace(/\|/g, '\\|') : text.replace(/\|/g, '&#124;');
}

/**
 * Build the hidden marker set on a manual action checklist item.
 * prNumber is the Pull Request that owns the action (0 when unknown: the checkbox sync then
 * falls back to the Pull Request hosting the comment).
 */
export function buildManualActionCheckboxMarker(actionId: string, orgBranch: string, prNumber: number, when?: ActionWhen): string {
  const whenAttr = when ? ` when:${when}` : '';
  return `${MANUAL_ACTION_CHECKBOX_MARKER_PREFIX}id:${encodeActionId(actionId)} org:${orgBranch} pr:${prNumber || 0}${whenAttr} -->`;
}

/**
 * Build the hidden marker set on a failed (or stopped) action checklist item. Same attributes as
 * the manual action marker, so both kinds go through the same checkbox sync.
 */
export function buildFailedActionCheckboxMarker(actionId: string, orgBranch: string, prNumber: number, when?: ActionWhen): string {
  const whenAttr = when ? ` when:${when}` : '';
  return `${FAILED_ACTION_CHECKBOX_MARKER_PREFIX}id:${encodeActionId(actionId)} org:${orgBranch} pr:${prNumber || 0}${whenAttr} -->`;
}

/**
 * Note of a failed or stopped action closed by hand by a person, written in the Pull Request
 * comment (English, like the rest of the comment).
 * Ex: "Failed in CI, then closed by hand by Jane Doe (jane@acme.com) on 2026-10-03 14:05 UTC."
 */
export function buildClosedByHandNote(previousStatus: 'failed' | 'not-run' | 'manual', gitUser: string | null, sfUsername: string | null, date: Date, extraNote?: string): string {
  const who = [gitUser, sfUsername ? `(${sfUsername})` : null].filter(Boolean).join(' ') || 'unknown user';
  const origin = previousStatus === 'not-run' ? 'Not run in CI' : 'Failed in CI';
  const note = previousStatus === 'manual'
    ? `Manual action marked as done by ${who} on ${formatNoteDate(date)}.`
    : `${origin}, then closed by hand by ${who} on ${formatNoteDate(date)}.`;
  return extraNote && extraNote.trim() !== '' ? `${note} ${extraNote.trim()}` : note;
}

/**
 * Note of an action marked as done in an org branch where it never failed: done by hand before any
 * deployment reached that org (a manual action of the next promotion, for instance), or skipped there.
 */
export function buildMarkedDoneAheadNote(orgBranch: string, previousStatus: 'none' | 'skipped', gitUser: string | null, sfUsername: string | null, date: Date, extraNote?: string): string {
  const who = [gitUser, sfUsername ? `(${sfUsername})` : null].filter(Boolean).join(' ') || 'unknown user';
  const note = previousStatus === 'skipped'
    ? `Skipped in CI, then marked as done by ${who} on ${formatNoteDate(date)}.`
    : `Marked as done by ${who} on ${formatNoteDate(date)}, before any deployment to ${orgBranch}.`;
  return extraNote && extraNote.trim() !== '' ? `${note} ${extraNote.trim()}` : note;
}

/**
 * Note of a failed or stopped action closed by ticking its checkbox. Git providers do not tell
 * who ticked a box without extra API calls, so the note names the Pull Request instead.
 */
export function buildClosedByCheckboxNote(previousStatus: 'failed' | 'not-run', commentPrNumber: number): string {
  const origin = previousStatus === 'not-run' ? 'Not run in CI' : 'Failed in CI';
  return `${origin}, then closed by hand via a checkbox in Pull Request #${commentPrNumber} (detected on ${formatNoteDate(new Date())}).`;
}

/**
 * Note of an action retried outside of a deployment job by sf hardis:project:action:run.
 */
export function buildRunLocallyNote(gitUser: string | null, sfUsername: string | null, inCi: boolean): string {
  const who = [gitUser, sfUsername ? `(${sfUsername})` : null].filter(Boolean).join(' ') || 'unknown user';
  return inCi
    ? `Retried by sf hardis:project:action:run as ${who} on ${formatNoteDate(new Date())}.`
    : `Run locally by ${who} on ${formatNoteDate(new Date())}.`;
}

function formatNoteDate(date: Date): string {
  return `${date.toISOString().replace('T', ' ').substring(0, 16)} UTC`;
}

export interface ManualActionCheckboxItem {
  actionId: string;
  orgBranch: string;
  prNumber: number;
  when?: ActionWhen;
  checked: boolean;
  label: string;
  // 'manual': a manual action performed by hand, 'failed': a failed or stopped action closed by hand
  kind: 'manual' | 'failed';
}

// The literals 'sfdx-hardis-manual-action' and 'sfdx-hardis-failed-action' here MUST stay in sync
// with MANUAL_ACTION_CHECKBOX_MARKER_PREFIX and FAILED_ACTION_CHECKBOX_MARKER_PREFIX
const MANUAL_ACTION_CHECKBOX_REGEX = /^\s*[-*] \[( |x|X)\] <!-- sfdx-hardis-(manual|failed)-action id:(\S+) org:(\S+) pr:(\d+)(?: when:(pre-deploy|post-deploy))? -->\s*(.*)$/;

/**
 * Extract the manual and failed action checklist items (ticked or not) from a Pull Request comment body.
 */
export function parseManualActionCheckboxes(body: string): ManualActionCheckboxItem[] {
  const items: ManualActionCheckboxItem[] = [];
  for (const line of body.split('\n')) {
    const match = line.match(MANUAL_ACTION_CHECKBOX_REGEX);
    if (!match) continue;
    items.push({
      checked: match[1].toLowerCase() === 'x',
      kind: match[2] as 'manual' | 'failed',
      actionId: decodeActionId(match[3]),
      orgBranch: match[4],
      prNumber: parseInt(match[5], 10),
      when: match[6] ? (match[6] as ActionWhen) : undefined,
      label: unsanitizeCellText((match[7] || '').replace(/\*\(org branch: [^)]*\)\*\s*$/, '').trim()),
    });
  }
  return items;
}

/**
 * Tick the checkbox of a manual action in a comment body. Returns the updated body and
 * whether a line was actually changed.
 */
export function checkManualActionCheckboxInBody(body: string, actionId: string, orgBranch: string): { body: string; changed: boolean } {
  let changed = false;
  const lines = body.split('\n').map((line) => {
    const match = line.match(MANUAL_ACTION_CHECKBOX_REGEX);
    if (match && decodeActionId(match[3]) === actionId && match[4] === orgBranch && match[1] === ' ') {
      changed = true;
      // Tick the checkbox itself: the regex accepts both '-' and '*' bullets, and the first
      // '[ ]' of a matched line is always the checkbox
      return line.replace('[ ]', '[x]');
    }
    return line;
  });
  return { body: lines.join('\n'), changed };
}

function findEntryAnyStatus(actionId: string, orgBranch: string | null): DeploymentActionStateEntry | null {
  const state = getMultiPrState();
  for (const entries of state.entriesByPr.values()) {
    const found = entries.find((e) => e.actionId === actionId && (orgBranch === null || e.orgBranch.trim() === orgBranch.trim()));
    if (found) return found;
  }
  return null;
}

/**
 * Detect the manual action checkboxes ticked by users in Pull Request comments (check results,
 * deployment results, or the Deployment Actions state comment), record the ticked actions as done
 * for their org branch, and tick the same checkbox in the other comments where it appears.
 * Must be called AFTER loadDeploymentActionsState, so already-recorded actions are known.
 */
export async function syncManualActionCheckboxes(sourcePrNumbers: number[]): Promise<void> {
  const state = getMultiPrState();
  const prsToScan = [...new Set(sourcePrNumbers)].filter((n) => n > 0 && !state.syncedCheckboxPrs.has(n));
  if (prsToScan.length === 0) {
    return;
  }
  const allComments: PullRequestCommentRef[] = [];
  for (const prNum of prsToScan) {
    // One listing for both kinds of checklists: the prefix the two markers share. Listing per
    // marker would read every comment of the Pull Request twice on every job.
    const comments = await GitProvider.tryListPullRequestCommentsByMarker(CHECKBOX_MARKER_COMMON_PREFIX, prNum);
    if (comments === null) {
      // Transient listing error: leave the PR unmarked so a later phase or job retries it
      continue;
    }
    state.syncedCheckboxPrs.add(prNum);
    allComments.push(...comments.filter((comment) =>
      comment.body.includes(MANUAL_ACTION_CHECKBOX_MARKER_PREFIX) || comment.body.includes(FAILED_ACTION_CHECKBOX_MARKER_PREFIX)
    ));
  }
  if (allComments.length === 0) {
    return;
  }

  // Record every ticked checkbox as a performed action (once per actionId + org branch)
  let newlyConfirmed = 0;
  const processedPairs = new Set<string>();
  for (const comment of allComments) {
    for (const item of parseManualActionCheckboxes(comment.body)) {
      if (!item.checked) continue;
      const pairKey = `${item.actionId}||${item.orgBranch}`;
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);
      const sourcePr = item.prNumber > 0 ? item.prNumber : comment.prNumber;
      // A comment can carry checkboxes of Pull Requests outside the current scope (the validation
      // comment of a promotion lists the manual actions of every Pull Request it carries). Their
      // state is not loaded with the scope: without this, an already-recorded tick is not found,
      // gets recorded again with today's date and this job, and the source Pull Request's comment
      // is rewritten on every run that scans this comment.
      await loadDeploymentActionsState([sourcePr]);
      if (checkActionInState(item.actionId, item.orgBranch)) continue; // already recorded as done
      const base = findEntryAnyStatus(item.actionId, item.orgBranch) || findEntryAnyStatus(item.actionId, null);
      const label = base?.actionLabel || item.label || item.actionId;
      const { jobId, jobUrl } = await getJobInfoWithUrl();
      const closedFailure = item.kind === 'failed';
      upsertActionInState({
        actionId: item.actionId,
        actionLabel: label,
        orgBranch: item.orgBranch,
        when: base?.when || item.when || 'post-deploy',
        executionOrder: base?.executionOrder ?? 0,
        status: 'success',
        jobId,
        jobUrl,
        date: new Date().toISOString(),
        output: closedFailure
          ? 'Closed by hand via a ticked checkbox in a Pull Request comment.'
          : 'Confirmed as done via a ticked checkbox in a Pull Request comment.',
        note: closedFailure
          ? buildClosedByCheckboxNote(base?.status === 'not-run' ? 'not-run' : 'failed', comment.prNumber)
          : undefined,
      }, sourcePr);
      // Two statements, not a ternary of the two keys: on one line, a 32 character key after the
      // word "Checkbox" matches the box-api-access-token rule of the secret scanners
      let confirmedMessage = t('manualActionConfirmedViaCheckbox', { label, orgBranch: item.orgBranch });
      if (closedFailure) {
        confirmedMessage = t('failedActionConfirmedViaCheckbox', { label, orgBranch: item.orgBranch });
      }
      uxLog("action", null, c.cyan(`[DeploymentActions] ${confirmedMessage}`));
      newlyConfirmed++;
    }
  }
  if (newlyConfirmed > 0) {
    await persistDeploymentActionsState();
  }

  // Tick the checkbox in the other comments still showing the action as pending.
  // The Deployment Actions state comments are skipped: persistDeploymentActionsState rebuilds them.
  for (const comment of allComments) {
    if (comment.body.includes(DEPLOYMENT_ACTIONS_MARKER)) continue;
    let updatedBody = comment.body;
    let changed = false;
    for (const item of parseManualActionCheckboxes(updatedBody)) {
      if (!item.checked && checkActionInState(item.actionId, item.orgBranch)) {
        const res = checkManualActionCheckboxInBody(updatedBody, item.actionId, item.orgBranch);
        updatedBody = res.body;
        changed = changed || res.changed;
      }
    }
    if (changed) {
      await GitProvider.tryUpdatePullRequestCommentByRef(comment, updatedBody);
      uxLog("log", null, c.grey(`[DeploymentActions] ${t('manualActionCheckboxPropagated', { pr: comment.prNumber })}`));
    }
  }
}

// Augment globalThis types
declare global {
  // eslint-disable-next-line no-var
  var _deploymentActionsMultiPrState: DeploymentActionsMultiPrState | undefined;
}
