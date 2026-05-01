/* jscpd:ignore-start */
import c from "chalk";
import fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import Papa from "papaparse";
import { arrayUniqueByKey, execCommand, getCurrentGitBranch, git, isCI, uxLog } from "./index.js";
import { CommonPullRequestInfo, GitProvider } from "../gitProvider/index.js";
import { Ticket, TicketProvider } from "../ticketProvider/index.js";
import { listMajorOrgs, isProduction } from "./orgConfigUtils.js";
import { getGitDeltaScope, callSfdxGitDelta } from "./gitUtils.js";
import { parsePackageXmlFile } from "./xmlUtils.js";
import {
  DeploymentActionStateEntry,
  loadDeploymentActionsState,
} from "./deploymentActionsStateUtils.js";
import { readActions } from "./actionUtils.js";
import { ActionWhen } from "../actionsProvider/actionsProvider.js";
import { AiProvider } from "../aiProvider/index.js";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { NotifProvider } from "../notifProvider/index.js";
import { NotifSeverity } from "../notifProvider/types.js";
import { createXlsxFromCsvFiles } from "./filesUtils.js";
import { getNotificationButtons } from "./notifUtils.js";
import { prompts } from "./prompts.js";
import { t } from "./i18n.js";
import { CONSTANTS } from "../../config/index.js";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ReleaseNotesScope {
  fromCommit: string;
  toCommit: string;
  releaseTag?: string;
  previousTag?: string;
  targetBranch: string;
  sourceBranch?: string;
  mode: "prepare" | "post";
  fromDate?: string;
  toDate?: string;
}

export interface MetadataChangeMap {
  added: Record<string, string[]>;
  deleted: Record<string, string[]>;
  addedCount: number;
  deletedCount: number;
}

export interface ContributorInfo {
  name: string;
  prCount: number;
}

export interface ReleaseNotesData {
  scope: ReleaseNotesScope;
  pullRequests: CommonPullRequestInfo[];
  tickets: Ticket[];
  metadataChanges: MetadataChangeMap;
  deploymentActions: DeploymentActionStateEntry[];
  contributors: ContributorInfo[];
  aiSummary?: string;
}

export interface ReleaseNotesResult {
  mdFile: string;
  pdfFile?: string;
  xlsxFile?: string;
  prCount: number;
  ticketCount: number;
  contributorCount: number;
}

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

export async function resolveReleaseScope(
  flags: any,
  commandRef: any,
  agentMode: boolean,
): Promise<ReleaseNotesScope> {
  const mode: "prepare" | "post" = flags.mode || (await promptMode(agentMode));
  const majorOrgs = await listMajorOrgs();

  // --- Tag-based scope ---
  if (flags["release-tag"]) {
    const releaseTag = flags["release-tag"];
    await assertTagExists(releaseTag, commandRef);
    const previousTag = flags["previous-tag"] || (await findPreviousSemverTag(releaseTag, commandRef));
    if (previousTag) {
      await assertTagExists(previousTag, commandRef);
    }
    const toCommit = await getCommitForTag(releaseTag);
    const fromCommit = previousTag ? await getCommitForTag(previousTag) : toCommit;
    const targetBranch = flags["target-branch"] || (await detectTargetBranchForTag(releaseTag, majorOrgs, agentMode));
    return { fromCommit, toCommit, releaseTag, previousTag, targetBranch, mode };
  }

  // --- Date-based scope ---
  if (flags["from-date"] || flags["to-date"]) {
    const targetBranch = flags["target-branch"] || (await promptTargetBranch(majorOrgs, agentMode));
    return {
      fromCommit: "",
      toCommit: "",
      targetBranch,
      mode,
      fromDate: flags["from-date"] || undefined,
      toDate: flags["to-date"] || undefined,
    };
  }

  // --- Commit-based scope ---
  if (flags["merge-commit"] || flags["source-commit"]) {
    const targetBranch = flags["target-branch"] || (await promptTargetBranch(majorOrgs, agentMode));
    const toCommit = flags["merge-commit"] || "HEAD";
    const fromCommit = flags["source-commit"] || "";
    return { fromCommit, toCommit, targetBranch, mode };
  }

  // --- Branch-based scope ---
  const targetBranch = flags["target-branch"] || (await promptTargetBranch(majorOrgs, agentMode));
  const sourceBranch = findSourceBranch(targetBranch, majorOrgs);

  if (mode === "prepare") {
    // Look for open PR or compute hypothetical delta
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider && sourceBranch) {
      const openPr = await gitProvider.findOpenPullRequest(sourceBranch, targetBranch);
      if (openPr) {
        uxLog("action", commandRef, c.cyan(t("releaseNotesOpenPrFound", { id: String(openPr.id), branch: targetBranch })));
      } else {
        uxLog("action", commandRef, c.cyan(t("releaseNotesNoOpenPrFound", { branch: targetBranch })));
      }
    }
    // Compute delta between source and target branch
    if (sourceBranch) {
      try {
        const delta = await getGitDeltaScope(sourceBranch, targetBranch);
        return { fromCommit: delta.fromCommit, toCommit: delta.toCommit?.hash || "HEAD", targetBranch, sourceBranch, mode };
      } catch (e: any) {
        uxLog("warning", commandRef, c.yellow(t("releaseNotesCouldNotComputeDelta", { message: e.message })));
      }
    }
    return { fromCommit: "", toCommit: "HEAD", targetBranch, sourceBranch: sourceBranch || undefined, mode };
  }

  // Post mode with branch only
  if (sourceBranch) {
    try {
      const delta = await getGitDeltaScope(sourceBranch, targetBranch);
      return { fromCommit: delta.fromCommit, toCommit: delta.toCommit?.hash || "HEAD", targetBranch, sourceBranch, mode };
    } catch (e: any) {
      uxLog("warning", commandRef, c.yellow(t("releaseNotesCouldNotComputeDelta", { message: e.message })));
    }
  }
  return { fromCommit: "", toCommit: "HEAD", targetBranch, sourceBranch: sourceBranch || undefined, mode };
}

async function promptMode(agentMode: boolean): Promise<"prepare" | "post"> {
  if (agentMode || isCI) {
    return "post";
  }
  const response = await prompts({
    type: "select",
    name: "mode",
    message: c.cyanBright(t("releaseNotesModePrompt")),
    description: t("releaseNotesModePrompt"),
    choices: [
      { title: t("releaseNotesPrepareMode"), value: "prepare" },
      { title: t("releaseNotesPostMode"), value: "post" },
    ],
    initial: 0,
  });
  return response.mode || "post";
}

async function promptTargetBranch(majorOrgs: any[], agentMode: boolean): Promise<string> {
  if (agentMode || isCI) {
    const currentBranch = await getCurrentGitBranch();
    return currentBranch || "main";
  }
  const choices = majorOrgs.map((o: any) => ({ title: o.branchName, value: o.branchName }));
  if (choices.length === 0) {
    choices.push({ title: "main", value: "main" });
  }
  const response = await prompts({
    type: "select",
    name: "branch",
    message: c.cyanBright(t("releaseNotesTargetBranchPrompt")),
    description: t("releaseNotesTargetBranchPrompt"),
    choices,
    initial: 0,
  });
  return response.branch || "main";
}

function findSourceBranch(targetBranch: string, majorOrgs: any[]): string | null {
  // Find the branch whose mergeTargets include the target branch
  const childOrg = majorOrgs.find((o: any) => (o.mergeTargets || []).includes(targetBranch));
  return childOrg?.branchName || null;
}

async function detectTargetBranchForTag(releaseTag: string, majorOrgs: any[], agentMode: boolean): Promise<string> {
  // Try to find production branch
  const prodOrg = majorOrgs.find((o: any) => isProduction(o.branchName));
  if (prodOrg) {
    return prodOrg.branchName;
  }
  if (agentMode || isCI) {
    return (await getCurrentGitBranch()) || "main";
  }
  return promptTargetBranch(majorOrgs, agentMode);
}

async function assertTagExists(tag: string, commandRef: any): Promise<void> {
  try {
    const tags = await git().tags();
    if (!tags.all.includes(tag)) {
      uxLog("warning", commandRef, c.yellow(t("releaseNotesTagNotFound", { tag })));
    }
  } catch {
    // Ignore errors - tag may still work
  }
}

export async function findPreviousSemverTag(currentTag: string, commandRef: any): Promise<string | undefined> {
  try {
    const tags = await git().tags(["--sort=-v:refname"]);
    const semverRegex = /^v?\d+\.\d+\.\d+/;
    const semverTags = tags.all.filter((t: string) => semverRegex.test(t));
    const currentIndex = semverTags.indexOf(currentTag);
    if (currentIndex >= 0 && currentIndex < semverTags.length - 1) {
      const previousTag = semverTags[currentIndex + 1];
      uxLog("action", commandRef, c.cyan(t("releaseNotesPreviousTagAutoDetected", { tag: previousTag })));
      return previousTag;
    }
    // If current tag not in list, try to find the first tag that is before it
    if (semverTags.length > 0 && currentIndex < 0) {
      return semverTags[0] !== currentTag ? semverTags[0] : undefined;
    }
  } catch {
    // Ignore
  }
  return undefined;
}

async function getCommitForTag(tag: string): Promise<string> {
  try {
    const result = await execCommand(`git rev-list -1 ${tag}`, null, { fail: true });
    return result.stdout.trim();
  } catch {
    return tag;
  }
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

export async function collectPullRequests(
  scope: ReleaseNotesScope,
  commandRef: any,
): Promise<CommonPullRequestInfo[]> {
  const gitProvider = await GitProvider.getInstance();
  if (!gitProvider) {
    uxLog("warning", commandRef, c.yellow(t("releaseNotesNoGitProvider")));
    return [];
  }
  const majorOrgs = await listMajorOrgs();
  const majorBranchNames = new Set(majorOrgs.map((o: any) => o.branchName));

  let pullRequests: CommonPullRequestInfo[] = [];

  // Date-based filtering
  if (scope.fromDate || scope.toDate) {
    pullRequests = await gitProvider.listPullRequests(
      {
        targetBranch: scope.targetBranch,
        minDate: scope.fromDate ? new Date(scope.fromDate) : undefined,
        status: "merged",
      },
      { formatted: false },
    );
    // Filter by toDate if provided
    if (scope.toDate) {
      const toDate = new Date(scope.toDate);
      pullRequests = pullRequests.filter((pr) => {
        const mergedDate = pr.mergedDate ? new Date(pr.mergedDate) : null;
        return mergedDate && mergedDate <= toDate;
      });
    }
  } else if (scope.sourceBranch && scope.targetBranch) {
    // Branch-based: find PRs between branches
    const childBranches = recursiveGetChildBranches(scope.targetBranch, majorOrgs);
    try {
      pullRequests = await gitProvider.listPullRequestsInBranchSinceLastMerge(
        scope.sourceBranch,
        scope.targetBranch,
        [...childBranches],
      );
      pullRequests.reverse(); // Oldest first
    } catch (e: any) {
      uxLog("warning", commandRef, c.yellow(t("releaseNotesCouldNotListPrs", { message: e.message })));
      // Fallback: try listPullRequests with target branch
      pullRequests = await gitProvider.listPullRequests(
        { targetBranch: scope.targetBranch, status: "merged" },
        { formatted: false },
      );
    }
  } else {
    // Tag-based or generic: list merged PRs for the target branch
    pullRequests = await gitProvider.listPullRequests(
      { targetBranch: scope.targetBranch, status: "merged" },
      { formatted: false },
    );
  }

  // Filter out inter-major-branch PRs
  pullRequests = pullRequests.filter((pr) => {
    return !(majorBranchNames.has(pr.sourceBranch) && majorBranchNames.has(pr.targetBranch));
  });

  return pullRequests;
}

function recursiveGetChildBranches(
  branchName: string,
  majorOrgs: any[],
  collected: Set<string> = new Set(),
): Set<string> {
  const directChildren = majorOrgs
    .filter((o: any) => (o.mergeTargets || []).includes(branchName))
    .map((o: any) => o.branchName);
  for (const child of directChildren) {
    if (!collected.has(child)) {
      collected.add(child);
      recursiveGetChildBranches(child, majorOrgs, collected);
    }
  }
  return collected;
}

export async function collectTickets(
  pullRequests: CommonPullRequestInfo[],
  commandRef: any,
): Promise<Ticket[]> {
  if (pullRequests.length === 0) {
    return [];
  }
  let allTickets: Ticket[] = [];
  for (const pr of pullRequests) {
    const text = `${pr.title} ${pr.description || ""}`;
    try {
      const prTickets = await TicketProvider.getProvidersTicketsFromString(text, { commits: [] });
      allTickets.push(...prTickets);
    } catch {
      // Ignore ticket extraction errors for individual PRs
    }
  }
  // Deduplicate by ticket ID
  allTickets = arrayUniqueByKey(allTickets, "id");
  // Enrich with server data
  try {
    await TicketProvider.collectTicketsInfo(allTickets);
  } catch (e: any) {
    uxLog("warning", commandRef, c.yellow(t("releaseNotesTicketEnrichFailed", { message: e.message })));
  }
  return allTickets;
}

export async function collectMetadataChanges(
  scope: ReleaseNotesScope,
  commandRef: any,
): Promise<MetadataChangeMap> {
  const emptyResult: MetadataChangeMap = { added: {}, deleted: {}, addedCount: 0, deletedCount: 0 };
  if (!scope.fromCommit || !scope.toCommit) {
    return emptyResult;
  }
  const tmpDir = path.join(os.tmpdir(), `sfdx-hardis-release-delta-${Date.now()}`);
  try {
    await fs.ensureDir(tmpDir);
    await callSfdxGitDelta(scope.fromCommit, scope.toCommit, tmpDir);

    const added: Record<string, string[]> = {};
    const deleted: Record<string, string[]> = {};
    let addedCount = 0;
    let deletedCount = 0;

    // Parse additions/modifications
    const packageXmlFile = path.join(tmpDir, "package", "package.xml");
    if (await fs.pathExists(packageXmlFile)) {
      const parsed = await parsePackageXmlFile(packageXmlFile);
      for (const [mdType, members] of Object.entries(parsed)) {
        if (Array.isArray(members) && members.length > 0) {
          added[mdType] = members;
          addedCount += members.length;
        }
      }
    }

    // Parse deletions
    const destructiveXmlFile = path.join(tmpDir, "destructiveChanges", "destructiveChanges.xml");
    if (await fs.pathExists(destructiveXmlFile)) {
      const parsed = await parsePackageXmlFile(destructiveXmlFile);
      for (const [mdType, members] of Object.entries(parsed)) {
        if (Array.isArray(members) && members.length > 0) {
          deleted[mdType] = members;
          deletedCount += members.length;
        }
      }
    }

    return { added, deleted, addedCount, deletedCount };
  } catch (e: any) {
    uxLog("warning", commandRef, c.yellow(t("releaseNotesMetadataDeltaFailed", { message: e.message })));
    return emptyResult;
  } finally {
    // Cleanup temp directory
    try {
      await fs.remove(tmpDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

export async function collectDeploymentActions(
  pullRequests: CommonPullRequestInfo[],
  commandRef: any,
): Promise<DeploymentActionStateEntry[]> {
  const prNumbers = pullRequests.map((pr) => pr.idNumber).filter((n) => n > 0);
  if (prNumbers.length === 0) {
    return [];
  }

  // Build PR lookup for URL resolution
  const prLookup = new Map<number, CommonPullRequestInfo>();
  for (const pr of pullRequests) {
    if (pr.idNumber > 0) {
      prLookup.set(pr.idNumber, pr);
    }
  }

  // Try loading from PR comments first
  try {
    await loadDeploymentActionsState(prNumbers);
    const state = (globalThis as any)._deploymentActionsMultiPrState;
    if (state?.entriesByPr) {
      const allEntries: DeploymentActionStateEntry[] = [];
      for (const [prNum, entries] of state.entriesByPr.entries()) {
        const pr = prLookup.get(prNum);
        for (const entry of entries) {
          allEntries.push({
            ...entry,
            prNumber: prNum,
            prUrl: pr?.webUrl || "",
          });
        }
      }
      if (allEntries.length > 0) {
        return sortDeploymentActions(allEntries);
      }
    }
  } catch (e: any) {
    uxLog("warning", commandRef, c.yellow(t("releaseNotesActionsLoadFailed", { message: e.message })));
  }

  // Fallback: read from scripts/actions/*.yml files
  const fallbackEntries: DeploymentActionStateEntry[] = [];
  for (const pr of pullRequests) {
    try {
      for (const when of ["pre-deploy", "post-deploy"] as ActionWhen[]) {
        const commands = await readActions("pr", when, undefined, pr.idStr);
        for (let i = 0; i < commands.length; i++) {
          const cmd = commands[i];
          fallbackEntries.push({
            actionId: cmd.id || `${pr.idStr}-${when}-${i}`,
            actionLabel: cmd.label || cmd.id || "Unknown action",
            orgBranch: "",
            when,
            executionOrder: i,
            status: "manual",
            jobId: "",
            jobUrl: "",
            date: "",
            prNumber: pr.idNumber,
            prUrl: pr.webUrl || "",
          });
        }
      }
    } catch {
      // Ignore per-PR read errors
    }
  }
  return sortDeploymentActions(fallbackEntries);
}

function sortDeploymentActions(entries: DeploymentActionStateEntry[]): DeploymentActionStateEntry[] {
  return [...entries].sort((a, b) => {
    // pre-deploy before post-deploy
    const whenA = a.when === "pre-deploy" ? 0 : 1;
    const whenB = b.when === "pre-deploy" ? 0 : 1;
    if (whenA !== whenB) return whenA - whenB;
    // then by execution order
    return (a.executionOrder ?? 0) - (b.executionOrder ?? 0);
  });
}

export function collectContributors(pullRequests: CommonPullRequestInfo[]): ContributorInfo[] {
  const authorMap = new Map<string, number>();
  for (const pr of pullRequests) {
    const author = pr.authorName || "Unknown";
    authorMap.set(author, (authorMap.get(author) || 0) + 1);
  }
  return [...authorMap.entries()]
    .map(([name, prCount]) => ({ name, prCount }))
    .sort((a, b) => b.prCount - a.prCount);
}

// ---------------------------------------------------------------------------
// AI summary
// ---------------------------------------------------------------------------

export async function generateReleaseSummary(
  data: ReleaseNotesData,
  commandRef: any,
): Promise<string | undefined> {
  const aiAvailable = await AiProvider.isAiAvailable();
  if (!aiAvailable) {
    return undefined;
  }
  uxLog("action", commandRef, c.cyan(t("releaseNotesGeneratingAiSummary")));
  try {
    const releaseDataJson = JSON.stringify({
      tickets: data.tickets.map((tk) => ({
        id: tk.id,
        subject: tk.subject || "",
        status: tk.statusLabel || tk.status || "",
        assignee: tk.assigneeLabel || tk.assignee || "",
      })),
      pullRequests: data.pullRequests.map((pr) => ({
        id: pr.idStr,
        title: pr.title,
        author: pr.authorName,
        sourceBranch: pr.sourceBranch,
      })),
      metadataStats: {
        addedCount: data.metadataChanges.addedCount,
        deletedCount: data.metadataChanges.deletedCount,
        addedTypes: Object.keys(data.metadataChanges.added),
        deletedTypes: Object.keys(data.metadataChanges.deleted),
      },
    });
    const version = data.scope.releaseTag || data.scope.targetBranch;
    const prompt = await AiProvider.buildPrompt("PROMPT_RELEASE_SUMMARY" as PromptTemplate, {
      RELEASE_DATA_JSON: releaseDataJson,
      RELEASE_VERSION: version,
    });
    const response = await AiProvider.promptAi(prompt, "PROMPT_RELEASE_SUMMARY" as PromptTemplate);
    if (response?.success && response.promptResponse) {
      return response.promptResponse;
    }
  } catch (e: any) {
    uxLog("warning", commandRef, c.yellow(t("releaseNotesAiSummaryFailed") + ": " + e.message));
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

export function buildReleaseNotesMarkdown(data: ReleaseNotesData): string {
  const lines: string[] = [];
  const version = data.scope.releaseTag || data.scope.targetBranch;
  const dateStr = new Date().toISOString().split("T")[0];
  const modeLabel = data.scope.mode === "prepare" ? t("releaseNotesPrepareTitle") : t("releaseNotesPostTitle");

  // Header
  lines.push(`# ${modeLabel} - ${version}`);
  lines.push("");
  lines.push(`**${t("releaseNotesHeaderBranch", { branch: data.scope.targetBranch })}** | **${t("releaseNotesHeaderDate", { date: dateStr })}**`);
  if (data.scope.previousTag && data.scope.releaseTag) {
    lines.push(`**${data.scope.previousTag}** -> **${data.scope.releaseTag}**`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // AI Summary
  if (data.aiSummary) {
    lines.push(`## ${t("releaseNotesSummarySection")}`);
    lines.push("");
    lines.push(data.aiSummary);
    lines.push("");
  }

  // Statistics
  lines.push(`## ${t("releaseNotesStatisticsSection")}`);
  lines.push("");
  lines.push(`| ${t("releaseNotesMetric")} | ${t("releaseNotesValue")} |`);
  lines.push("|--------|-------|");
  lines.push(`| ${t("releaseNotesPullRequestsSection")} | ${data.pullRequests.length} |`);
  lines.push(`| ${t("releaseNotesTicketsSection")} | ${data.tickets.length} |`);
  lines.push(`| ${t("releaseNotesContributorsSection")} | ${data.contributors.length} |`);
  lines.push(`| ${t("releaseNotesAddedMetadata")} | ${data.metadataChanges.addedCount} |`);
  lines.push(`| ${t("releaseNotesDeletedMetadata")} | ${data.metadataChanges.deletedCount} |`);
  lines.push("");

  // Tickets
  if (data.tickets.length > 0) {
    lines.push(`## ${t("releaseNotesTicketsSection")}`);
    lines.push("");
    lines.push(`| ID | ${t("releaseNotesTitle")} | ${t("releaseNotesStatus")} | ${t("releaseNotesAssignee")} |`);
    lines.push("|----|-------|--------|----------|");
    const sortedTickets = [...data.tickets].sort((a, b) => a.id.localeCompare(b.id));
    for (const tk of sortedTickets) {
      const idCell = tk.url ? `[${tk.id}](${tk.url})` : tk.id;
      const subject = (tk.subject || "").replace(/\|/g, "\\|");
      const status = tk.statusLabel || tk.status || "";
      const assignee = tk.assigneeLabel || tk.assignee || "";
      lines.push(`| ${idCell} | ${subject} | ${status} | ${assignee} |`);
    }
    lines.push("");
  } else {
    lines.push(`## ${t("releaseNotesTicketsSection")}`);
    lines.push("");
    lines.push(`*${t("releaseNotesNoTicketsFound")}*`);
    lines.push("");
  }

  // Pull Requests
  if (data.pullRequests.length > 0) {
    lines.push(`## ${t("releaseNotesPullRequestsSection")}`);
    lines.push("");
    lines.push(`| # | ${t("releaseNotesTitle")} | ${t("releaseNotesAuthor")} | ${t("releaseNotesMergedDate")} |`);
    lines.push("|---|-------|--------|-------------|");
    const sortedPrs = [...data.pullRequests].sort((a, b) => a.idNumber - b.idNumber);
    for (const pr of sortedPrs) {
      const idCell = pr.webUrl ? `[#${pr.idStr}](${pr.webUrl})` : `#${pr.idStr}`;
      const title = (pr.title || "").replace(/\|/g, "\\|");
      const author = pr.authorName || "";
      const mergedDate = pr.mergedDate ? pr.mergedDate.split("T")[0] : "";
      lines.push(`| ${idCell} | ${title} | ${author} | ${mergedDate} |`);
    }
    lines.push("");
  } else {
    lines.push(`## ${t("releaseNotesPullRequestsSection")}`);
    lines.push("");
    lines.push(`*${t("releaseNotesNoPrsFound")}*`);
    lines.push("");
  }

  // Contributors
  if (data.contributors.length > 0) {
    lines.push(`## ${t("releaseNotesContributorsSection")}`);
    lines.push("");
    lines.push(`| ${t("releaseNotesContributor")} | ${t("releaseNotesPrCount")} |`);
    lines.push("|-------------|-----|");
    for (const contrib of data.contributors) {
      lines.push(`| ${contrib.name} | ${contrib.prCount} |`);
    }
    lines.push("");
  }

  // Metadata Changes
  const hasMetadataChanges = data.metadataChanges.addedCount > 0 || data.metadataChanges.deletedCount > 0;
  if (hasMetadataChanges) {
    lines.push(`<details><summary>${t("releaseNotesMetadataChangesSection")}</summary>`);
    lines.push("");

    if (data.metadataChanges.addedCount > 0) {
      lines.push(`### ${t("releaseNotesAddedMetadata")} (${data.metadataChanges.addedCount} items)`);
      lines.push("");
      const sortedAddedTypes = Object.entries(data.metadataChanges.added).sort(([a], [b]) => prettifyMetadataType(a).localeCompare(prettifyMetadataType(b)));
      for (const [mdType, members] of sortedAddedTypes) {
        lines.push(`**${prettifyMetadataType(mdType)} (${members.length})**`);
        lines.push("");
        for (const member of members) {
          lines.push(`- ${member}`);
        }
        lines.push("");
      }
    }

    if (data.metadataChanges.deletedCount > 0) {
      lines.push(`### ${t("releaseNotesDeletedMetadata")} (${data.metadataChanges.deletedCount} items)`);
      lines.push("");
      const sortedDeletedTypes = Object.entries(data.metadataChanges.deleted).sort(([a], [b]) => prettifyMetadataType(a).localeCompare(prettifyMetadataType(b)));
      for (const [mdType, members] of sortedDeletedTypes) {
        lines.push(`**${prettifyMetadataType(mdType)} (${members.length})**`);
        lines.push("");
        for (const member of members) {
          lines.push(`- ${member}`);
        }
        lines.push("");
      }
    }

    lines.push("</details>");
    lines.push("");
  } else {
    lines.push(`<details><summary>${t("releaseNotesMetadataChangesSection")}</summary>`);
    lines.push("");
    lines.push(`*${t("releaseNotesNoMetadataChanges")}*`);
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  // Deployment Actions
  if (data.deploymentActions.length > 0) {
    lines.push(`<details><summary>${t("releaseNotesDeploymentActionsSection")}</summary>`);
    lines.push("");
    lines.push(`| ${t("releaseNotesAction")} | ${t("releaseNotesWhen")} | ${t("releaseNotesStatus")} | PR |`);
    lines.push("|--------|------|--------|-----|");
    for (const action of data.deploymentActions) {
      const statusIcon = getStatusIcon(action.status);
      const prCell = action.prUrl ? `[#${action.prNumber}](${action.prUrl})` : ((action.prNumber ?? 0) > 0 ? `#${action.prNumber}` : "");
      lines.push(`| ${action.actionLabel} | ${action.when} | ${statusIcon} ${action.status} | ${prCell} |`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  } else {
    lines.push(`<details><summary>${t("releaseNotesDeploymentActionsSection")}</summary>`);
    lines.push("");
    lines.push(`*${t("releaseNotesNoActionsFound")}*`);
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  // Cloudity banner
  lines.push("---");
  lines.push("");
  const bannerUrl = "https://raw.githubusercontent.com/hardisgroupcom/sfdx-hardis/refs/heads/alpha/docs/assets/images/cloudity-banner.png";
  lines.push(`[![Cloudity - Salesforce DevOps toolbox by Cloudity](${bannerUrl})](${CONSTANTS.WEBSITE_URL})`);
  lines.push("");

  return lines.join("\n");
}

function getStatusIcon(status: string): string {
  switch (status) {
    case "success": return "\u2705";
    case "failed": return "\u274c";
    case "manual": return "\ud83d\udc4b";
    case "skipped": return "\u26aa";
    default: return "\u2753";
  }
}

export function prettifyMetadataType(typeName: string): string {
  // Well-known Salesforce metadata type display names
  const knownTypes: Record<string, string> = {
    "ApexClass": "Apex Class",
    "ApexComponent": "Apex Component",
    "ApexPage": "Visualforce Page",
    "ApexTestSuite": "Apex Test Suite",
    "ApexTrigger": "Apex Trigger",
    "ApprovalProcess": "Approval Process",
    "AssignmentRules": "Assignment Rules",
    "AuraDefinitionBundle": "Aura Component",
    "CustomApplication": "Application",
    "CustomField": "Custom Field",
    "CustomLabel": "Custom Label",
    "CustomMetadata": "Custom Metadata",
    "CustomObject": "Custom Object",
    "CustomPermission": "Custom Permission",
    "CustomTab": "Custom Tab",
    "EmailTemplate": "Email Template",
    "EscalationRules": "Escalation Rules",
    "FlexiPage": "Lightning Page",
    "Flow": "Flow",
    "GlobalValueSet": "Global Value Set",
    "Layout": "Page Layout",
    "LightningComponentBundle": "Lightning Web Component",
    "PermissionSet": "Permission Set",
    "PermissionSetGroup": "Permission Set Group",
    "Profile": "Profile",
    "RecordType": "Record Type",
    "ReportFolder": "Report Folder",
    "StaticResource": "Static Resource",
    "ValidationRule": "Validation Rule",
    "WorkflowRule": "Workflow Rule",
  };
  if (knownTypes[typeName]) {
    return knownTypes[typeName];
  }
  return typeName.replace(/([A-Z])/g, " $1").trim();
}

// ---------------------------------------------------------------------------
// XLSX generation
// ---------------------------------------------------------------------------

export async function buildReleaseNotesXlsx(
  data: ReleaseNotesData,
  outputBasePath: string,
  commandRef: any,
): Promise<string | undefined> {
  const tmpDir = path.join(os.tmpdir(), `sfdx-hardis-release-xlsx-${Date.now()}`);
  await fs.ensureDir(tmpDir);
  const csvFiles: string[] = [];

  try {
    // Tab 1: Tickets
    if (data.tickets.length > 0) {
      const ticketRows = data.tickets.map((tk) => ({
        ID: tk.id,
        Title: tk.subject || "",
        Status: tk.statusLabel || tk.status || "",
        Assignee: tk.assigneeLabel || tk.assignee || "",
        Reporter: tk.reporterLabel || tk.reporter || "",
        URL: tk.url || "",
      }));
      const ticketsCsv = path.join(tmpDir, "Tickets.csv");
      await fs.writeFile(ticketsCsv, Papa.unparse(ticketRows), "utf8");
      csvFiles.push(ticketsCsv);
    }

    // Tab 2: Pull Requests
    if (data.pullRequests.length > 0) {
      const prRows = data.pullRequests.map((pr) => ({
        Number: pr.idStr,
        Title: pr.title || "",
        Author: pr.authorName || "",
        "Source Branch": pr.sourceBranch || "",
        "Target Branch": pr.targetBranch || "",
        "Merged Date": pr.mergedDate ? pr.mergedDate.split("T")[0] : "",
        URL: pr.webUrl || "",
      }));
      const prsCsv = path.join(tmpDir, "Pull Requests.csv");
      await fs.writeFile(prsCsv, Papa.unparse(prRows), "utf8");
      csvFiles.push(prsCsv);
    }

    // Tab 3: Metadata Changes
    const metadataRows: any[] = [];
    for (const [mdType, members] of Object.entries(data.metadataChanges.added)) {
      for (const member of members) {
        metadataRows.push({ Type: prettifyMetadataType(mdType), Member: member, Change: "Added/Modified" });
      }
    }
    for (const [mdType, members] of Object.entries(data.metadataChanges.deleted)) {
      for (const member of members) {
        metadataRows.push({ Type: prettifyMetadataType(mdType), Member: member, Change: "Deleted" });
      }
    }
    if (metadataRows.length > 0) {
      const metadataCsv = path.join(tmpDir, "Metadata Changes.csv");
      await fs.writeFile(metadataCsv, Papa.unparse(metadataRows), "utf8");
      csvFiles.push(metadataCsv);
    }

    // Tab 4: Deployment Actions
    if (data.deploymentActions.length > 0) {
      const actionRows = data.deploymentActions.map((a) => ({
        "Action ID": a.actionId,
        Label: a.actionLabel,
        When: a.when,
        Status: a.status,
        "Org Branch": a.orgBranch || "",
        "PR Number": (a.prNumber ?? 0) > 0 ? `#${a.prNumber}` : "",
        "PR URL": a.prUrl || "",
      }));
      const actionsCsv = path.join(tmpDir, "Deployment Actions.csv");
      await fs.writeFile(actionsCsv, Papa.unparse(actionRows), "utf8");
      csvFiles.push(actionsCsv);
    }

    if (csvFiles.length === 0) {
      return undefined;
    }

    // Combine into multi-tab XLSX
    // createXlsxFromCsvFiles derives the xlsx name by replacing .csv with .xlsx,
    // so pass a .csv-named reference path in the same directory as the markdown report.
    const csvReferencePath = outputBasePath.replace(/\.\w+$/, ".csv");
    await createXlsxFromCsvFiles(csvFiles, csvReferencePath, {
      fileTitle: t("releaseNotesReportTitle"),
    });

    const xlsDir = path.join(path.dirname(outputBasePath), "xls");
    const xlsxFileName = path.basename(outputBasePath).replace(/\.\w+$/, ".xlsx");
    const xlsxFile = path.join(xlsDir, xlsxFileName);
    if (await fs.pathExists(xlsxFile)) {
      return xlsxFile;
    }
    return undefined;
  } catch (e: any) {
    uxLog("warning", commandRef, c.yellow(t("releaseNotesXlsxGenerationFailed", { message: e.message })));
    return undefined;
  } finally {
    try {
      await fs.remove(tmpDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

export async function sendReleaseNotification(
  data: ReleaseNotesData,
  pdfFile: string | undefined,
  xlsxFile: string | undefined,
  commandRef: any,
): Promise<void> {
  // Only send in post mode for production branches
  if (data.scope.mode !== "post" || !isProduction(data.scope.targetBranch)) {
    return;
  }

  try {
    const version = data.scope.releaseTag || data.scope.targetBranch;
    const notifButtons = await getNotificationButtons();

    const attachedFiles: string[] = [];
    if (pdfFile) attachedFiles.push(pdfFile);
    if (xlsxFile) attachedFiles.push(xlsxFile);

    await NotifProvider.postNotifications({
      type: "RELEASE_NOTES",
      text: t("releaseNotesNotifSummary", {
        version,
        branch: data.scope.targetBranch,
        prCount: String(data.pullRequests.length),
        ticketCount: String(data.tickets.length),
        contributorCount: String(data.contributors.length),
      }),
      buttons: notifButtons,
      severity: "success" as NotifSeverity,
      attachedFiles,
      logElements: [],
      data: {
        version,
        branch: data.scope.targetBranch,
        prCount: data.pullRequests.length,
        ticketCount: data.tickets.length,
        contributorCount: data.contributors.length,
      },
      metrics: {
        prCount: data.pullRequests.length,
        ticketCount: data.tickets.length,
        contributorCount: data.contributors.length,
      },
    });
  } catch (e: any) {
    uxLog("warning", commandRef, c.yellow(t("releaseNotesNotifFailed", { message: e.message })));
  }
}
/* jscpd:ignore-end */
