import c from "chalk";
import { GitProvider } from '../gitProvider/index.js';
import { ActionWhen, PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { readActions } from './actionUtils.js';
import { uxLog } from './index.js';

export const DEPLOYMENT_ACTIONS_MARKER = '<!-- sfdx-hardis deployment-actions-state -->';

export interface DeploymentActionStateEntry {
  actionId: string;
  actionLabel: string;
  orgBranch: string;
  when: ActionWhen;
  executionOrder: number;
  status: 'success' | 'failed' | 'manual' | 'skipped';
  jobId: string;
  jobUrl: string;
  date: string;
  output?: string;
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
  for (const prNumber of uniquePrs) {
    try {
      const body = await GitProvider.tryGetDeploymentActionsCommentBodyForPr(prNumber);
      if (body) {
        const entries = parseDeploymentActionsCommentBody(body);
        state.entriesByPr.set(prNumber, entries);
        uxLog("log", null, c.cyan(`Loaded ${entries.length} deployment actions state entries from PR #${prNumber}.`));
        uxLog("other", null, c.grey(JSON.stringify(entries, null, 2)));
      } else {
        state.entriesByPr.set(prNumber, []);
      }
    } catch (e) {
      uxLog("warning", null, c.yellow(`Could not load deployment actions state from PR #${prNumber}: ${(e as Error).message}`));
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
 * Action definitions are read from the PR's .sfdx-hardis.PRNB.yml file.
 */
export async function persistDeploymentActionsState(): Promise<void> {
  const state = getMultiPrState();
  for (const prNumber of state.dirtyPrs) {
    const inMemoryEntries = state.entriesByPr.get(prNumber) || [];
    // Re-read the current PR comment and merge to preserve entries from other org branches
    const mergedEntries = await mergeWithExistingComment(prNumber, inMemoryEntries);
    // Update the in-memory state with the merged result so subsequent persists stay consistent
    state.entriesByPr.set(prNumber, mergedEntries);
    // Load action definitions from the PR's YAML file to populate the details section
    const actionDefs = await loadActionDefsFromPrYaml(prNumber);
    const body = buildDeploymentActionsCommentBody(mergedEntries, actionDefs);
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
    // | <!-- actionId:ID order:N --> Label | orgBranch | when | status | [jobId](jobUrl) |
    const rowMatch = line.match(/^\|\s*<!--\s*actionId:(\S+?)(?:\s+order:(\d+))?\s*-->\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|/);
    if (!rowMatch) continue;

    const actionId = rowMatch[1].trim();
    const executionOrder = rowMatch[2] ? parseInt(rowMatch[2], 10) : 0;
    const actionLabel = rowMatch[3].trim();
    const orgBranch = rowMatch[4].trim();
    const when: ActionWhen = rowMatch[5].trim() === 'pre-deploy' ? 'pre-deploy' : 'post-deploy';
    const statusCell = rowMatch[6].trim();
    const jobCell = rowMatch[7].trim();

    const status: DeploymentActionStateEntry['status'] =
      statusCell.includes('\u2705') ? 'success' :
        statusCell.includes('\u274c') ? 'failed' :
          statusCell.includes('\ud83d\udc4b') ? 'manual' :
            statusCell.includes('\u26aa') ? 'skipped' : 'failed';
    const dateMatch = statusCell.match(/\(([^)]+)\)/);
    const date = dateMatch ? dateMatch[1] : '';
    const jobLinkMatch = jobCell.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const jobId = jobLinkMatch ? jobLinkMatch[1] : jobCell;
    const jobUrl = jobLinkMatch ? jobLinkMatch[2] : '';
    entries.push({ actionId, actionLabel, orgBranch, when, executionOrder, status, jobId, jobUrl, date, output: '' });
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

export function buildDeploymentActionsCommentBody(entries: DeploymentActionStateEntry[], actionDefs?: Map<string, ActionDef>): string {
  // Sort by: org weight (integ → prod), then when (pre-deploy before post-deploy), then execution order
  const sorted = [...entries].sort((a, b) => {
    const weightDiff = getOrgBranchWeight(a.orgBranch) - getOrgBranchWeight(b.orgBranch);
    if (weightDiff !== 0) return weightDiff;
    const whenA = a.when === 'pre-deploy' ? 0 : 1;
    const whenB = b.when === 'pre-deploy' ? 0 : 1;
    if (whenA !== whenB) return whenA - whenB;
    return (a.executionOrder ?? 0) - (b.executionOrder ?? 0);
  });

  let body = `${DEPLOYMENT_ACTIONS_MARKER}\n## Deployment Actions\n\n`;
  body += `> ⚠️ This section is automatically managed by sfdx-hardis. Do not edit it manually.\n\n`;
  body += `| Action | Org branch | When | Status | Job |\n`;
  body += `|--------|------------|------|--------|-----|\n`;
  for (const e of sorted) {
    const statusIcon = getStatusIcon(e.status);
    const dateStr = e.date ? ` (${e.date.substring(0, 10)})` : '';
    const statusCell = `${statusIcon} ${e.status}${dateStr}`;
    const jobCell = e.jobUrl ? `[${e.jobId}](${e.jobUrl})` : e.jobId;
    const orderAttr = e.executionOrder != null ? ` order:${e.executionOrder}` : '';
    body += `| <!-- actionId:${e.actionId}${orderAttr} --> ${e.actionLabel} | ${e.orgBranch} | ${e.when} | ${statusCell} | ${jobCell} |\n`;
  }

  // Details section — one collapsible per unique action, covering all orgs it ran in.
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

      body += `\n<details>\n<!-- actionId:${actionId}${orderAttr} -->\n`;
      body += `<summary>${displayLabel} (${displayWhen})</summary>\n\n`;

      body += buildActionPropertiesSection(actionId, def);

      if (actionEntries.length > 0) {
        const sortedOrgEntries = [...actionEntries].sort((a, b) => {
          const wDiff = getOrgBranchWeight(a.orgBranch) - getOrgBranchWeight(b.orgBranch);
          if (wDiff !== 0) return wDiff;
          return a.orgBranch.localeCompare(b.orgBranch);
        });

        body += `**Results by org:**\n\n`;
        for (const e of sortedOrgEntries) {
          const statusIcon = getStatusIcon(e.status);
          const dateStr = e.date ? ` (${e.date.substring(0, 10)})` : '';
          const jobRef = e.jobUrl ? ` — [${e.jobId}](${e.jobUrl})` : (e.jobId ? ` — ${e.jobId}` : '');
          body += `*${e.orgBranch} — ${statusIcon} ${e.status}${dateStr}${jobRef}*\n\n`;
          if (e.output) {
            const truncated = truncateOutput(e.output);
            body += '```\n' + truncated + '\n```\n\n';
          }
        }
      } else {
        body += `*No results yet — action has not been executed in any org.*\n\n`;
      }

      body += '</details>\n';
    }

    body += `\n</details>\n`;
  }
  return body;
}

/**
 * Build the properties description for an action in the details section.
 */
function buildActionPropertiesSection(actionId: string, def?: ActionDef): string {
  if (!def) {
    return `**ID:** \`${actionId}\` *(properties not available — YAML file not found)*\n\n`;
  }

  let firstLine = `**ID:** \`${actionId}\``;
  firstLine += ` | **Type:** ${def.type}`;
  firstLine += ` | **Context:** ${def.context ?? 'all'}`;
  firstLine += ` | **Run only once per org:** ${def.runOnlyOnceByOrg !== false ? 'yes' : 'no'}`;
  firstLine += ` | **Skip if deployment failed:** ${def.skipIfError === true ? 'yes' : 'no'}`;
  firstLine += ` | **Allow failure:** ${def.allowFailure === true ? 'yes' : 'no'}`;
  if (def.customUsername) {
    firstLine += ` | **Custom username:** \`${def.customUsername}\``;
  }
  let section = firstLine + '\n';

  if (def.type === 'command' && def.command) {
    section += `**Command:** \`${def.command}\`\n`;
  } else if (def.type === 'apex' && def.parameters?.apexScript) {
    section += `**Apex script:** \`${def.parameters.apexScript}\`\n`;
  } else if (def.type === 'data' && def.parameters?.sfdmuProject) {
    section += `**SFDMU project:** \`${def.parameters.sfdmuProject}\`\n`;
  } else if (def.type === 'publish-community' && def.parameters?.communityName) {
    section += `**Community name:** ${def.parameters.communityName}\n`;
  } else if (def.type === 'manual' && def.parameters?.instructions) {
    section += `**Instructions:** ${def.parameters.instructions}\n`;
  } else if (def.type === 'schedule-batch') {
    if (def.parameters?.className) section += `**Class name:** \`${def.parameters.className}\`\n`;
    if (def.parameters?.cronExpression) section += `**Cron expression:** \`${def.parameters.cronExpression}\`\n`;
    if (def.parameters?.jobName) section += `**Job name:** ${def.parameters.jobName}\n`;
  }

  if (def.parameters) {
    const knownParams = new Set(['apexScript', 'sfdmuProject', 'communityName', 'instructions', 'className', 'cronExpression', 'jobName']);
    for (const [k, v] of Object.entries(def.parameters)) {
      if (!knownParams.has(k)) {
        section += `**${k}:** ${v}\n`;
      }
    }
  }

  return section + '\n';
}

// Augment globalThis types
declare global {
  // eslint-disable-next-line no-var
  var _deploymentActionsMultiPrState: DeploymentActionsMultiPrState | undefined;
}
