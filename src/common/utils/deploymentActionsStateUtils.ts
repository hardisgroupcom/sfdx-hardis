import { GitProvider } from '../gitProvider/index.js';

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

export async function loadDeploymentActionsState(): Promise<DeploymentActionStateEntry[]> {
  if (globalThis._deploymentActionsState !== undefined) {
    return globalThis._deploymentActionsState as DeploymentActionStateEntry[];
  }
  const body = await GitProvider.tryGetDeploymentActionsCommentBody();
  if (!body) {
    globalThis._deploymentActionsState = [];
    return [];
  }
  const entries = parseDeploymentActionsCommentBody(body);
  globalThis._deploymentActionsState = entries;
  return entries;
}

export function checkActionInState(actionId: string, orgBranch: string): DeploymentActionStateEntry | null {
  const state: DeploymentActionStateEntry[] = globalThis._deploymentActionsState || [];
  return state.find(e => e.actionId === actionId && e.orgBranch.trim() === orgBranch.trim() && e.status === 'success') || null;
}

export function upsertActionInState(entry: DeploymentActionStateEntry): void {
  if (!globalThis._deploymentActionsState) {
    globalThis._deploymentActionsState = [];
  }
  const state: DeploymentActionStateEntry[] = globalThis._deploymentActionsState;
  const idx = state.findIndex(e => e.actionId === entry.actionId && e.orgBranch === entry.orgBranch);
  if (idx >= 0) {
    state[idx] = entry;
  } else {
    state.push(entry);
  }
}

export async function persistDeploymentActionsState(): Promise<void> {
  const state: DeploymentActionStateEntry[] = globalThis._deploymentActionsState || [];
  const body = buildDeploymentActionsCommentBody(state);
  await GitProvider.tryUpsertDeploymentActionsComment(body);
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
    case 'failed':  return '\u274c';   // ❌
    case 'manual':  return '\ud83d\udc4b'; // 👋
    case 'skipped': return '\u26aa';   // ⚪
    default:        return '\u2753';   // ❓
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
      body += `\n<details id="state-${e.actionId}-${e.orgBranch.replace(/[^a-zA-Z0-9-]/g, '-')}">\n`;
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
  var _deploymentActionsState: DeploymentActionStateEntry[] | undefined;
}
