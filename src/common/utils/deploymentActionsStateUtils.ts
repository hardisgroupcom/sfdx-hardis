import { GitProvider } from '../gitProvider/index.js';
import { uxLog } from './index.js';

export const DEPLOYMENT_ACTIONS_MARKER = '<!-- sfdx-hardis deployment-actions-state -->';

export interface DeploymentActionStateEntry {
  actionId: string;
  actionLabel: string;
  orgBranch: string;
  status: 'success' | 'failed' | 'manual' | 'skipped';
  jobId: string;
  jobUrl: string;
  date: string;
  output?: string;
}

interface DeploymentActionsMultiPrState {
  entriesByPr: Map<number, DeploymentActionStateEntry[]>;
  dirtyPrs: Set<number>;
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
    };
  }
  return globalThis._deploymentActionsMultiPrState;
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
  for (const prNumber of uniquePrs) {
    try {
      const body = await GitProvider.tryGetDeploymentActionsCommentBodyForPr(prNumber);
      if (body) {
        const entries = parseDeploymentActionsCommentBody(body);
        state.entriesByPr.set(prNumber, entries);
        uxLog("log", null, `Loaded ${entries.length} deployment actions state entries from PR #${prNumber}.`);
        uxLog("other", null, JSON.stringify(entries, null, 2));
      } else {
        state.entriesByPr.set(prNumber, []);
      }
    } catch (e) {
      uxLog("warning", null, `Could not load deployment actions state from PR #${prNumber}: ${(e as Error).message}`);
      state.entriesByPr.set(prNumber, []);
    }
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
  if (sourcePrNumber <= 0) return; // No PR context — cannot track
  const state = getMultiPrState();
  if (!state.entriesByPr.has(sourcePrNumber)) {
    state.entriesByPr.set(sourcePrNumber, []);
  }
  const entries = state.entriesByPr.get(sourcePrNumber)!;
  const idx = entries.findIndex(e => e.actionId === entry.actionId && e.orgBranch === entry.orgBranch);
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
 */
export async function persistDeploymentActionsState(): Promise<void> {
  const state = getMultiPrState();
  for (const prNumber of state.dirtyPrs) {
    const inMemoryEntries = state.entriesByPr.get(prNumber) || [];
    // Re-read the current PR comment and merge to preserve entries from other org branches
    const mergedEntries = await mergeWithExistingComment(prNumber, inMemoryEntries);
    // Update the in-memory state with the merged result so subsequent persists stay consistent
    state.entriesByPr.set(prNumber, mergedEntries);
    const body = buildDeploymentActionsCommentBody(mergedEntries);
    await GitProvider.tryUpsertDeploymentActionsCommentForPr(prNumber, body);
  }
  state.dirtyPrs.clear();
}

/**
 * Merge in-memory entries with the entries currently stored in a PR's comment.
 * In-memory entries take precedence for the same actionId+orgBranch pair;
 * entries that only exist in the comment (from other org branches / deployments) are preserved.
 */
async function mergeWithExistingComment(prNumber: number, inMemoryEntries: DeploymentActionStateEntry[]): Promise<DeploymentActionStateEntry[]> {
  let existingEntries: DeploymentActionStateEntry[] = [];
  try {
    const existingBody = await GitProvider.tryGetDeploymentActionsCommentBodyForPr(prNumber);
    if (existingBody) {
      existingEntries = parseDeploymentActionsCommentBody(existingBody);
    }
  } catch (_e) {
    // If re-read fails, proceed with in-memory entries only
  }
  if (existingEntries.length === 0) {
    return inMemoryEntries;
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
  return merged;
}

export function parseDeploymentActionsCommentBody(body: string): DeploymentActionStateEntry[] {
  const entries: DeploymentActionStateEntry[] = [];
  const lines = body.split('\n');
  for (const line of lines) {
    // Match table rows like: | <!-- actionId:ID --> Label | orgBranch | status | [jobId](jobUrl) |
    const rowMatch = line.match(/^\|\s*<!--\s*actionId:([^>]+?)\s*-->\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|/);
    if (!rowMatch) continue;
    const actionId = rowMatch[1].trim();
    const actionLabel = rowMatch[2].trim();
    const orgBranch = rowMatch[3].trim();
    const statusCell = rowMatch[4].trim();
    const jobCell = rowMatch[5].trim();
    const status: DeploymentActionStateEntry['status'] =
      statusCell.includes('\u2705') ? 'success' :
        statusCell.includes('\u274c') ? 'failed' :
          statusCell.includes('\ud83d\udc4b') ? 'manual' :
            statusCell.includes('\u26aa') ? 'skipped' : 'failed';
    // Extract date from status cell: "success (2024-01-15)"
    const dateMatch = statusCell.match(/\(([^)]+)\)/);
    const date = dateMatch ? dateMatch[1] : '';
    // Extract jobId/jobUrl from job cell: "[jobId](jobUrl)" or just "jobId"
    const jobLinkMatch = jobCell.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const jobId = jobLinkMatch ? jobLinkMatch[1] : jobCell;
    const jobUrl = jobLinkMatch ? jobLinkMatch[2] : '';
    entries.push({ actionId, actionLabel, orgBranch, status, jobId, jobUrl, date, output: '' });
  }
  return entries;
}

function getStatusIcon(status: DeploymentActionStateEntry['status']): string {
  switch (status) {
    case 'success': return '\u2705';   // ✅
    case 'failed': return '\u274c';   // ❌
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

export function buildDeploymentActionsCommentBody(entries: DeploymentActionStateEntry[]): string {
  // Sort by org weight (integ → uat → preprod → prod), then by date within each org
  const sorted = [...entries].sort((a, b) => {
    const weightDiff = getOrgBranchWeight(a.orgBranch) - getOrgBranchWeight(b.orgBranch);
    if (weightDiff !== 0) return weightDiff;
    return a.date.localeCompare(b.date);
  });

  let body = `${DEPLOYMENT_ACTIONS_MARKER}\n## Deployment Actions\n\n`;
  body += `> ⚠️ This section is automatically managed by sfdx-hardis. Do not edit it manually.\n\n`;
  body += `| Action | Org branch | Status | Job |\n`;
  body += `|--------|------------|--------|-----|\n`;
  for (const e of sorted) {
    const statusIcon = getStatusIcon(e.status);
    const dateStr = e.date ? ` (${e.date.substring(0, 10)})` : '';
    const statusCell = `${statusIcon} ${e.status}${dateStr}`;
    const jobCell = e.jobUrl ? `[${e.jobId}](${e.jobUrl})` : e.jobId;
    body += `| <!-- actionId:${e.actionId} --> ${e.actionLabel} | ${e.orgBranch} | ${statusCell} | ${jobCell} |\n`;
  }

  // Details section — same sort order as the table
  const withOutput = sorted.filter(e => e.output);
  if (withOutput.length > 0) {
    body += `\n<details>\n<summary>Action Details</summary>\n`;
    for (const e of withOutput) {
      const truncated = truncateOutput(e.output);
      const dateStr = e.date ? e.date.substring(0, 10) : '';
      body += `\n<details>\n<!-- actionId:${e.actionId} -->\n`;
      body += `<summary>${e.actionLabel} (${e.orgBranch}${dateStr ? ' \u2014 ' + dateStr : ''})</summary>\n\n`;
      body += '```\n' + truncated + '\n```\n';
      body += '</details>\n';
    }
    body += `\n</details>\n`;
  }
  return body;
}

// Augment globalThis types
declare global {
  // eslint-disable-next-line no-var
  var _deploymentActionsMultiPrState: DeploymentActionsMultiPrState | undefined;
}
