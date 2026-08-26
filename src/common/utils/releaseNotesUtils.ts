/* jscpd:ignore-start */
import c from "chalk";
import fs from './fsUtils.js';
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
import { isDeploymentActionsDisabled } from "./prePostCommandUtils.js";
import { getConfig } from "../../config/index.js";
import { ActionWhen } from "../actionsProvider/actionsProvider.js";
import { AiProvider } from "../aiProvider/index.js";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { NotifProvider } from "../notifProvider/index.js";
import { NotifSeverity } from "../notifProvider/types.js";
import ExcelJS from "exceljs";
import { MetadataResolver, RegistryAccess, VirtualTreeContainer } from "@salesforce/source-deploy-retrieve";
import { applyWorksheetFormatting } from "./filesUtils.js";
import { getNotificationButtons } from "./notifUtils.js";
import { prompts } from "./prompts.js";
import { WebSocketClient } from "../websocketClient.js";
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
  /** metadata type::member -> Pull Requests and commits that touched it */
  attribution?: Map<string, MetadataAttribution>;
}

export interface MetadataCommitInfo {
  sha: string;
  title: string;
  author: string;
  date: string;
}

export interface MetadataPrRef {
  idNumber: number;
  idStr: string;
  title: string;
  authorName: string;
}

export interface MetadataAttribution {
  pullRequests: MetadataPrRef[];
  commits: MetadataCommitInfo[];
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
  /** ticket ID -> list of PR idStr that reference it */
  ticketToPrs: Map<string, string[]>;
  /** PR idStr -> list of ticket IDs found in it */
  prToTickets: Map<string, string[]>;
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
    let fromCommit = flags["source-commit"] || "";
    // When generating from a merge commit without an explicit source commit, bound the
    // range with the merge commit's first parent (the mainline before the go live), so the
    // metadata delta covers exactly what the merge introduced.
    if (!fromCommit && flags["merge-commit"]) {
      fromCommit = (await getFirstParentCommit(flags["merge-commit"])) || "";
    }
    return { fromCommit, toCommit, targetBranch, mode };
  }

  // --- Branch-based scope ---
  // Resolve target and source branches, with mutual inference support
  let targetBranch: string;
  let sourceBranch: string | null;

  if (flags["source-branch"] && !flags["target-branch"]) {
    // Source branch given but no target: infer target from mergeTargets config
    sourceBranch = flags["source-branch"] as string;
    const inferredTarget = findTargetBranchFromSource(sourceBranch, majorOrgs);
    if (inferredTarget) {
      targetBranch = inferredTarget;
      uxLog("action", commandRef, c.cyan(t("releaseNotesTargetBranchInferred", { branch: targetBranch })));
    } else {
      targetBranch = await promptTargetBranch(majorOrgs, agentMode);
    }
  } else {
    targetBranch = flags["target-branch"] || (await promptTargetBranch(majorOrgs, agentMode));
    sourceBranch = flags["source-branch"] || findSourceBranch(targetBranch, majorOrgs);
  }

  if (mode === "prepare") {
    // If sourceBranch is still unknown, prompt for it (needed to identify PRs)
    if (!sourceBranch) {
      const prompted = await promptSourceBranch(majorOrgs, targetBranch, agentMode, commandRef);
      if (prompted) {
        sourceBranch = prompted;
      }
    }
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

  // Post mode: list merge commits on target branch and prompt user to select
  uxLog("action", commandRef, c.cyan(t("releaseNotesListingMergeCommits", { branch: targetBranch })));
  const mergeCommits = await listMergeCommitsOnBranch(targetBranch);
  if (mergeCommits.length > 0) {
    const selected = await promptMergeCommit(mergeCommits, agentMode, commandRef);
    if (selected) {
      const selectedIndex = mergeCommits.findIndex((mc) => mc.sha === selected.sha);
      const prevCommit = selectedIndex >= 0 && selectedIndex < mergeCommits.length - 1
        ? mergeCommits[selectedIndex + 1]
        : null;
      return {
        fromCommit: prevCommit?.sha || "",
        toCommit: selected.sha,
        targetBranch,
        sourceBranch: sourceBranch || undefined,
        mode,
      };
    }
  }

  uxLog("action", commandRef, c.cyan(t("releaseNotesNoMergeCommitsFound", { branch: targetBranch })));

  // Fallback: use source-branch delta if no merge commits found
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

interface MergeCommitInfo {
  sha: string;
  date: string;
  message: string;
}

async function listMergeCommitsOnBranch(branch: string, limit = 20): Promise<MergeCommitInfo[]> {
  try {
    const result = await execCommand(
      `git log --merges --first-parent "${branch}" --pretty=format:"%H|%cs|%s" -n ${limit}`,
      null,
      { fail: true },
    );
    if (!result.stdout?.trim()) {
      return [];
    }
    const lines = result.stdout.trim().split("\n").filter((l: string) => l.trim());
    return lines.map((line: string) => {
      const pipeIdx = line.indexOf("|");
      const pipe2Idx = line.indexOf("|", pipeIdx + 1);
      const sha = line.substring(0, pipeIdx).trim();
      const date = line.substring(pipeIdx + 1, pipe2Idx).trim();
      const message = line.substring(pipe2Idx + 1).trim();
      return { sha, date, message };
    }).filter((mc) => mc.sha.length > 0);
  } catch {
    return [];
  }
}

async function promptMergeCommit(
  commits: MergeCommitInfo[],
  agentMode: boolean,
  commandRef: any,
): Promise<MergeCommitInfo | null> {
  if (commits.length === 0) {
    return null;
  }
  if (agentMode || isCI) {
    const latest = commits[0];
    uxLog("action", commandRef, c.cyan(t("releaseNotesLatestMergeCommitUsed", { sha: latest.sha.substring(0, 8) })));
    return latest;
  }
  const choices = commits.map((commit) => ({
    title: `${commit.sha.substring(0, 8)} - ${commit.date} - ${commit.message}`,
    value: commit,
  }));
  const response = await prompts({
    type: "select",
    name: "commit",
    message: c.cyanBright(t("releaseNotesSelectMergeCommit")),
    description: t("releaseNotesSelectMergeCommit"),
    choices,
    initial: 0,
  });
  return response.commit || commits[0];
}

function findSourceBranch(targetBranch: string, majorOrgs: any[]): string | null {
  // Find the branch whose mergeTargets include the target branch
  const childOrg = majorOrgs.find((o: any) => (o.mergeTargets || []).includes(targetBranch));
  return childOrg?.branchName || null;
}

function findTargetBranchFromSource(sourceBranch: string, majorOrgs: any[]): string | null {
  // Find the first mergeTarget of the given source branch
  const sourceOrg = majorOrgs.find((o: any) => o.branchName === sourceBranch);
  const targets: string[] = sourceOrg?.mergeTargets || [];
  return targets.length > 0 ? targets[0] : null;
}

// Merging into a top branch (a major branch with no merge target, e.g. main) is a
// release; merging into any other major branch (e.g. integration -> uat) is only a
// promotion. Used to pick the right wording in the generated document.
export async function isPromotionTarget(targetBranch: string): Promise<boolean> {
  const majorOrgs = await listMajorOrgs();
  const targetOrg = majorOrgs.find((o: any) => o.branchName === targetBranch);
  if (!targetOrg) {
    // Unknown branch: keep the release wording
    return false;
  }
  return (targetOrg.mergeTargets || []).length > 0;
}

async function promptSourceBranch(
  majorOrgs: any[],
  targetBranch: string,
  agentMode: boolean,
  commandRef: any,
): Promise<string | null> {
  if (agentMode || isCI) {
    uxLog("warning", commandRef, c.yellow(t("releaseNotesNoSourceBranchForPrepare")));
    return null;
  }
  const choices = majorOrgs
    .filter((o: any) => o.branchName !== targetBranch)
    .map((o: any) => ({ title: o.branchName, value: o.branchName }));
  if (choices.length === 0) {
    return null;
  }
  const response = await prompts({
    type: "select",
    name: "branch",
    message: c.cyanBright(t("releaseNotesSourceBranchPrompt")),
    description: t("releaseNotesSourceBranchPrompt"),
    choices,
    initial: 0,
  });
  return response.branch || null;
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

// Resolve the first parent of a (merge) commit: the mainline state before the go live.
// Uses `--format=%P` (parents are space-separated) rather than `<commit>^1`, because the
// caret is the escape character in the Windows shell and would corrupt the ref.
async function getFirstParentCommit(commit: string): Promise<string | undefined> {
  try {
    const result = await execCommand(`git show -s --format=%P ${commit}`, null, { fail: true });
    const sha = result.stdout.trim().split(/\s+/)[0];
    return sha || undefined;
  } catch {
    return undefined;
  }
}

export async function getReleaseDate(scope: ReleaseNotesScope): Promise<string> {
  if (scope.mode === "prepare") {
    return new Date().toISOString().split("T")[0];
  }
  // Post mode: try to get the date from the toCommit
  if (scope.toCommit) {
    try {
      const result = await execCommand(`git show -s --format=%ci ${scope.toCommit}`, null, { fail: true });
      const dateStr = result.stdout.trim();
      if (dateStr) {
        return dateStr.split(" ")[0];
      }
    } catch {
      // Fall through
    }
  }
  return new Date().toISOString().split("T")[0];
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
  // PRs that are the release "go live" merge itself (e.g. preprod -> main). They
  // are inter-major-branch but must survive the filter below, as they carry the release.
  const releaseCommitPrIds = new Set<string>();

  // Date-based filtering
  if (scope.fromDate || scope.toDate) {
    pullRequests = (await gitProvider.listPullRequests(
      {
        targetBranch: scope.targetBranch,
        minDate: scope.fromDate ? new Date(scope.fromDate) : undefined,
        status: "merged",
      },
    )) || [];
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
      pullRequests = (await gitProvider.listPullRequests(
        { targetBranch: scope.targetBranch, status: "merged" },
      )) || [];
    }
  } else if (scope.toCommit && scope.toCommit !== "HEAD" && !scope.releaseTag) {
    // Commit-based (e.g. post mode with --merge-commit): scope PRs to the go-live
    // introduced by the merge commit. This excludes hotfixes merged directly to the
    // target branch at other times, which a plain "recent merged PRs" list catches.
    const childBranches = recursiveGetChildBranches(scope.targetBranch, majorOrgs);
    try {
      pullRequests = await gitProvider.listPullRequestsInGoLive(
        scope.targetBranch,
        [...childBranches],
        scope.toCommit,
      );
    } catch (e: any) {
      uxLog("warning", commandRef, c.yellow(t("releaseNotesCouldNotListPrs", { message: e.message })));
    }
    if (!pullRequests || pullRequests.length === 0) {
      // Fallback (e.g. provider without go-live support): list merged PRs for the target branch
      pullRequests = (await gitProvider.listPullRequests(
        { targetBranch: scope.targetBranch, status: "merged" },
      )) || [];
    } else {
      // The go-live merge PR itself (e.g. preprod -> main) carries the release and
      // must survive the inter-major-branch filter below.
      for (const pr of pullRequests) {
        const sha = pr.mergeCommitSha;
        const to = scope.toCommit;
        if (sha && (sha === to || sha.startsWith(to) || to.startsWith(sha))) {
          releaseCommitPrIds.add(pr.idStr);
        }
      }
    }
  } else {
    // Tag-based or generic: list merged PRs for the target branch
    pullRequests = (await gitProvider.listPullRequests(
      { targetBranch: scope.targetBranch, status: "merged" },
    )) || [];
  }

  // Filter out inter-major-branch PRs, but always keep the release go-live merge PR
  pullRequests = pullRequests.filter((pr) => {
    if (releaseCommitPrIds.has(pr.idStr)) {
      return true;
    }
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

export interface TicketCollectionResult {
  tickets: Ticket[];
  ticketToPrs: Map<string, string[]>;
  prToTickets: Map<string, string[]>;
}

export async function collectTickets(
  pullRequests: CommonPullRequestInfo[],
  commandRef: any,
): Promise<TicketCollectionResult> {
  const ticketToPrs = new Map<string, string[]>();
  const prToTickets = new Map<string, string[]>();

  if (pullRequests.length === 0) {
    return { tickets: [], ticketToPrs, prToTickets };
  }
  let allTickets: Ticket[] = [];
  for (const pr of pullRequests) {
    const text = [pr.title, pr.description || "", pr.sourceBranch || ""].filter(Boolean).join("\n");
    try {
      const prTickets = await TicketProvider.getProvidersTicketsFromString(text, { commits: [] });
      const ticketIds: string[] = [];
      for (const tk of prTickets) {
        ticketIds.push(tk.id);
        const prList = ticketToPrs.get(tk.id) || [];
        if (!prList.includes(pr.idStr)) {
          prList.push(pr.idStr);
        }
        ticketToPrs.set(tk.id, prList);
      }
      if (ticketIds.length > 0) {
        prToTickets.set(pr.idStr, ticketIds);
      }
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
  return { tickets: allTickets, ticketToPrs, prToTickets };
}

export async function collectMetadataChanges(
  scope: ReleaseNotesScope,
  commandRef: any,
  outputDir?: string,
): Promise<MetadataChangeMap> {
  const emptyResult: MetadataChangeMap = { added: {}, deleted: {}, addedCount: 0, deletedCount: 0 };
  if (!scope.fromCommit || !scope.toCommit) {
    return emptyResult;
  }
  const tmpDir = path.join(os.tmpdir(), `sfdx-hardis-release-delta-${Date.now()}`);
  try {
    await fs.ensureDir(tmpDir);
    // Skip websocket notifications from callSfdxGitDelta when we copy files to outputDir
    // (the temp paths would be invalid once cleaned up)
    await callSfdxGitDelta(scope.fromCommit, scope.toCommit, tmpDir, { skipWebSocketNotification: !!outputDir });

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
      // Copy package.xml to output directory and notify via websocket
      if (outputDir) {
        const destPath = path.join(outputDir, "package.xml");
        await fs.copy(packageXmlFile, destPath, { overwrite: true });
        if (addedCount > 0) {
          WebSocketClient.sendReportFileMessage(destPath, t("gitDeltaPackageXmlCount", { count: addedCount }), "report");
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
      // Copy destructiveChanges.xml to output directory and notify via websocket
      if (outputDir) {
        const destPath = path.join(outputDir, "destructiveChanges.xml");
        await fs.copy(destructiveXmlFile, destPath, { overwrite: true });
        if (deletedCount > 0) {
          WebSocketClient.sendReportFileMessage(destPath, t("gitDeltaDestructiveChangesXmlCount", { count: deletedCount }), "report");
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

interface GitLogCommit {
  sha: string;
  author: string;
  date: string;
  title: string;
  files: string[];
}

const GIT_LOG_COMMIT_MARKER = "@@@COMMIT@@@";

function parseGitLogWithFiles(logOutput: string): GitLogCommit[] {
  const commits: GitLogCommit[] = [];
  for (const block of logOutput.split(GIT_LOG_COMMIT_MARKER)) {
    const lines = block.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    if (lines.length === 0) {
      continue;
    }
    const header = lines[0];
    const pipe1 = header.indexOf("|");
    const pipe2 = header.indexOf("|", pipe1 + 1);
    const pipe3 = header.indexOf("|", pipe2 + 1);
    if (pipe1 < 0 || pipe2 < 0 || pipe3 < 0) {
      continue;
    }
    commits.push({
      sha: header.substring(0, pipe1),
      author: header.substring(pipe1 + 1, pipe2),
      date: header.substring(pipe2 + 1, pipe3),
      title: header.substring(pipe3 + 1),
      files: lines.slice(1),
    });
  }
  return commits;
}

// Map each commit SHA of the release range to the Pull Requests that contain it, using the
// commits reachable from each PR merge commit but not from its first parent. This covers both
// real merge commits (the whole feature branch) and squash merges (the single squash commit).
async function mapCommitsToPullRequests(
  pullRequests: CommonPullRequestInfo[],
): Promise<Map<string, CommonPullRequestInfo[]>> {
  const commitShaToPrs = new Map<string, CommonPullRequestInfo[]>();
  const prsWithMergeSha = pullRequests.filter((pr) => pr.mergeCommitSha);
  const showProgress = prsWithMergeSha.length > 1;
  if (showProgress) {
    WebSocketClient.sendProgressStartMessage(t("releaseNotesMappingCommitsToPrs", { count: prsWithMergeSha.length }), prsWithMergeSha.length);
  }
  let counter = 0;
  for (const pr of prsWithMergeSha) {
    const mergeSha = pr.mergeCommitSha as string;
    let prCommitShas: string[] = [];
    try {
      const revListOutput = await git({ output: false, displayCommand: false }).raw(["rev-list", `${mergeSha}^..${mergeSha}`]);
      prCommitShas = revListOutput.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    } catch {
      // Merge commit without a parent (or unknown locally): fall back to the merge commit alone
      prCommitShas = [mergeSha];
    }
    for (const sha of prCommitShas) {
      const prList = commitShaToPrs.get(sha) || [];
      prList.push(pr);
      commitShaToPrs.set(sha, prList);
    }
    counter++;
    if (showProgress) {
      WebSocketClient.sendProgressStepMessage(counter, prsWithMergeSha.length);
    }
  }
  if (showProgress) {
    WebSocketClient.sendProgressEndMessage(prsWithMergeSha.length);
  }
  return commitShaToPrs;
}

// Resolve git file paths into metadata members ("type::fullName" keys) using the SDR registry
// over a virtual file tree, so deleted files resolve too. Non-metadata files are skipped.
function resolveFilesToMetadataMembers(files: string[]): Map<string, string[]> {
  const fileToMembers = new Map<string, string[]>();
  const normalizedFiles = files.map((file) => path.normalize(file));
  const tree = VirtualTreeContainer.fromFilePaths(normalizedFiles);
  const resolver = new MetadataResolver(new RegistryAccess(), tree, false);
  for (let i = 0; i < files.length; i++) {
    try {
      const components = resolver.getComponentsFromPath(normalizedFiles[i]);
      const memberKeys = components.map((cmp) => `${cmp.type.name}::${cmp.fullName}`);
      if (memberKeys.length > 0) {
        fileToMembers.set(files[i], memberKeys);
      }
    } catch {
      // Not a Salesforce metadata file
    }
  }
  return fileToMembers;
}

export async function collectMetadataAttribution(
  scope: ReleaseNotesScope,
  metadataChanges: MetadataChangeMap,
  pullRequests: CommonPullRequestInfo[],
  commandRef: any,
): Promise<Map<string, MetadataAttribution>> {
  const attribution = new Map<string, MetadataAttribution>();
  if (!scope.fromCommit || !scope.toCommit || scope.fromCommit === scope.toCommit) {
    return attribution;
  }
  if (metadataChanges.addedCount === 0 && metadataChanges.deletedCount === 0) {
    return attribution;
  }
  try {
    uxLog("action", commandRef, c.cyan(t("releaseNotesCollectingMetadataAttribution")));
    // List the commits of the release range with the files each one touched
    const logOutput = await git({ output: false, displayCommand: false }).raw([
      "log",
      "--name-only",
      `--format=${GIT_LOG_COMMIT_MARKER}%H|%an|%aI|%s`,
      `${scope.fromCommit}..${scope.toCommit}`,
    ]);
    const commits = parseGitLogWithFiles(logOutput);
    if (commits.length === 0) {
      return attribution;
    }
    const commitShaToPrs = await mapCommitsToPullRequests(pullRequests);
    const allFiles = [...new Set(commits.flatMap((commit) => commit.files))];
    const fileToMembers = resolveFilesToMetadataMembers(allFiles);

    // Only keep members that are part of the computed metadata change map
    const memberKeys = new Set<string>();
    for (const changeMap of [metadataChanges.added, metadataChanges.deleted]) {
      for (const [mdType, members] of Object.entries(changeMap)) {
        for (const member of members) {
          memberKeys.add(`${mdType}::${member}`);
        }
      }
    }

    for (const commit of commits) {
      for (const file of commit.files) {
        for (const memberKey of fileToMembers.get(file) || []) {
          if (!memberKeys.has(memberKey)) {
            continue;
          }
          let entry = attribution.get(memberKey);
          if (!entry) {
            entry = { pullRequests: [], commits: [] };
            attribution.set(memberKey, entry);
          }
          if (!entry.commits.some((commitInfo) => commitInfo.sha === commit.sha)) {
            entry.commits.push({ sha: commit.sha, title: commit.title, author: commit.author, date: commit.date });
          }
          for (const pr of commitShaToPrs.get(commit.sha) || []) {
            if (!entry.pullRequests.some((prRef) => prRef.idStr === pr.idStr)) {
              entry.pullRequests.push({
                idNumber: pr.idNumber,
                idStr: pr.idStr,
                title: pr.title || "",
                authorName: pr.authorName || "",
              });
            }
          }
        }
      }
    }
    for (const entry of attribution.values()) {
      entry.pullRequests.sort((a, b) => a.idNumber - b.idNumber);
      entry.commits.sort((a, b) => a.date.localeCompare(b.date));
    }
  } catch (e: any) {
    uxLog("warning", commandRef, c.yellow(t("releaseNotesMetadataAttributionFailed", { message: e.message })));
  }
  return attribution;
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

  // Try loading from PR comments first. Not when the deployment actions kill switch is set:
  // Pull Request comments must then not be read from the git provider, so only the local
  // scripts/actions files fallback below is used.
  const deploymentActionsDisabled = isDeploymentActionsDisabled(await getConfig('branch'));
  if (deploymentActionsDisabled) {
    uxLog("log", commandRef, c.grey(t('deploymentActionsDisabledReleaseNotes')));
  }
  try {
    if (!deploymentActionsDisabled) {
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
          // State exists for these PRs: return the processed actions (skipped excluded, deduped),
          // even if that leaves the list empty - do not fall back to re-listing action definitions.
          return filterAndDedupeDeploymentActions(allEntries);
        }
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
  return filterAndDedupeDeploymentActions(fallbackEntries);
}

// Keep only processed actions (drop skipped) and remove duplicates: the same action can be
// recorded once per org branch, which would render as identical rows since the table does not
// show the org branch. Collapse to one row per action + phase + PR, keeping the most meaningful status.
function filterAndDedupeDeploymentActions(entries: DeploymentActionStateEntry[]): DeploymentActionStateEntry[] {
  const statusPriority: Record<string, number> = { success: 3, failed: 2, manual: 1 };
  const byKey = new Map<string, DeploymentActionStateEntry>();
  for (const entry of entries) {
    if (entry.status === "skipped") {
      continue;
    }
    const key = `${entry.actionId}::${entry.when}::${entry.prNumber ?? ""}`;
    const existing = byKey.get(key);
    if (!existing || (statusPriority[entry.status] || 0) > (statusPriority[existing.status] || 0)) {
      byKey.set(key, entry);
    }
  }
  return sortDeploymentActions(Array.from(byKey.values()));
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

export async function buildReleaseNotesMarkdown(data: ReleaseNotesData, releaseDate: string): Promise<string> {
  const lines: string[] = [];
  const version = data.scope.releaseTag || data.scope.targetBranch;

  // URL lookup maps for cross-reference hyperlinks
  const prUrlMap = new Map<string, string>(data.pullRequests.map((pr) => [pr.idStr, pr.webUrl || ""]));
  const ticketUrlMap = new Map<string, string>(data.tickets.map((tk) => [tk.id, tk.url || ""]));
  const dateStr = releaseDate;
  // A merge into an intermediate major branch is a promotion, not a release
  const promotion = await isPromotionTarget(data.scope.targetBranch);
  const modeLabel =
    data.scope.mode === "prepare"
      ? promotion
        ? t("releaseNotesPromotionPrepareTitle")
        : t("releaseNotesPrepareTitle")
      : promotion
        ? t("releaseNotesPromotionTitle")
        : t("releaseNotesPostTitle");

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
    lines.push(`| ID | ${t("releaseNotesTitle")} | ${t("releaseNotesStatus")} | ${t("releaseNotesAssignee")} | PRs |`);
    lines.push("|----|-------|--------|----------|-----|");
    const sortedTickets = [...data.tickets].sort((a, b) => a.id.localeCompare(b.id));
    for (const tk of sortedTickets) {
      const idCell = tk.url ? `[${tk.id}](${tk.url})` : tk.id;
      const subject = (tk.subject || "").replace(/\|/g, "\\|");
      const status = tk.statusLabel || tk.status || "";
      const assignee = tk.assigneeLabel || tk.assignee || "";
      const relatedPrs = (data.ticketToPrs.get(tk.id) || []).map((id) => {
        const url = prUrlMap.get(id);
        return url ? `[#${id}](${url})` : `#${id}`;
      }).join(", ");
      lines.push(`| ${idCell} | ${subject} | ${status} | ${assignee} | ${relatedPrs} |`);
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
    lines.push(`| # | ${t("releaseNotesTitle")} | ${t("releaseNotesAuthor")} | ${t("releaseNotesMergedDate")} | ${t("releaseNotesTicketsSection")} |`);
    lines.push("|---|-------|--------|-------------|---------|");
    const sortedPrs = [...data.pullRequests].sort((a, b) => a.idNumber - b.idNumber);
    for (const pr of sortedPrs) {
      const idCell = pr.webUrl ? `[#${pr.idStr}](${pr.webUrl})` : `#${pr.idStr}`;
      const title = (pr.title || "").replace(/\|/g, "\\|");
      const author = pr.authorName || "";
      const mergedDate = pr.mergedDate ? pr.mergedDate.split("T")[0] : "";
      const relatedTickets = (data.prToTickets.get(pr.idStr) || []).map((id) => {
        const url = ticketUrlMap.get(id);
        return url ? `[${id}](${url})` : id;
      }).join(", ");
      lines.push(`| ${idCell} | ${title} | ${author} | ${mergedDate} | ${relatedTickets} |`);
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
  const bannerUrl = CONSTANTS.BANNER_IMAGE_URL;
  lines.push(`[![Cloudity - Salesforce DevOps toolbox by Cloudity](${bannerUrl})](${CONSTANTS.WEBSITE_URL})`);
  lines.push("");
  const generatedDate = new Date().toISOString().split("T")[0];
  let jobUrl: string | null = null;
  try {
    jobUrl = await GitProvider.getJobUrl();
  } catch {
    // ignore
  }
  const jobPart = jobUrl ? ` - [CI job](${jobUrl})` : "";
  lines.push(`_Generated by [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) on ${generatedDate}${jobPart}_`);
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
        "Related PRs": (data.ticketToPrs.get(tk.id) || []).map((id) => `#${id}`).join(", "),
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
        Tickets: (data.prToTickets.get(pr.idStr) || []).join(", "),
      }));
      const prsCsv = path.join(tmpDir, "Pull Requests.csv");
      await fs.writeFile(prsCsv, Papa.unparse(prRows), "utf8");
      csvFiles.push(prsCsv);
    }

    // Tab 3: Metadata Changes
    const attribution = data.metadataChanges.attribution;
    const buildAttributionCells = (mdType: string, member: string) => {
      const entry = attribution?.get(`${mdType}::${member}`);
      return {
        "Pull Requests": (entry?.pullRequests || [])
          .map((pr) => `#${pr.idStr} - ${pr.title.replace(/\s+/g, " ")} by ${pr.authorName}`.trim())
          .join("\n"),
        Commits: (entry?.commits || [])
          .map((commitInfo) => `${commitInfo.title} by ${commitInfo.author} on ${commitInfo.date.split("T")[0]}`)
          .join("\n"),
      };
    };
    const metadataRows: any[] = [];
    for (const [mdType, members] of Object.entries(data.metadataChanges.added)) {
      for (const member of members) {
        metadataRows.push({ Type: prettifyMetadataType(mdType), Member: member, Change: "Added/Modified", ...buildAttributionCells(mdType, member) });
      }
    }
    for (const [mdType, members] of Object.entries(data.metadataChanges.deleted)) {
      for (const member of members) {
        metadataRows.push({ Type: prettifyMetadataType(mdType), Member: member, Change: "Deleted", ...buildAttributionCells(mdType, member) });
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

    // Build multi-tab XLSX directly in the output directory
    const xlsxFileName = path.basename(outputBasePath).replace(/\.\w+$/, ".xlsx");
    const xlsxFile = path.join(path.dirname(outputBasePath), xlsxFileName);
    const workbook = new ExcelJS.Workbook();
    for (const csvFile of csvFiles) {
      const worksheet = await workbook.csv.readFile(csvFile);
      worksheet.name = path.basename(csvFile, ".csv");
      applyWorksheetFormatting(worksheet, {
        // Multiline traceability columns of the Metadata Changes tab (one PR / commit per line)
        columnsCustomStyles: {
          "Pull Requests": { wrap: true, width: 60, maxHeight: 150, verticalAlignment: "top" },
          "Commits": { wrap: true, width: 60, maxHeight: 150, verticalAlignment: "top" },
        },
      });
    }
    await workbook.xlsx.writeFile(xlsxFile);
    uxLog("action", commandRef, c.cyan(t("pleaseSeeDetailedXlsxLogIn", { xslxFile: c.bold(xlsxFile) })));
    WebSocketClient.sendReportFileMessage(xlsxFile, `${t("releaseNotesReportTitle")} (XLSX)`, "report");
    return xlsxFile;
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
