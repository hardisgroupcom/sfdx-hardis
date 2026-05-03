/* jscpd:ignore-start */
import { SfError } from '@salesforce/core';
import c from 'chalk';
import * as Diff from 'diff';
import fs from 'fs-extra';
import * as path from 'path';
import {
  createTempDir,
  execCommand,
  git,
  gitFetch,
  isCI,
  uxLog,
  uxLogTable,
} from './index.js';
import { buildOrgManifest } from './deployUtils.js';
import { getConfig, getEnvVar, setConfig } from '../../config/index.js';
import { GitProvider } from '../gitProvider/index.js';
// callSfdxGitDelta is used by the command file directly

import { countPackageXmlItems, isPackageXmlEmpty, parsePackageXmlFile, writePackageXmlFile } from './xmlUtils.js';
import { generateCsvFile, generateReportPath } from './filesUtils.js';
import { generatePdfFileFromMarkdown } from './markdownUtils.js';
import { prompts } from './prompts.js';
import { ActionsProvider, PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { authOrg } from './authUtils.js';
import { findUserByUsernameLike } from './orgUtils.js';
import { MetadataUtils } from '../metadata-utils/index.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { WebSocketClient } from '../websocketClient.js';
import { t } from './i18n.js';

// ---- Interfaces ----

export interface BackpromotePrGroup {
  pr: {
    id: number;
    title: string;
    author: string;
    mergedAt: string;
    webUrl: string;
    sourceBranch: string;
  };
  commits: Array<{
    hash: string;
    message: string;
    author: string;
    date: string;
  }>;
  prConfig: any | null;
  /** Merge commit SHA on the parent branch (used for delta computation) */
  mergeCommitSha: string;
}

export interface OrgConflictItem {
  metadataType: string;
  metadataName: string;
  status: 'modified' | 'added' | 'deleted' | 'unchanged';
  localPath: string;
  diffPreview: string;
  diffMarkdown: string;
  hasOrgChanges: boolean;
}

export interface BackpromoteState {
  lastCommit: string;
  lastTimestamp: string;
  parentBranch: string;
}

// ---- Resolve parent branch ----

export async function resolveParentBranch(
  commandThis: any,
  flagOverride: string | null,
  agentMode: boolean,
  currentBranch: string,
): Promise<string> {
  if (flagOverride) {
    uxLog('action', commandThis, c.cyan(t('backpromoteParentBranchAutoSelected', { parentBranch: c.green(flagOverride) })));
    return flagOverride;
  }
  const config = await getConfig('project');
  const userConfig = await getConfig('user');
  // The branch that the current feature branch was created from (set by work:new)
  const originBranch = userConfig?.localStorageBranchTargets?.[currentBranch] || null;
  const recommendedBranch = originBranch || config.developmentBranch || 'integration';

  if (agentMode || isCI) {
    uxLog('action', commandThis, c.cyan(t('backpromoteParentBranchAutoSelected', { parentBranch: c.green(recommendedBranch) })));
    return recommendedBranch;
  }
  // Interactive: let user choose from major org branches (+ developmentBranch)
  const majorOrgs = await listMajorOrgs();
  const majorBranchNames = new Set(majorOrgs.map((org: any) => org.branchName).filter(Boolean));
  // Also include developmentBranch even if it's not a major org
  if (config.developmentBranch) {
    majorBranchNames.add(config.developmentBranch);
  }

  const branchChoices: any[] = [];
  // Add recommended branch first
  if (majorBranchNames.has(recommendedBranch)) {
    branchChoices.push({
      title: `${recommendedBranch} (${t('recommended')})`,
      value: recommendedBranch,
    });
  }
  // Add remaining major branches
  for (const branchName of majorBranchNames) {
    if (branchName !== recommendedBranch) {
      branchChoices.push({ title: branchName, value: branchName });
    }
  }
  const branchRes = await prompts({
    type: 'select',
    message: c.cyanBright(t('backpromoteSelectParentBranch')),
    description: t('backpromoteSelectParentBranch'),
    name: 'value',
    choices: branchChoices,
  });
  return branchRes.value || recommendedBranch;
}

// ---- Prompt starting point ----

export async function promptBackpromoteStartingPoint(
  parentBranch: string,
  lastState: BackpromoteState | null,
): Promise<string | null> {
  // Show recent commits on the parent branch for the user to pick a starting point
  let logResult;
  try {
    logResult = await git().log([parentBranch, '-n', '50']);
  } catch {
    return null;
  }
  if (!logResult || logResult.all.length === 0) {
    return null;
  }

  // Pre-select the last backpromoted commit if available
  const lastCommitShort = lastState?.lastCommit?.substring(0, 7) || null;
  let initialIndex = 0;

  const choices = logResult.all.map((commit, index) => {
    const isLastBackpromote = lastCommitShort && commit.hash.startsWith(lastCommitShort);
    if (isLastBackpromote) {
      initialIndex = index;
    }
    const suffix = isLastBackpromote ? ` <-- ${t('backpromoteLastBackpromoteMarker')}` : '';
    return {
      title: `${commit.hash.substring(0, 7)} ${commit.message} (${formatShortDate(commit.date)})${suffix}`,
      value: commit.hash,
    };
  });

  const selectRes = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(t('backpromoteSelectStartingCommit')),
    description: t('backpromoteSelectStartingCommit'),
    choices,
    initial: initialIndex,
  });

  return selectRes.value || null;
}

// ---- List merged PRs with commits ----

export async function listMergedPrsWithCommits(
  parentBranch: string,
  currentBranch: string,
  sinceCommit: string | null,
  commandThis: any,
): Promise<BackpromotePrGroup[]> {
  uxLog('action', commandThis, c.cyan(t('backpromoteListingMergedPrs', { parentBranch: c.green(parentBranch) })));

  // Compute the merge-base between feature branch and parent branch
  let mergeBase: string;
  try {
    const mergeBaseResult = await execCommand(`git merge-base ${parentBranch} ${currentBranch}`, commandThis, { fail: true, output: false });
    mergeBase = mergeBaseResult.stdout.replace(/[\n\r]/g, '');
  } catch {
    uxLog('warning', commandThis, c.yellow(t('backpromoteNoPrsMerged', { parentBranch })));
    return [];
  }

  const fromCommit = sinceCommit || mergeBase;

  // Get all commits on parent branch since the from commit
  let logResult;
  try {
    logResult = await git().log([`${fromCommit}..${parentBranch}`]);
  } catch {
    return [];
  }
  if (!logResult || logResult.all.length === 0) {
    return [];
  }

  // Discover PRs using three complementary strategies:
  // 1. Extract PR/MR numbers from commit messages (#123, !123, Merged PR 123)
  // 2. Match commit SHAs against PR merge commit SHAs from the git provider
  // 3. Extract source branch names from merge commit messages and match against PRs by source branch
  // Strategy 3 is critical for GitLab where merge commit messages don't include MR numbers,
  // and for multi-hop merges (preprod -> main -> retrofit -> integration).
  const prNumbersFromCommits = extractPrNumbersFromCommits(logResult.all);
  const commitShaSet = new Set(logResult.all.map((c) => c.hash));
  const sourceBranchesFromCommits = extractSourceBranchesFromCommits(logResult.all);

  // Fetch merged PRs from git provider
  const gitProvider = await GitProvider.getInstance();
  const prDetailsMap = new Map<number, any>();
  const mergeCommitToPr = new Map<string, number>();
  // Maps source branch name -> PR number for strategy 3
  const sourceBranchToPr = new Map<string, number>();

  if (gitProvider) {
    try {
      const allMergedPrs = (await gitProvider.listPullRequests(
        { status: 'merged' },
      )) || [];
      for (const pr of allMergedPrs) {
        const prNum = pr.idNumber;
        if (!prNum) continue;
        // Strategy 1: PR number found in commit messages
        const matchedByMessage = prNumbersFromCommits.has(prNum);
        // Strategy 2: PR merge commit SHA is in our commit range
        const mergeSha = pr.mergeCommitSha;
        const matchedByMergeCommit = mergeSha && commitShaSet.has(mergeSha);
        // Strategy 3: PR source branch name found in merge commit messages
        const matchedBySourceBranch = pr.sourceBranch && sourceBranchesFromCommits.has(pr.sourceBranch);

        if (matchedByMessage || matchedByMergeCommit || matchedBySourceBranch) {
          prDetailsMap.set(prNum, pr);
          if (mergeSha) {
            mergeCommitToPr.set(mergeSha, prNum);
          }
          if (pr.sourceBranch) {
            sourceBranchToPr.set(pr.sourceBranch, prNum);
          }
          prNumbersFromCommits.add(prNum);
        }
      }
    } catch (e) {
      uxLog('warning', commandThis, c.yellow(`[Backpromote] Unable to list pull requests: ${(e as Error).message}`));
    }
  }

  // Group commits under their PRs, ordered by first appearance in the log
  const prGroups: BackpromotePrGroup[] = [];
  const prGroupMap = new Map<number, BackpromotePrGroup>();
  // For commits grouped by source branch when no PR number is available
  const branchGroupMap = new Map<string, BackpromotePrGroup>();
  const assignedCommits = new Set<string>();

  // Process commits in chronological order (oldest first - logResult.all is newest first)
  const commitsChronological = [...logResult.all].reverse();

  for (const commit of commitsChronological) {
    // Try to find the PR for this commit using all strategies
    let prNum: number | null = null;

    // Strategy 1: PR/MR number in commit message
    const prNumbersInMsg = extractPrNumbersFromMessage(commit.message);
    if (prNumbersInMsg.length > 0) {
      prNum = prNumbersInMsg[0];
    }
    // Strategy 2: merge commit SHA matches a PR
    if (prNum === null && mergeCommitToPr.has(commit.hash)) {
      prNum = mergeCommitToPr.get(commit.hash)!;
    }
    // Strategy 3: source branch in merge commit message matches a PR
    const sourceBranch = extractSourceBranchFromMessage(commit.message);
    if (prNum === null && sourceBranch && sourceBranchToPr.has(sourceBranch)) {
      prNum = sourceBranchToPr.get(sourceBranch)!;
    }

    if (prNum !== null) {
      assignedCommits.add(commit.hash);

      if (!prGroupMap.has(prNum)) {
        const prDetail = prDetailsMap.get(prNum);
        const prConfig = await loadPrConfig(prNum);
        const group: BackpromotePrGroup = {
          pr: {
            id: prNum,
            title: prDetail?.title || `PR #${prNum}`,
            author: prDetail?.authorName || commit.author_name,
            mergedAt: prDetail?.mergedDate || commit.date,
            webUrl: prDetail?.webUrl || '',
            sourceBranch: prDetail?.sourceBranch || sourceBranch || '',
          },
          commits: [],
          prConfig,
          mergeCommitSha: commit.hash,
        };
        prGroupMap.set(prNum, group);
        prGroups.push(group);
      }

      const group = prGroupMap.get(prNum)!;
      group.commits.push({
        hash: commit.hash.substring(0, 7),
        message: commit.message,
        author: commit.author_name,
        date: commit.date,
      });
      group.mergeCommitSha = commit.hash;
    } else if (sourceBranch) {
      // No PR number found, but we have a source branch from the merge commit.
      // Group these commits by source branch as a "virtual PR".
      assignedCommits.add(commit.hash);

      if (!branchGroupMap.has(sourceBranch)) {
        // Extract title from merge commit message (part before "Merge branch")
        const titleMatch = commit.message.match(/^(.+?)\s*Merge branch/);
        const title = titleMatch ? titleMatch[1].trim() : sourceBranch;
        const group: BackpromotePrGroup = {
          pr: {
            id: 0,
            title: title || sourceBranch,
            author: commit.author_name,
            mergedAt: commit.date,
            webUrl: '',
            sourceBranch,
          },
          commits: [],
          prConfig: null,
          mergeCommitSha: commit.hash,
        };
        branchGroupMap.set(sourceBranch, group);
        prGroups.push(group);
      }

      const group = branchGroupMap.get(sourceBranch)!;
      group.commits.push({
        hash: commit.hash.substring(0, 7),
        message: commit.message,
        author: commit.author_name,
        date: commit.date,
      });
      group.mergeCommitSha = commit.hash;
    }
  }

  // Handle unassigned commits (no PR reference and no source branch)
  const unassignedCommits = commitsChronological.filter((c) => !assignedCommits.has(c.hash));
  if (unassignedCommits.length > 0 && prGroups.length === 0) {
    // No PR matching at all - create a single group with all commits
    prGroups.push({
      pr: {
        id: 0,
        title: t('backpromoteDirectCommits'),
        author: unassignedCommits[0].author_name,
        mergedAt: unassignedCommits[unassignedCommits.length - 1].date,
        webUrl: '',
        sourceBranch: parentBranch,
      },
      commits: unassignedCommits.map((c) => ({
        hash: c.hash.substring(0, 7),
        message: c.message,
        author: c.author_name,
        date: c.date,
      })),
      prConfig: null,
      mergeCommitSha: unassignedCommits[unassignedCommits.length - 1].hash,
    });
  } else if (unassignedCommits.length > 0) {
    // Append unassigned commits to the nearest PR group by date
    for (const commit of unassignedCommits) {
      const commitDate = new Date(commit.date).getTime();
      let closestGroup = prGroups[0];
      let minDiff = Math.abs(new Date(closestGroup.pr.mergedAt).getTime() - commitDate);
      for (const group of prGroups) {
        const diff = Math.abs(new Date(group.pr.mergedAt).getTime() - commitDate);
        if (diff < minDiff) {
          minDiff = diff;
          closestGroup = group;
        }
      }
      closestGroup.commits.push({
        hash: commit.hash.substring(0, 7),
        message: commit.message,
        author: commit.author_name,
        date: commit.date,
      });
    }
  }

  return prGroups;
}

// Extract all source branch names from merge commit messages
function extractSourceBranchesFromCommits(commits: Array<{ message: string }>): Set<string> {
  const branches = new Set<string>();
  for (const commit of commits) {
    const branch = extractSourceBranchFromMessage(commit.message);
    if (branch) {
      branches.add(branch);
    }
  }
  return branches;
}

// Extract source branch name from a merge commit message.
// GitLab: "TITLE Merge branch 'feature/FOO' into 'TARGET'"
// Git merge: "Merge branch 'feature/FOO' into TARGET"
// Also handles: "Merge commit 'SHA' into BRANCH"
function extractSourceBranchFromMessage(message: string): string | null {
  // Match "Merge branch 'BRANCH_NAME' into"
  const branchMatch = message.match(/Merge branch '([^']+)' into/);
  if (branchMatch) {
    return branchMatch[1];
  }
  return null;
}

// Extract all PR/MR numbers referenced in commit messages
function extractPrNumbersFromCommits(commits: Array<{ message: string }>): Set<number> {
  const prNumbers = new Set<number>();
  for (const commit of commits) {
    for (const num of extractPrNumbersFromMessage(commit.message)) {
      prNumbers.add(num);
    }
  }
  return prNumbers;
}

// Extract PR/MR numbers from a single commit message.
// Matches patterns like: #123, Merge pull request #123, !123 (GitLab MR syntax)
function extractPrNumbersFromMessage(message: string): number[] {
  const numbers: number[] = [];
  // GitHub: "Merge pull request #123" or just "#123" in the message
  // GitLab: "Merge branch ... into ... See merge request org/repo!123"
  // Azure DevOps: "Merged PR 123:"
  const patterns = [
    /Merge pull request #(\d+)/g,
    /See merge request [^!]*!(\d+)/g,
    /Merged PR (\d+)/g,
    // Generic #NNN reference (but avoid matching issue numbers in the middle of words)
    /(?:^|\s)#(\d+)(?:\s|$|[,.):])/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      const num = parseInt(match[1], 10);
      if (num > 0) {
        numbers.push(num);
      }
    }
  }
  return [...new Set(numbers)];
}

// Load PR-scoped config file if it exists
async function loadPrConfig(prId: number): Promise<any | null> {
  const prConfigFile = path.join('scripts', 'actions', `.sfdx-hardis.${prId}.yml`);
  if (!fs.existsSync(prConfigFile)) {
    return null;
  }
  try {
    const yaml = await import('js-yaml');
    return yaml.load(await fs.readFile(prConfigFile, 'utf-8'));
  } catch {
    return null;
  }
}

// ---- Select backpromote scope ----

export async function selectBackpromoteScope(
  prGroups: BackpromotePrGroup[],
  lastBackpromoteState: BackpromoteState | null,
  commandThis: any,
  agentMode: boolean,
  fromFlag: string | null = null,
): Promise<{ targetCommit: string; selectedPrs: BackpromotePrGroup[] }> {
  if (lastBackpromoteState) {
    uxLog('log', commandThis, c.grey(t('backpromoteLastRunInfo', {
      date: lastBackpromoteState.lastTimestamp,
      commit: lastBackpromoteState.lastCommit.substring(0, 7),
    })));
  }

  if (agentMode || isCI) {
    // In agent mode with previous state: select only the next (first) PR
    if (lastBackpromoteState) {
      const firstGroup = prGroups[0];
      uxLog('action', commandThis, c.cyan(t('backpromoteAgentAutoSelectedNextPr', {
        id: firstGroup.pr.id > 0 ? `#${firstGroup.pr.id}` : firstGroup.pr.title,
      })));
      return {
        targetCommit: firstGroup.mergeCommitSha,
        selectedPrs: [firstGroup],
      };
    }
    // In agent mode with --from flag: select only the first PR (starting from the --from commit/PR)
    if (fromFlag) {
      const firstGroup = prGroups[0];
      uxLog('action', commandThis, c.cyan(t('backpromoteAgentAutoSelectedNextPr', {
        id: firstGroup.pr.id > 0 ? `#${firstGroup.pr.id}` : firstGroup.pr.title,
      })));
      return {
        targetCommit: firstGroup.mergeCommitSha,
        selectedPrs: [firstGroup],
      };
    }
    // Should not reach here (validated in command), but fallback
    throw new SfError(t('backpromoteAgentRequiresFromFlag'));
  }

  // Build choices for the prompt
  const choices = prGroups.map((group, index) => {
    const prLabel = group.pr.id > 0
      ? `#${group.pr.id} - ${group.pr.title} (${t('by')} ${group.pr.author}, ${formatShortDate(group.pr.mergedAt)}) [${group.commits.length} commits]`
      : `${group.pr.title} [${group.commits.length} commits]`;
    const commitDetails = group.commits.map((c) => `  ${c.hash} ${c.message}`).join('\n');
    return {
      title: prLabel,
      value: index,
      description: commitDetails,
    };
  });

  const selectRes = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(t('backpromoteSelectScope')),
    description: t('backpromoteSelectScope'),
    choices,
    initial: choices.length - 1, // Default to the latest PR
  });

  const selectedIndex = selectRes.value ?? prGroups.length - 1;
  const selectedPrs = prGroups.slice(0, selectedIndex + 1);
  const lastSelected = selectedPrs[selectedPrs.length - 1];

  return {
    targetCommit: lastSelected.mergeCommitSha,
    selectedPrs,
  };
}

// ---- Ensure branch is up to date with parent ----

export async function ensureBranchUpToDate(
  parentBranch: string,
  currentBranch: string,
  commandThis: any,
): Promise<void> {
  uxLog('action', commandThis, c.cyan(t('backpromoteCheckingBranchUpToDate', {
    parentBranch: c.green(parentBranch),
    currentBranch: c.green(currentBranch),
  })));

  // Fetch latest state of the parent branch
  await gitFetch({ output: true });

  // Check if the feature branch contains the latest parent branch commit
  const parentRef = (
    await execCommand(`git rev-parse origin/${parentBranch}`, commandThis, { output: false })
  ).stdout.replace(/[\n\r]/g, '');
  const mergeBase = (
    await execCommand(`git merge-base origin/${parentBranch} ${currentBranch}`, commandThis, { output: false })
  ).stdout.replace(/[\n\r]/g, '');

  if (parentRef !== mergeBase) {
    throw new SfError(
      t('backpromoteBranchNotUpToDate', {
        currentBranch,
        parentBranch,
      })
    );
  }

  uxLog('action', commandThis, c.cyan(t('backpromoteBranchUpToDate', {
    currentBranch: c.green(currentBranch),
    parentBranch: c.green(parentBranch),
  })));
}

// ---- Detect org conflicts ----

export interface OrgConflictResult {
  conflicts: OrgConflictItem[];
  success: boolean;
  errorMessage?: string;
}

export async function detectOrgConflicts(
  deltaPackageXml: string,
  targetUsername: string,
  commandThis: any,
  debugMode: boolean,
): Promise<OrgConflictResult> {
  uxLog('action', commandThis, c.cyan(t('backpromoteDetectingOrgConflicts')));

  const tmpRetrieveDir = await createTempDir();
  const conflicts: OrgConflictItem[] = [];

  // First, filter the delta package.xml to only include items that exist in the org.
  // This prevents retrieve failures caused by metadata types or members not present in the target sandbox.
  const filteredPackageXml = path.join(tmpRetrieveDir, 'filtered-package.xml');
  const packageXmlForRetrieve = await filterPackageXmlToOrgAvailable(deltaPackageXml, filteredPackageXml, targetUsername, debugMode);

  if (!packageXmlForRetrieve) {
    return { conflicts, success: true }; // Nothing to retrieve
  }

  // Retrieve filtered metadata from the org into a temp directory
  let retrieveSuccess = false;
  let retrieveError = '';
  try {
    const retrieveCmd = `sf project retrieve start -x "${packageXmlForRetrieve}" -o ${targetUsername} --output-dir "${tmpRetrieveDir}" --wait 60 --json`;
    const result = await execCommand(retrieveCmd, commandThis, {
      fail: false,
      output: debugMode,
      debug: debugMode,
    });
    retrieveSuccess = result.status === 0 || !result.stderr;
    if (!retrieveSuccess) {
      retrieveError = result.stderr || result.stdout || 'Unknown error';
    }
  } catch (e) {
    retrieveError = (e as Error).message;
  }

  if (!retrieveSuccess) {
    uxLog('error', commandThis, c.red(t('backpromoteConflictDetectionFailed')));
    uxLog('error', commandThis, c.red(retrieveError));
    return { conflicts, success: false, errorMessage: retrieveError };
  }

  // Parse the delta package.xml to know which metadata items to check
  const deltaContent = await parsePackageXmlFile(deltaPackageXml);
  const retrievePackageDir = [{ fullPath: path.resolve(tmpRetrieveDir), path: tmpRetrieveDir }];

  // Walk through retrieved metadata and compare with local
  for (const metadataType of Object.keys(deltaContent)) {
    const members = deltaContent[metadataType];
    for (const member of members) {
      // Find the local file using existing utility
      const localFile = await MetadataUtils.findMetaFileFromTypeAndName(metadataType, member);
      // Find the retrieved (org) file in the temp directory
      const retrievedFile = await MetadataUtils.findMetaFileFromTypeAndName(metadataType, member, retrievePackageDir);

      if (!retrievedFile || !fs.existsSync(retrievedFile)) {
        continue; // Metadata not in org, nothing to compare
      }

      let status: OrgConflictItem['status'] = 'unchanged';
      let diffPreview = '';
      let diffMarkdown = '';
      let hasOrgChanges = false;

      if (!localFile || !fs.existsSync(localFile)) {
        status = 'deleted';
        hasOrgChanges = true;
        diffPreview = t('backpromoteFileExistsInOrgNotLocal');
        diffMarkdown = `> ${t('backpromoteFileExistsInOrgNotLocal')}\n`;
      } else {
        const orgContent = await fs.readFile(retrievedFile, 'utf-8');
        const localContent = await fs.readFile(localFile, 'utf-8');

        if (orgContent !== localContent) {
          status = 'modified';
          hasOrgChanges = true;

          // Compute diff
          const changes = Diff.createTwoFilesPatch(
            `org/${member}`,
            `local/${member}`,
            orgContent,
            localContent,
            'org version',
            'local version',
          );
          // Short preview (first few lines)
          const diffLines = changes.split('\n');
          const changedLines = diffLines.filter((l) => l.startsWith('+') || l.startsWith('-'));
          diffPreview = changedLines.slice(0, 5).join(' | ');
          if (changedLines.length > 5) {
            diffPreview += ` ... (+${changedLines.length - 5} more)`;
          }

          // Full markdown with diff code block
          diffMarkdown = '```diff\n' + changes + '\n```\n';
        }
      }

      if (hasOrgChanges) {
        conflicts.push({
          metadataType,
          metadataName: member,
          status,
          localPath: localFile || '',
          diffPreview,
          diffMarkdown,
          hasOrgChanges,
        });
      }
    }
  }

  if (conflicts.length > 0) {
    uxLog('warning', commandThis, c.yellow(t('backpromoteOrgConflictsFound', { count: conflicts.length })));
  } else {
    uxLog('action', commandThis, c.green(t('backpromoteNoOrgConflicts')));
  }

  return { conflicts, success: true };
}

// ---- Generate conflict report ----

export async function generateConflictReport(
  conflicts: OrgConflictItem[],
  commandThis: any,
): Promise<{ excelPath: string; pdfPath: string | false }> {
  const getConflictStatusLabel = (status: OrgConflictItem['status']) => {
    if (status === 'modified') {
      return t('backpromoteConflictStatusModifiedInOrg');
    }
    if (status === 'deleted') {
      return t('backpromoteConflictStatusDeletedLocally');
    }
    return status;
  };

  // CSV/Excel report
  const reportData = conflicts.map((item) => ({
    'Metadata Type': item.metadataType,
    'Name': item.metadataName,
    'Status': getConflictStatusLabel(item.status),
    'Diff Preview': item.diffPreview,
    'Local Path': item.localPath,
  }));

  const csvPath = await generateReportPath('backpromote-conflicts', '', {
    withDate: true,
    withBranchName: true,
    fileExtension: 'csv',
  });
  const csvResult = await generateCsvFile(reportData, csvPath, {
    fileTitle: t('backpromoteConflictReportTitle'),
  });
  const excelPath = csvResult?.xlsxFile || csvPath;
  uxLog('action', commandThis, c.cyan(t('backpromoteConflictReportGenerated', { excelPath: c.bold(excelPath) })));

  // Markdown -> PDF report
  const mdPath = csvPath.replace('.csv', '.md');
  let mdContent = `# ${t('backpromoteConflictReportTitle')}\n\n`;
  mdContent += `${t('backpromoteConflictReportGeneratedAt', { date: new Date().toISOString() })}\n\n`;
  mdContent += `**${conflicts.length}** ${t('backpromoteConflictReportSummary')}\n\n`;

  for (const item of conflicts) {
    const itemStatusLabel = getConflictStatusLabel(item.status);
    mdContent += `## ${item.metadataType}/${item.metadataName}\n\n`;
    mdContent += `**${t('backpromoteConflictReportStatusLabel')}:** ${itemStatusLabel} | **${t('backpromoteConflictReportPathLabel')}:** \`${item.localPath}\`\n\n`;
    if (item.diffMarkdown) {
      mdContent += item.diffMarkdown + '\n';
    }
    mdContent += '---\n\n';
  }

  await fs.writeFile(mdPath, mdContent, 'utf-8');
  const pdfPath = await generatePdfFileFromMarkdown(mdPath);
  if (pdfPath) {
    uxLog('action', commandThis, c.cyan(t('backpromoteConflictReportPdfGenerated', { pdfPath: c.bold(pdfPath) })));
    WebSocketClient.sendReportFileMessage(pdfPath, t('backpromoteConflictReportPdfLabel'), 'report');
  }

  return { excelPath, pdfPath };
}

// ---- Prompt metadata validation ----

export async function promptMetadataValidation(
  deltaPackageXml: string,
  destructiveChangesXml: string | null,
  conflicts: OrgConflictItem[],
  commandThis: any,
  agentMode: boolean,
): Promise<{ validatedPackageXml: string; validatedDestructiveXml: string | null }> {
  const deltaContent = await parsePackageXmlFile(deltaPackageXml);

  // Build flat list of items
  const allItems: Array<{ type: string; member: string; hasConflict: boolean }> = [];
  for (const mdType of Object.keys(deltaContent)) {
    for (const member of deltaContent[mdType]) {
      const conflict = conflicts.find((c) => c.metadataType === mdType && c.metadataName === member);
      allItems.push({ type: mdType, member, hasConflict: !!conflict });
    }
  }

  if (allItems.length === 0) {
    uxLog('action', commandThis, c.cyan(t('backpromoteNoDelta')));
    return { validatedPackageXml: deltaPackageXml, validatedDestructiveXml: destructiveChangesXml };
  }

  uxLog('action', commandThis, c.cyan(t('backpromoteDeltaSummary', {
    addedModified: allItems.length,
    deleted: destructiveChangesXml && fs.existsSync(destructiveChangesXml) ? await countPackageXmlItems(destructiveChangesXml) : 0,
  })));

  // Display items table
  const tableData = allItems.map((item) => ({
    'Type': item.type,
    'Name': item.member,
    'Conflict': item.hasConflict ? t('backpromoteModifiedInOrg') : '-',
  }));
  uxLogTable(commandThis, tableData, ['Type', 'Name', 'Conflict']);

  if (agentMode || isCI) {
    // In agent mode, deploy everything
    return { validatedPackageXml: deltaPackageXml, validatedDestructiveXml: destructiveChangesXml };
  }

  // Interactive: let user deselect items
  const choices = allItems.map((item) => ({
    title: `${item.type}/${item.member}${item.hasConflict ? ` (${t('backpromoteModifiedInOrg')})` : ''}`,
    value: `${item.type}::${item.member}`,
    selected: true,
  }));

  const selectRes = await prompts({
    type: 'multiselect',
    name: 'value',
    message: c.cyanBright(t('backpromoteSelectMetadataToDeploy')),
    description: t('backpromoteSelectMetadataToDeploy'),
    choices,
  });

  const selectedSet = new Set<string>(selectRes.value || allItems.map((i) => `${i.type}::${i.member}`));

  // Build filtered package.xml
  const filteredContent: Record<string, string[]> = {};
  for (const item of allItems) {
    const key = `${item.type}::${item.member}`;
    if (selectedSet.has(key)) {
      if (!filteredContent[item.type]) {
        filteredContent[item.type] = [];
      }
      filteredContent[item.type].push(item.member);
    }
  }

  const validatedPackageXml = deltaPackageXml.replace('package.xml', 'package-validated.xml');
  await writePackageXmlFile(validatedPackageXml, filteredContent);

  return { validatedPackageXml, validatedDestructiveXml: destructiveChangesXml };
}

// ---- Prompt after conflict detection failure ----

export async function promptConfirmContinueAfterConflictFailure(
  errorMessage: string,
  commandThis: any,
): Promise<boolean> {
  uxLog('error', commandThis, c.red(t('backpromoteConflictDetectionFailed')));
  uxLog('error', commandThis, c.red(errorMessage));
  uxLog('warning', commandThis, c.yellow(t('backpromoteConflictDetectionFailedExplain')));

  const confirmRes = await prompts({
    type: 'confirm',
    name: 'value',
    message: c.cyanBright(t('backpromoteConflictDetectionFailedContinue')),
    description: t('backpromoteConflictDetectionFailedContinue'),
    initial: false,
  });

  return confirmRes.value === true;
}

// ---- Handle destructive changes ----

export async function confirmDestructiveChanges(
  destructiveChangesXml: string,
  commandThis: any,
  agentMode: boolean,
): Promise<boolean> {
  if (!fs.existsSync(destructiveChangesXml) || await isPackageXmlEmpty(destructiveChangesXml)) {
    return false;
  }

  const destructiveContent = await parsePackageXmlFile(destructiveChangesXml);
  let totalItems = 0;
  const items: Array<{ Type: string; Name: string }> = [];
  for (const mdType of Object.keys(destructiveContent)) {
    for (const member of destructiveContent[mdType]) {
      items.push({ Type: mdType, Name: member });
      totalItems++;
    }
  }

  uxLog('warning', commandThis, c.yellow(t('backpromoteDestructiveChangesWarning', { count: totalItems })));
  uxLogTable(commandThis, items, ['Type', 'Name']);

  if (agentMode || isCI) {
    uxLog('warning', commandThis, c.yellow(t('backpromoteDestructiveChangesAutoConfirmed')));
    return true;
  }

  const confirmRes = await prompts({
    type: 'confirm',
    name: 'value',
    message: c.cyanBright(t('backpromoteConfirmDestructiveChanges')),
    description: t('backpromoteConfirmDestructiveChanges'),
    initial: false,
  });

  return confirmRes.value === true;
}

// ---- Deploy metadata ----

export async function deployBackpromoteMetadata(
  packageXmlFile: string,
  destructiveChangesFile: string | null,
  targetUsername: string,
  testClasses: string[],
  commandThis: any,
  debugMode: boolean,
): Promise<void> {
  if (!fs.existsSync(packageXmlFile) || await isPackageXmlEmpty(packageXmlFile)) {
    // Check if we have destructive changes only
    if (!destructiveChangesFile || !fs.existsSync(destructiveChangesFile) || await isPackageXmlEmpty(destructiveChangesFile)) {
      uxLog('action', commandThis, c.cyan(t('backpromoteNoDelta')));
      return;
    }
  }

  const itemCount = fs.existsSync(packageXmlFile) ? await countPackageXmlItems(packageXmlFile) : 0;
  uxLog('action', commandThis, c.cyan(t('backpromoteDeploying', { count: itemCount })));

  const testLevel = testClasses.length > 0 ? 'RunSpecifiedTests' : 'NoTestRun';
  if (testClasses.length > 0) {
    uxLog('log', commandThis, c.grey(t('backpromoteTestClassesFromPrs', { classes: testClasses.join(', ') })));
  }

  const deployCmd =
    `sf project deploy start` +
    ` --manifest "${packageXmlFile}"` +
    ' --ignore-warnings' +
    ' --ignore-conflicts' +
    ` --test-level ${testLevel}` +
    (testClasses.length > 0 ? ` --tests ${testClasses.join(',')}` : '') +
    (destructiveChangesFile && fs.existsSync(destructiveChangesFile) ? ` --post-destructive-changes "${destructiveChangesFile}"` : '') +
    ` -o ${targetUsername}` +
    ` --wait ${getEnvVar('SFDX_DEPLOY_WAIT_MINUTES') || '120'}` +
    ' --json';

  const deployResult = await execCommand(deployCmd, commandThis, {
    fail: false,
    output: true,
    debug: debugMode,
  });

  if (deployResult.status !== 0 && deployResult.stderr) {
    uxLog('error', commandThis, c.red(t('backpromoteDeployFailed')));
    throw new SfError(t('backpromoteDeployFailed'));
  }

  uxLog('action', commandThis, c.green(t('backpromoteDeploySuccess', { count: itemCount })));
}

// ---- Execute deployment actions ----

export async function executeBackpromoteActions(
  selectedPrs: BackpromotePrGroup[],
  currentBranch: string,
  phase: 'commandsPreDeploy' | 'commandsPostDeploy',
  targetUsername: string,
  conn: any,
  commandThis: any,
  agentMode: boolean,
): Promise<void> {
  // Collect actions from selected PRs for the given phase only
  const allActions: Array<PrePostCommand & { prLabel: string; prId: number }> = [];

  for (const prGroup of selectedPrs) {
    if (!prGroup.prConfig) continue;
    const prLabel = prGroup.pr.id > 0 ? `#${prGroup.pr.id}` : prGroup.pr.title;
    const commands = prGroup.prConfig[phase];
    if (!Array.isArray(commands)) continue;
    for (const cmd of commands) {
      allActions.push({ ...cmd, prLabel, prId: prGroup.pr.id });
    }
  }

  if (allActions.length === 0) {
    return;
  }

  const phaseLabel = phase === 'commandsPreDeploy' ? t('actionWhenPreDeploy') : t('actionWhenPostDeploy');
  uxLog('action', commandThis, c.cyan(t('backpromoteExecutingActions', { count: allActions.length })));

  const manualActions: Array<{ label: string; username: string; prLabel: string }> = [];
  const actionEntries: BackpromoteActionEntry[] = await loadBackpromoteActionsState(currentBranch);

  // Let the user select which actions to run (already-executed ones are deselected by default)
  let selectedActionIds: Set<string>;
  if (!agentMode && !isCI) {
    const actionChoices = allActions.map((action) => {
      const existing = actionEntries.find((e) => e.actionId === action.id && e.status === 'success');
      const alreadyDone = !!existing;
      const suffix = alreadyDone ? ` (${t('backpromoteActionAlreadyDone', { date: formatShortDate(existing!.date) })})` : '';
      return {
        title: `[${phaseLabel}] ${action.label} (${action.prLabel})${suffix}`,
        value: action.id,
        selected: !alreadyDone,
      };
    });
    const selectRes = await prompts({
      type: 'multiselect',
      name: 'value',
      message: c.cyanBright(t('backpromoteSelectActions', { phase: phaseLabel })),
      description: t('backpromoteSelectActions', { phase: phaseLabel }),
      choices: actionChoices,
    });
    selectedActionIds = new Set<string>(selectRes.value || []);
  } else {
    // Agent mode: auto-exclude already-executed actions
    selectedActionIds = new Set<string>(
      allActions
        .filter((action) => !actionEntries.find((e) => e.actionId === action.id && e.status === 'success'))
        .map((action) => action.id)
    );
    // Log skipped actions
    for (const action of allActions) {
      if (!selectedActionIds.has(action.id)) {
        const existing = actionEntries.find((e) => e.actionId === action.id && e.status === 'success');
        uxLog('log', commandThis, c.grey(`[Backpromote] ${t('backpromoteSkippingActionAlreadyExecutedOn', { label: action.label, date: existing?.date || '' })}`));
      }
    }
  }

  if (selectedActionIds.size === 0) {
    uxLog('log', commandThis, c.grey(`[Backpromote] ${t('backpromoteNoPhaseActionsSelected', { phase: phaseLabel })}`));
    return;
  }

  // Store connection for actions that need it
  globalThis.jsForceConn = conn;

  for (const action of allActions) {
    if (!selectedActionIds.has(action.id)) {
      continue;
    }

    let actionStatus: BackpromoteActionEntry['status'] = 'failed';

    if (action.customUsername) {
      // Try LoginAs
      const user = await findUserByUsernameLike(action.customUsername, conn);
      if (!user) {
        uxLog('warning', commandThis, c.yellow(t('backpromoteActionLoginAsFailed', {
          username: action.customUsername,
          label: action.label,
        })));
        manualActions.push({ label: action.label, username: action.customUsername, prLabel: action.prLabel });
        actionStatus = 'manual';
      } else {
        try {
          const instanceUrl = conn.instanceUrl;
          const authResult = await authOrg('', { forceUsername: user.Username, instanceUrl, setDefault: false });
          if (authResult === true) {
            uxLog('action', commandThis, c.green(t('backpromoteActionLoginAsSuccess', { username: user.Username, label: action.label })));
            const actionInstance = await ActionsProvider.buildActionInstance(action);
            actionInstance.customUsernameToUse = user.Username;
            try {
              await actionInstance.run(action);
              uxLog('action', commandThis, c.green(`[Backpromote] ${t('backpromoteActionCompletedSuccessfully', { label: action.label })}`));
              actionStatus = 'success';
            } catch (e) {
              uxLog('error', commandThis, c.red(`[Backpromote] ${t('backpromoteActionFailedWithMessage', { label: action.label, message: (e as Error).message })}`));
            }
          } else {
            uxLog('warning', commandThis, c.yellow(t('backpromoteActionLoginAsFailed', { username: user.Username, label: action.label })));
            manualActions.push({ label: action.label, username: action.customUsername, prLabel: action.prLabel });
            actionStatus = 'manual';
          }
        } catch {
          uxLog('warning', commandThis, c.yellow(t('backpromoteActionLoginAsFailed', { username: action.customUsername, label: action.label })));
          manualActions.push({ label: action.label, username: action.customUsername, prLabel: action.prLabel });
          actionStatus = 'manual';
        }
      }
    } else {
      // Execute directly
      const actionInstance = await ActionsProvider.buildActionInstance(action);
      if (actionInstance) {
        try {
          await actionInstance.run(action);
          uxLog('action', commandThis, c.green(`[Backpromote] ${t('backpromoteActionCompletedSuccessfully', { label: action.label })}`));
          actionStatus = 'success';
        } catch (e) {
          uxLog('error', commandThis, c.red(`[Backpromote] ${t('backpromoteActionFailedWithMessage', { label: action.label, message: (e as Error).message })}`));
        }
      }
    }

    // Record action state in user config
    const entryIndex = actionEntries.findIndex((e) => e.actionId === action.id);
    const entry: BackpromoteActionEntry = {
      actionId: action.id,
      actionLabel: action.label,
      prId: action.prId,
      status: actionStatus,
      date: new Date().toISOString(),
    };
    if (entryIndex >= 0) {
      actionEntries[entryIndex] = entry;
    } else {
      actionEntries.push(entry);
    }
    await saveBackpromoteActionsState(currentBranch, actionEntries);
  }

  // Handle manual actions with one-by-one validation
  if (manualActions.length > 0 && !agentMode && !isCI) {
    uxLog('action', commandThis, c.cyan(t('backpromoteManualActionsRequired', { count: manualActions.length })));
    for (const manualAction of manualActions) {
      const actionRes = await prompts({
        type: 'text',
        name: 'value',
        message: c.cyanBright(t('backpromoteManualActionPrompt', {
          label: manualAction.label,
          username: manualAction.username,
        })),
        description: t('backpromoteManualActionPrompt', {
          label: manualAction.label,
          username: manualAction.username,
        }),
      });
      if (actionRes.value === 's' || actionRes.value === 'S') {
        uxLog('log', commandThis, c.grey(t('backpromoteManualActionSkipped', { label: manualAction.label })));
      } else {
        uxLog('log', commandThis, c.green(t('backpromoteManualActionCompleted', { label: manualAction.label })));
        // Update state to success
        const entryIdx = actionEntries.findIndex((e) => e.actionLabel === manualAction.label && e.status === 'manual');
        if (entryIdx >= 0) {
          actionEntries[entryIdx].status = 'success';
          actionEntries[entryIdx].date = new Date().toISOString();
          await saveBackpromoteActionsState(currentBranch, actionEntries);
        }
      }
    }
  } else if (manualActions.length > 0) {
    // In agent mode, just log the manual actions
    uxLog('warning', commandThis, c.yellow(t('backpromoteManualActionsRequired', { count: manualActions.length })));
    for (const manualAction of manualActions) {
      uxLog('warning', commandThis, c.yellow(t('backpromoteActionRequiresLoginAs', {
        label: manualAction.label,
        username: manualAction.username,
      })));
    }
  }
}

// ---- State management ----

export async function loadBackpromoteState(currentBranch: string): Promise<BackpromoteState | null> {
  const config = await getConfig('user');
  const states = config.backpromoteState || {};
  const state = states[currentBranch];
  if (state && state.lastCommit) {
    return state as BackpromoteState;
  }
  return null;
}

export async function saveBackpromoteState(
  currentBranch: string,
  targetCommit: string,
  parentBranch: string,
  commandThis: any,
): Promise<void> {
  const config = await getConfig('user');
  const states = config.backpromoteState || {};
  states[currentBranch] = {
    lastCommit: targetCommit,
    lastTimestamp: new Date().toISOString(),
    parentBranch,
  };
  await setConfig('user', { backpromoteState: states });
  uxLog('log', commandThis, c.grey(t('backpromoteStateSaved', { commit: targetCommit.substring(0, 7) })));
}

// ---- Deployment actions state in user config ----

export interface BackpromoteActionEntry {
  actionId: string;
  actionLabel: string;
  prId: number;
  status: 'success' | 'failed' | 'manual' | 'skipped';
  date: string;
}

export async function loadBackpromoteActionsState(currentBranch: string): Promise<BackpromoteActionEntry[]> {
  const config = await getConfig('user');
  const actionsState = config.backpromoteActionsState || {};
  return actionsState[currentBranch] || [];
}

export async function saveBackpromoteActionsState(
  currentBranch: string,
  entries: BackpromoteActionEntry[],
): Promise<void> {
  const config = await getConfig('user');
  const actionsState = config.backpromoteActionsState || {};
  actionsState[currentBranch] = entries;
  await setConfig('user', { backpromoteActionsState: actionsState });
}

// ---- Collect test classes from PRs ----

export function collectTestClassesFromPrs(selectedPrs: BackpromotePrGroup[]): string[] {
  const testClasses: string[] = [];
  for (const prGroup of selectedPrs) {
    if (prGroup.prConfig?.deploymentApexTestClasses && Array.isArray(prGroup.prConfig.deploymentApexTestClasses)) {
      testClasses.push(...prGroup.prConfig.deploymentApexTestClasses);
    }
  }
  // Deduplicate
  return [...new Set(testClasses)];
}

// ---- Filter package.xml to org-available items ----

async function filterPackageXmlToOrgAvailable(
  deltaPackageXml: string,
  outputPackageXml: string,
  targetUsername: string,
  _debugMode: boolean,
): Promise<string | null> {
  const deltaContent = await parsePackageXmlFile(deltaPackageXml);
  if (Object.keys(deltaContent).length === 0) {
    return null;
  }

  // Build a full org manifest to know what metadata exists in the target sandbox
  const orgManifestPath = await buildOrgManifest(targetUsername, null, null, { excludePackages: true });
  const orgContent = await parsePackageXmlFile(orgManifestPath);

  // Intersect: keep only delta items that exist in the org
  const filteredContent: Record<string, string[]> = {};
  for (const metadataType of Object.keys(deltaContent)) {
    const orgMembers = new Set<string>(orgContent[metadataType] || []);
    if (orgMembers.size === 0) {
      continue; // This metadata type doesn't exist in the org at all
    }
    const existingMembers = deltaContent[metadataType].filter((m: string) => orgMembers.has(m));
    if (existingMembers.length > 0) {
      filteredContent[metadataType] = existingMembers;
    }
  }

  if (Object.keys(filteredContent).length === 0) {
    return null;
  }

  await writePackageXmlFile(outputPackageXml, filteredContent);
  return outputPackageXml;
}

// ---- Helper: format date ----

function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toISOString().split('T')[0];
  } catch {
    return dateStr;
  }
}
/* jscpd:ignore-end */
