import c from "chalk";
import { debuglog } from "util";
import { GitProvider } from '../gitProvider/index.js';
import { PullRequestCommentRef } from '../gitProvider/gitProviderRoot.js';
import { ActionWhen, PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { readActions } from './actionUtils.js';
import { uxLog } from './index.js';
import { t } from './i18n.js';
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

export interface DeploymentActionStateEntry {
  actionId: string;
  actionLabel: string;
  orgBranch: string;
  when: ActionWhen;
  executionOrder: number;
  // 'warning' is a failed action whose definition allows failure: the deployment went on, so the
  // outcome must not read as an error in the comment, but the action did not succeed either.
  status: 'success' | 'failed' | 'warning' | 'manual' | 'skipped';
  jobId: string;
  jobUrl: string;
  date: string;
  output?: string;
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
  let counter = 0;
  for (const prNumber of uniquePrs) {
    try {
      const body = await GitProvider.tryGetDeploymentActionsCommentBodyForPr(prNumber);
      if (body) {
        const entries = parseDeploymentActionsCommentBody(body);
        state.entriesByPr.set(prNumber, entries);
        uxLog("log", null, c.grey(`[DeploymentActions] ${t('loadedDeploymentActionsStateEntries', { count: entries.length, pr: prNumber })}`));
        // Full entries are diagnostic data: keep them out of the console unless DEBUG is enabled
        debug(`Deployment actions state entries loaded from PR #${prNumber}: ${JSON.stringify(entries, null, 2)}`);
      } else {
        state.entriesByPr.set(prNumber, []);
      }
    } catch (e) {
      uxLog("warning", null, c.yellow(`Could not load deployment actions state from PR #${prNumber}: ${(e as Error).message}`));
      state.entriesByPr.set(prNumber, []);
    }
    counter++;
    if (showProgress) {
      WebSocketClient.sendProgressStepMessage(counter, uniquePrs.length);
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
  // A skip is the absence of an outcome, not an outcome: it must never erase the record that the
  // action was performed in the org. Without this, a ticked check-only manual action ping-pongs
  // forever on deployment jobs: the checkbox sync records success, the context skip overwrites it
  // with skipped, and the next job's sync cannot find the success entry and records the tick
  // again, re-dating the entry and rewriting the Pull Request comment on every run.
  if (idx >= 0 && entry.status === 'skipped' && entries[idx].status === 'success') {
    return;
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
          cell.includes('\u26aa') ? 'skipped' : 'failed';
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

function getStatusIcon(status: DeploymentActionStateEntry['status']): string {
  switch (status) {
    case 'success': return '\u2705';   // ✅
    case 'failed': return '\u274c';   // ❌
    case 'warning': return '\u26a0\ufe0f'; // ⚠️
    case 'manual': return '\ud83d\udc4b'; // 👋
    case 'skipped': return '\u26aa';   // ⚪
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
  if (entries.some((e) => e.status === 'failed')) {
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
  body += `> ⚠️ This section is automatically managed by sfdx-hardis. Do not edit it manually, except to tick a checkbox in the "Pending manual actions" list once you have performed the action.\n\n`;

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
        const jobRef = e.jobUrl ? `<br/>[${e.jobId}](${e.jobUrl})` : '';
        const statusIcon = getStatusIcon(e.status);
        usedMatrixIcons.push(statusIcon);
        return `${statusIcon}${dateStr}${jobRef}`;
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
    default: return 'unknown';
  }
}

/**
 * Results of an action, one row per org branch it ran in.
 */
function buildActionResultsTable(entries: DeploymentActionStateEntry[]): string {
  let table = `**Results by org**\n\n`;
  table += `| Org branch | Status | Date | Job |\n`;
  table += `|------------|--------|------|-----|\n`;
  for (const e of entries) {
    const status = `${getStatusIcon(e.status)} ${getStatusLabel(e.status)}`;
    const date = e.date ? e.date.substring(0, 10) : '';
    const job = e.jobUrl ? `[${e.jobId}](${e.jobUrl})` : (e.jobId || '');
    table += `| ${e.orgBranch} | ${status} | ${date} | ${job} |\n`;
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
  } else if (def.type === 'remove-packagexml-items' && Array.isArray(def.parameters?.packageXmlItems)) {
    rows.push(['Package.xml items to remove', def.parameters.packageXmlItems.map((item: string) => `\`${item}\``).join(', ')]);
  }

  if (def.parameters) {
    const knownParams = new Set(['apexScript', 'sfdmuProject', 'communityName', 'instructions', 'className', 'cronExpression', 'jobName', 'packageXmlItems']);
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

export interface ManualActionCheckboxItem {
  actionId: string;
  orgBranch: string;
  prNumber: number;
  when?: ActionWhen;
  checked: boolean;
  label: string;
}

// The literal 'sfdx-hardis-manual-action' here MUST stay in sync with MANUAL_ACTION_CHECKBOX_MARKER_PREFIX
const MANUAL_ACTION_CHECKBOX_REGEX = /^\s*[-*] \[( |x|X)\] <!-- sfdx-hardis-manual-action id:(\S+) org:(\S+) pr:(\d+)(?: when:(pre-deploy|post-deploy))? -->\s*(.*)$/;

/**
 * Extract the manual action checklist items (ticked or not) from a Pull Request comment body.
 */
export function parseManualActionCheckboxes(body: string): ManualActionCheckboxItem[] {
  const items: ManualActionCheckboxItem[] = [];
  for (const line of body.split('\n')) {
    const match = line.match(MANUAL_ACTION_CHECKBOX_REGEX);
    if (!match) continue;
    items.push({
      checked: match[1].toLowerCase() === 'x',
      actionId: decodeActionId(match[2]),
      orgBranch: match[3],
      prNumber: parseInt(match[4], 10),
      when: match[5] ? (match[5] as ActionWhen) : undefined,
      label: unsanitizeCellText((match[6] || '').replace(/\*\(org branch: [^)]*\)\*\s*$/, '').trim()),
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
    if (match && decodeActionId(match[2]) === actionId && match[3] === orgBranch && match[1] === ' ') {
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
    const comments = await GitProvider.tryListPullRequestCommentsByMarker(MANUAL_ACTION_CHECKBOX_MARKER_PREFIX, prNum);
    if (comments === null) {
      // Transient listing error: leave the PR unmarked so a later phase or job retries it
      continue;
    }
    state.syncedCheckboxPrs.add(prNum);
    allComments.push(...comments);
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
        output: 'Confirmed as done via a ticked checkbox in a Pull Request comment.',
      }, sourcePr);
      uxLog("action", null, c.cyan(`[DeploymentActions] ${t('manualActionConfirmedViaCheckbox', { label, orgBranch: item.orgBranch })}`));
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
