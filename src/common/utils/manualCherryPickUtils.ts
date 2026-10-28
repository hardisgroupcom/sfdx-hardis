import c from 'chalk';
import { git, uxLog } from './index.js';
import { t } from './i18n.js';
import { mapInAdaptiveBatchesSettled } from './adaptiveBatch.js';
import { parsePromotionBranchName } from './promotionBranchUtils.js';
import type { CommonPullRequestInfo, PullRequestCommitInfo } from '../gitProvider/index.js';
import type { PromotionCandidate } from './promotionCreateUtils.js';

/**
 * detectManualCherryPicks: recognize the User Stories that reached the target branch of a
 * promotion step without a promotion branch, through cherry-picks made by hand.
 *
 * A cherry-pick rewrites the commit SHAs, so the candidate list of the source branch keeps
 * offering those stories. What still links the two sides, from the most to the least reliable:
 *
 * - `cherry-pick-trailer`: a commit of the target branch carries `(cherry picked from commit <sha>)`
 *   (`git cherry-pick -x`) naming a commit of the candidate;
 * - `pull-request-commits`: a Pull Request merged into the target branch with a squash (a release
 *   branch gathering several cherry-picks, a squashed major-to-major merge) left a single commit in
 *   the target branch history, but the git provider still lists the commits it held. Their trailers,
 *   and their own SHAs, name the candidate;
 * - `same-title`: nothing names the candidate, but exactly one commit of the target side has the
 *   same subject. Only reported as probable: titles are reused ("--V2", the same fix twice).
 *
 * A candidate whose commits are only partly found stays a candidate and is reported as partially
 * cherry-picked: moving it would hide work that did not travel.
 */

export type ManualCherryPickSignal = 'cherry-pick-trailer' | 'pull-request-commits';

export interface ManualCherryPickEvidence {
  signal: ManualCherryPickSignal;
  // The commit of the target side that carries the change
  targetCommit: string;
  // The Pull Request merged into the target branch that held it, for the pull-request-commits signal
  pullRequest?: { idStr: string; sourceBranch: string; webUrl: string };
}

export interface TargetSideCommit {
  sha: string;
  message: string;
}

export interface TargetSideEvidence {
  // Source-side SHA -> what proves it reached the target branch
  bySourceSha: Map<string, ManualCherryPickEvidence>;
  // Subject -> the target-side commits carrying it, for the probable matches
  bySubject: Map<string, TargetSideCommit[]>;
}

export interface CandidateCommit {
  sha: string;
  subject: string;
}

export type ManualCherryPickMatch =
  | { status: 'cherry-picked'; evidence: ManualCherryPickEvidence }
  | { status: 'partial'; foundCommits: string[]; totalCommits: number; evidence: ManualCherryPickEvidence }
  | { status: 'probable'; targetCommit: string; subject: string }
  | { status: 'none' };

const CHERRY_PICK_TRAILER = /\(cherry picked from commit ([0-9a-f]{7,40})\)/g;

/**
 * The SHAs named by the `git cherry-pick -x` trailers of a commit message. A commit picked again
 * from a pick carries one trailer per hop, and each of them names a commit the change came from.
 */
export function extractCherryPickSources(message: string): string[] {
  return [...String(message || '').matchAll(CHERRY_PICK_TRAILER)].map((match) => match[1]);
}

export function commitSubject(message: string): string {
  return String(message || '').split('\n')[0].trim();
}

/**
 * Everything the target side says about where its changes came from: the trailers of its own
 * commits, then the commits the squashed Pull Requests merged into it held. The first evidence
 * found for a SHA is kept: the trailers of the target branch are read first because they are the
 * history itself, the provider listing only completes it.
 */
export function buildTargetSideEvidence(
  targetCommits: TargetSideCommit[],
  pullRequestCommits: Array<{ pullRequest: CommonPullRequestInfo; commits: PullRequestCommitInfo[] }>,
): TargetSideEvidence {
  const bySourceSha = new Map<string, ManualCherryPickEvidence>();
  const bySubject = new Map<string, TargetSideCommit[]>();
  const addSubject = (commit: TargetSideCommit) => {
    const subject = commitSubject(commit.message);
    if (!subject) {
      return;
    }
    const list = bySubject.get(subject) || [];
    if (!list.some((entry) => entry.sha === commit.sha)) {
      list.push(commit);
    }
    bySubject.set(subject, list);
  };
  const addEvidence = (sha: string, evidence: ManualCherryPickEvidence) => {
    if (sha && !bySourceSha.has(sha)) {
      bySourceSha.set(sha, evidence);
    }
  };

  for (const commit of targetCommits) {
    for (const source of extractCherryPickSources(commit.message)) {
      addEvidence(source, { signal: 'cherry-pick-trailer', targetCommit: commit.sha });
    }
    addSubject(commit);
  }
  for (const { pullRequest, commits } of pullRequestCommits) {
    const reference = {
      idStr: pullRequest.idStr || String(pullRequest.idNumber || ''),
      sourceBranch: pullRequest.sourceBranch || '',
      webUrl: pullRequest.webUrl || '',
    };
    for (const commit of commits) {
      const evidence: ManualCherryPickEvidence = { signal: 'pull-request-commits', targetCommit: commit.sha, pullRequest: reference };
      // The commit itself: a squashed sync merge holds the very merge commits of the source branch
      addEvidence(commit.sha, evidence);
      // And what it was cherry-picked from: a squashed release branch holds -x picks
      for (const source of extractCherryPickSources(commit.message)) {
        addEvidence(source, evidence);
      }
      addSubject({ sha: commit.sha, message: commit.message });
    }
  }
  return { bySourceSha, bySubject };
}

/**
 * Whether the change of one candidate is on the target side.
 *
 * `introducedCommits` are the non-merge commits the candidate brings into the source branch (the
 * candidate itself when it is not a merge). `subjectCounts` counts the subjects over every
 * candidate of the window: a subject two candidates share can name neither.
 */
export function matchCandidate(
  candidateHash: string,
  introducedCommits: CandidateCommit[],
  evidence: TargetSideEvidence,
  subjectCounts: Map<string, number>,
): ManualCherryPickMatch {
  // A merge commit picked with -m 1, or held by a squashed sync merge, names the candidate itself
  const direct = evidence.bySourceSha.get(candidateHash);
  if (direct) {
    return { status: 'cherry-picked', evidence: direct };
  }
  const found = introducedCommits.filter((commit) => evidence.bySourceSha.has(commit.sha));
  if (found.length > 0 && found.length === introducedCommits.length) {
    return { status: 'cherry-picked', evidence: evidence.bySourceSha.get(found[0].sha)! };
  }
  if (found.length > 0) {
    return {
      status: 'partial',
      foundCommits: found.map((commit) => commit.sha),
      totalCommits: introducedCommits.length,
      evidence: evidence.bySourceSha.get(found[0].sha)!,
    };
  }
  for (const commit of introducedCommits) {
    const subject = commit.subject.trim();
    if (!subject || (subjectCounts.get(subject) || 0) !== 1) {
      continue;
    }
    const targets = evidence.bySubject.get(subject) || [];
    if (targets.length === 1) {
      return { status: 'probable', targetCommit: targets[0].sha, subject };
    }
  }
  return { status: 'none' };
}

/**
 * Record the matches on the candidates. A candidate a promotion already carries keeps that
 * evidence: the declaration of a promotion Pull Request is what the deployment jobs read, it wins.
 */
export function applyManualCherryPickMatches(
  candidates: PromotionCandidate[],
  matches: Map<string, ManualCherryPickMatch>,
  targetBranch: string,
): void {
  for (const candidate of candidates) {
    if (candidate.alreadyPromotedBy) {
      continue;
    }
    const match = matches.get(candidate.group.commit.hash);
    if (!match || match.status === 'none') {
      continue;
    }
    if (match.status === 'cherry-picked') {
      candidate.alreadyPromotedBy = {
        idStr: match.evidence.pullRequest?.idStr || match.evidence.targetCommit.substring(0, 8),
        sourceBranch: match.evidence.pullRequest?.sourceBranch || targetBranch,
        webUrl: match.evidence.pullRequest?.webUrl || '',
        merged: true,
        manualCherryPick: { signal: match.evidence.signal, targetCommit: match.evidence.targetCommit },
      };
    } else if (match.status === 'partial') {
      candidate.partiallyCherryPicked = {
        foundCommits: match.foundCommits,
        totalCommits: match.totalCommits,
        targetBranch,
        targetCommit: match.evidence.targetCommit,
      };
    } else {
      candidate.probablyCherryPicked = { targetCommit: match.targetCommit, subject: match.subject, targetBranch };
    }
  }
}

/**
 * Read the target side and match every candidate not already carried by a promotion. Only called
 * when detectManualCherryPicks is on: it costs one git log of each side of the step, and one
 * provider call per Pull Request merged into the target branch since the oldest candidate
 * (promotions excepted, their description already says what they carry).
 */
export async function detectManualCherryPicks(
  candidates: PromotionCandidate[],
  options: {
    sourceBranch: string;
    targetBranch: string;
    mergeBase: string;
    minDate: Date | null;
    gitProvider: {
      listPullRequests: (filters: { status?: string; targetBranch?: string; minDate?: Date; withoutComments?: boolean }) => Promise<CommonPullRequestInfo[] | null>;
      listPullRequestCommits: (prNumber: number) => Promise<PullRequestCommitInfo[] | null>;
    } | null;
  },
  commandThis: any = null,
): Promise<void> {
  const open = candidates.filter((candidate) => !candidate.alreadyPromotedBy);
  if (open.length === 0) {
    return;
  }
  uxLog('action', commandThis, c.cyan(t('manualCherryPickDetecting', { count: open.length, target: options.targetBranch })));

  const [targetCommits, pullRequestCommits, introducedByCandidate] = await Promise.all([
    listTargetSideCommits(options.targetBranch, options.mergeBase),
    listSquashedPullRequestCommits(options, commandThis),
    listIntroducedCommits(open, options.sourceBranch, options.mergeBase),
  ]);
  const evidence = buildTargetSideEvidence(targetCommits, pullRequestCommits);

  const subjectCounts = new Map<string, number>();
  for (const commits of introducedByCandidate.values()) {
    for (const commit of commits) {
      const subject = commit.subject.trim();
      subjectCounts.set(subject, (subjectCounts.get(subject) || 0) + 1);
    }
  }
  const matches = new Map<string, ManualCherryPickMatch>();
  for (const candidate of open) {
    const hash = candidate.group.commit.hash;
    matches.set(hash, matchCandidate(hash, introducedByCandidate.get(hash) || [], evidence, subjectCounts));
  }
  applyManualCherryPickMatches(open, matches, options.targetBranch);

  const counts = { picked: 0, partial: 0, probable: 0 };
  for (const match of matches.values()) {
    if (match.status === 'cherry-picked') counts.picked++;
    else if (match.status === 'partial') counts.partial++;
    else if (match.status === 'probable') counts.probable++;
  }
  uxLog('log', commandThis, c.grey(t('manualCherryPickDetected', { ...counts, target: options.targetBranch })));
}

async function listTargetSideCommits(targetBranch: string, mergeBase: string): Promise<TargetSideCommit[]> {
  const raw = await git().raw(['log', '--format=%H%x1f%B%x1e', `${mergeBase}..origin/${targetBranch}`]);
  return parseLogRecords(raw).map(([sha, message]) => ({ sha, message: message || '' }));
}

/**
 * The commits held by the Pull Requests merged into the target branch since the oldest candidate.
 * Promotion Pull Requests are left out: their description is the evidence, and their commits are
 * the cherry-picks of the target branch history anyway.
 */
async function listSquashedPullRequestCommits(
  options: Parameters<typeof detectManualCherryPicks>[1],
  commandThis: any,
): Promise<Array<{ pullRequest: CommonPullRequestInfo; commits: PullRequestCommitInfo[] }>> {
  if (!options.gitProvider) {
    return [];
  }
  const merged = (await options.gitProvider.listPullRequests({
    status: 'merged',
    targetBranch: options.targetBranch,
    ...(options.minDate ? { minDate: options.minDate } : {}),
    withoutComments: true,
  })) || [];
  const pullRequests = merged.filter((pullRequest) => pullRequest.idNumber > 0 && parsePromotionBranchName(pullRequest.sourceBranch || '') === null);
  const results = await mapInAdaptiveBatchesSettled(pullRequests, async (pullRequest) => {
    const commits = await options.gitProvider!.listPullRequestCommits(pullRequest.idNumber);
    return { pullRequest, commits: commits || [] };
  }, {
    onError: (error: any, pullRequest: CommonPullRequestInfo) =>
      uxLog('warning', commandThis, c.yellow(t('gitProviderPullRequestCommitsNotListed', { number: pullRequest.idNumber, message: String(error?.message || error) }))),
  });
  return results.filter((result): result is { pullRequest: CommonPullRequestInfo; commits: PullRequestCommitInfo[] } => !!result);
}

/**
 * The non-merge commits each candidate brings into the source branch, read with a single git log of
 * the window: one git process per candidate cost several minutes on a repository whose merges carry
 * thousands of files.
 */
async function listIntroducedCommits(candidates: PromotionCandidate[], sourceBranch: string, mergeBase: string): Promise<Map<string, CandidateCommit[]>> {
  const raw = await git().raw(['log', '--format=%H%x1f%P%x1f%s%x1e', `${mergeBase}..origin/${sourceBranch}`]);
  const windowCommits = parseLogRecords(raw).map(([sha, parents, subject]) => ({
    sha,
    parents: (parents || '').split(' ').filter((parent) => parent),
    subject: subject || '',
  }));
  return computeIntroducedCommits(windowCommits, candidates.map((candidate) => candidate.group.commit.hash));
}

/**
 * What each candidate brought into the source branch: itself when it is not a merge, otherwise every
 * non-merge commit of the window reachable from its other parents and not from its first parent.
 * Commits outside the window (before the merge base) are never walked: the window is the parent map.
 */
export function computeIntroducedCommits(
  windowCommits: Array<{ sha: string; parents: string[]; subject: string }>,
  candidateHashes: string[],
): Map<string, CandidateCommit[]> {
  const bySha = new Map(windowCommits.map((commit) => [commit.sha, commit]));
  const reachableFrom = (starts: string[], stopAt: Set<string> = new Set()): Set<string> => {
    const seen = new Set<string>();
    const stack = starts.filter((sha) => bySha.has(sha) && !stopAt.has(sha));
    while (stack.length > 0) {
      const sha = stack.pop()!;
      if (seen.has(sha)) {
        continue;
      }
      seen.add(sha);
      for (const parent of bySha.get(sha)!.parents) {
        if (bySha.has(parent) && !seen.has(parent) && !stopAt.has(parent)) {
          stack.push(parent);
        }
      }
    }
    return seen;
  };
  const result = new Map<string, CandidateCommit[]>();
  for (const hash of new Set(candidateHashes)) {
    const commit = bySha.get(hash);
    if (!commit) {
      result.set(hash, []);
      continue;
    }
    if (commit.parents.length < 2) {
      result.set(hash, [{ sha: commit.sha, subject: commit.subject }]);
      continue;
    }
    const firstParentSide = reachableFrom([commit.parents[0]]);
    const brought = reachableFrom(commit.parents.slice(1), firstParentSide);
    result.set(hash, windowCommits
      .filter((entry) => brought.has(entry.sha) && entry.parents.length < 2)
      .map((entry) => ({ sha: entry.sha, subject: entry.subject })));
  }
  return result;
}

function parseLogRecords(raw: string): string[][] {
  return String(raw || '')
    .split('\x1e')
    .map((record) => record.replace(/^\s+/, ''))
    .filter((record) => record.length > 0)
    .map((record) => record.split('\x1f'));
}
