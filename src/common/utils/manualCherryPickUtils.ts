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

/**
 * What brought a story into the target branch, as the next promotion step sees it: a squashed
 * release Pull Request is one row of the target branch (its number, or only its commit when it is
 * a merge between major branches, whose number is dropped as a vehicle). The DevOps Pipeline
 * follows it from step to step, so a story goes as far as its carrier went.
 */
export interface ManualCherryPickCarrier {
  // Provider-native number of the Pull Request merged into the target branch, null for a trailer
  pullRequest: number | null;
  // Its merge or squash commit in the target branch, or the commit carrying the trailer
  commits: string[];
  // Pull Request carriers only. heldSourceBranchCommits: it held commits of the source branch
  // itself (it was branched from it, like a hotfix branch started from integration), not only
  // cherry-picks. ownCommits: how many of its commits are neither a cherry-pick nor a commit of
  // the source branch. Both set means a story of its own that also brought source commits: the
  // DevOps Pipeline does not hide it as a mere vehicle then
  heldSourceBranchCommits?: boolean;
  ownCommits?: number;
}

export interface ManualCherryPickPullRequestReference {
  idStr: string;
  sourceBranch: string;
  webUrl: string;
  number: number;
  commits: string[];
  heldSourceBranchCommits: boolean;
  ownCommits: number;
}

export interface ManualCherryPickEvidence {
  signal: ManualCherryPickSignal;
  // The commit of the target side that carries the change
  targetCommit: string;
  // The Pull Request merged into the target branch that held it, for the pull-request-commits signal
  pullRequest?: ManualCherryPickPullRequestReference;
}

export interface TargetSideCommit {
  sha: string;
  message: string;
  // Empty when not read
  parents?: string[];
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
  // Committer date (ISO 8601), when read: a cherry-pick of this commit cannot be older
  date?: string;
}

export type ManualCherryPickMatch =
  | { status: 'cherry-picked'; evidence: ManualCherryPickEvidence }
  | { status: 'partial'; foundCommits: string[]; totalCommits: number; evidence: ManualCherryPickEvidence }
  | { status: 'probable'; targetCommit: string; subject: string }
  | { status: 'none' };

type PullRequestWithCommits = { pullRequest: CommonPullRequestInfo; commits: PullRequestCommitInfo[] };

// Parents by SHA, as the target side git logs read them. `full` gives the full SHA of an
// abbreviated one (Bitbucket returns 12 characters)
export interface ParentsIndex {
  get: (sha: string) => string[] | undefined;
  full: (sha: string) => string | undefined;
}

type ManualCherryPickGitProvider = {
  listPullRequests: (filters: {
    status?: string;
    targetBranch?: string;
    minDate?: Date;
    minDateOn?: 'created' | 'merged';
    withoutComments?: boolean;
  }) => Promise<CommonPullRequestInfo[] | null>;
  listPullRequestCommits: (prNumber: number) => Promise<PullRequestCommitInfo[] | null>;
};

const CHERRY_PICK_TRAILER = /\(cherry picked from commit ([0-9a-f]{7,40})\)/g;
const DAY_MS = 24 * 60 * 60 * 1000;
// How far before the oldest candidate the target side is read, at most. A cherry-pick can predate
// the merge of its story into the source branch (picked from the feature branch first), never the
// commit it picks. The cap keeps one very old commit from widening the scan to the whole history.
const MAX_LOOKBACK_BEFORE_OLDEST_CANDIDATE_MS = 30 * DAY_MS;

/**
 * Read the target side and match every candidate not already carried by a promotion. Only called
 * when detectManualCherryPicks is on. It costs a few git logs, and one provider call per Pull
 * Request squashed into the target branch since the oldest candidate: a Pull Request merged with
 * a merge commit is read from the local history instead, it holds the same commits. Promotions are
 * left out, their description already says what they carry.
 */
export async function detectManualCherryPicks(
  candidates: PromotionCandidate[],
  options: {
    sourceBranch: string;
    targetBranch: string;
    mergeBase: string;
    minDate: Date | null;
    gitProvider: ManualCherryPickGitProvider | null;
  },
  commandThis: any = null,
): Promise<void> {
  const open = candidates.filter((candidate) => !candidate.alreadyPromotedBy);
  if (open.length === 0) {
    return;
  }
  uxLog('action', commandThis, c.cyan(t('manualCherryPickDetecting', { count: open.length, target: options.targetBranch })));

  const sourceWindow = await listSourceWindowCommits(options.sourceBranch, options.mergeBase);
  // Every candidate, the promoted ones too: a promotion's own cherry-pick is a commit of the target
  // side, and a title it shares with an open candidate must not name that candidate
  const introducedByCandidate = computeIntroducedCommits(sourceWindow, candidates.map((candidate) => candidate.group.commit.hash));
  const since = targetSideLowerBound(options.minDate, introducedByCandidate);

  const [targetCommits, olderTargetCommits, mergedPullRequests] = await Promise.all([
    listTargetSideCommits(`${options.mergeBase}..origin/${options.targetBranch}`),
    // What the target branch holds before the merge base (both branches hold it since a back-merge)
    since ? listTargetSideCommits(options.mergeBase, [`--since=${since.toISOString()}`]) : Promise.resolve([]),
    listMergedPullRequests(options, since, commandThis),
  ]);
  const pullRequestCommits = await listPullRequestsCommits(
    mergedPullRequests,
    buildParentsIndex([...targetCommits, ...olderTargetCommits]),
    options.gitProvider,
    commandThis,
  );
  const evidence = buildTargetSideEvidence(targetCommits, pullRequestCommits, {
    olderTargetCommits,
    sourceWindowShas: new Set(sourceWindow.map((commit) => commit.sha)),
  });

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

/**
 * The oldest date a cherry-pick of a candidate can have: the oldest commit the candidates bring
 * (a pick is made after the commit it picks), at most MAX_LOOKBACK_BEFORE_OLDEST_CANDIDATE_MS
 * before the oldest candidate, minus a day for the clocks of the machines that committed. Null
 * when no candidate date is known: the target side is then only read since the merge base.
 */
export function targetSideLowerBound(minDate: Date | null, introducedByCandidate: Map<string, CandidateCommit[]>): Date | null {
  if (!minDate || isNaN(minDate.getTime())) {
    return null;
  }
  let oldest = minDate.getTime();
  for (const commits of introducedByCandidate.values()) {
    for (const commit of commits) {
      const time = Date.parse(commit.date || '');
      if (!isNaN(time) && time < oldest) {
        oldest = time;
      }
    }
  }
  return new Date(Math.max(oldest, minDate.getTime() - MAX_LOOKBACK_BEFORE_OLDEST_CANDIDATE_MS) - DAY_MS);
}

/**
 * Which merged Pull Requests are read from the git provider, and which from the local history.
 * One merged with a merge commit holds exactly the commits between the two parents of that merge
 * commit, already fetched with the target branch. A squash (or a rebase) leaves one new commit per
 * change and only the provider still knows the original commits. GitLab tells the squash apart
 * (squashCommitSha, its merge commit has two parents then); for the other providers, a merge
 * commit the local history does not know is read from the provider, as before.
 */
export function splitPullRequestsByMergeKind(
  pullRequests: CommonPullRequestInfo[],
  parentsIndex: ParentsIndex,
): { local: Array<{ pullRequest: CommonPullRequestInfo; mergeCommit: string }>; provider: CommonPullRequestInfo[] } {
  const local: Array<{ pullRequest: CommonPullRequestInfo; mergeCommit: string }> = [];
  const provider: CommonPullRequestInfo[] = [];
  for (const pullRequest of pullRequests) {
    const mergeCommit = pullRequest.mergeCommitSha || '';
    const known = mergeCommit && !pullRequest.squashCommitSha ? parentsIndex.get(mergeCommit) : undefined;
    if (known && known.length === 2) {
      // The full SHA: Bitbucket abbreviates the merge commit
      local.push({ pullRequest, mergeCommit: parentsIndex.full(mergeCommit) || mergeCommit });
    } else {
      provider.push(pullRequest);
    }
  }
  return { local, provider };
}

/**
 * Parents by SHA from the target side git logs, also found from an abbreviated SHA.
 */
export function buildParentsIndex(commits: TargetSideCommit[]): ParentsIndex {
  const byFull = new Map<string, string[]>();
  for (const commit of commits) {
    if (commit.parents) {
      byFull.set(commit.sha, commit.parents);
    }
  }
  const full = (sha: string): string | undefined => {
    if (byFull.has(sha)) {
      return sha;
    }
    if (sha.length < 7) {
      return undefined;
    }
    const matching = [...byFull.keys()].filter((key) => key.startsWith(sha));
    return matching.length === 1 ? matching[0] : undefined;
  };
  return {
    get: (sha: string) => {
      const key = full(sha);
      return key ? byFull.get(key) : undefined;
    },
    full,
  };
}

/**
 * Everything the target side says about where its changes came from: the trailers of its own
 * commits since the merge base, then the commits the Pull Requests merged into it held, then the
 * trailers of its older commits (a cherry-pick made before the last back-merge into the source
 * branch moved the merge base past it). The first evidence found for a SHA is kept: the target
 * branch history is read first because it is the history itself, the provider listing only
 * completes it, and the older trailers only fill what nothing else named.
 *
 * `sourceWindowShas` are the commits of the source branch since the merge base: a Pull Request
 * holding some of them was branched from the source branch, not built from cherry-picks.
 */
export function buildTargetSideEvidence(
  targetCommits: TargetSideCommit[],
  pullRequestCommits: PullRequestWithCommits[],
  options: { olderTargetCommits?: TargetSideCommit[]; sourceWindowShas?: Set<string> } = {},
): TargetSideEvidence {
  const bySourceSha = new Map<string, ManualCherryPickEvidence>();
  const bySubject = new Map<string, TargetSideCommit[]>();
  const sourceWindowShas = options.sourceWindowShas || new Set<string>();
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
    const reference: ManualCherryPickPullRequestReference = {
      idStr: pullRequest.idStr || String(pullRequest.idNumber || ''),
      sourceBranch: pullRequest.sourceBranch || '',
      webUrl: pullRequest.webUrl || '',
      number: pullRequest.idNumber || 0,
      commits: [...new Set([pullRequest.mergeCommitSha, pullRequest.squashCommitSha].filter((sha): sha is string => !!sha))],
      ...describePullRequestCommits(commits, sourceWindowShas),
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
  // Trailers only: the probable matches keep to the commits since the merge base, as before
  for (const commit of options.olderTargetCommits || []) {
    for (const source of extractCherryPickSources(commit.message)) {
      addEvidence(source, { signal: 'cherry-pick-trailer', targetCommit: commit.sha });
    }
  }
  return { bySourceSha, bySubject };
}

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
 * Whether a Pull Request held commits of the source branch, and how many commits of its own it
 * held: neither a cherry-pick (-x trailer) nor a commit of the source branch, merges left out.
 */
export function describePullRequestCommits(
  commits: PullRequestCommitInfo[],
  sourceWindowShas: Set<string>,
): { heldSourceBranchCommits: boolean; ownCommits: number } {
  let heldSourceBranchCommits = false;
  let ownCommits = 0;
  for (const commit of commits) {
    if (sourceWindowShas.has(commit.sha)) {
      heldSourceBranchCommits = true;
    } else if ((commit.parentShas || []).length < 2 && extractCherryPickSources(commit.message).length === 0) {
      ownCommits++;
    }
  }
  return { heldSourceBranchCommits, ownCommits };
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
        manualCherryPick: { signal: match.evidence.signal, targetCommit: match.evidence.targetCommit, carrier: carrierOf(match.evidence) },
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

export function carrierOf(evidence: ManualCherryPickEvidence): ManualCherryPickCarrier {
  return evidence.pullRequest
    ? {
      pullRequest: evidence.pullRequest.number || null,
      commits: evidence.pullRequest.commits,
      heldSourceBranchCommits: evidence.pullRequest.heldSourceBranchCommits,
      ownCommits: evidence.pullRequest.ownCommits,
    }
    : { pullRequest: null, commits: [evidence.targetCommit] };
}

/**
 * What each candidate brought into the source branch: itself when it is not a merge, otherwise every
 * non-merge commit of the window reachable from its other parents and not from its first parent.
 * Commits outside the window (before the merge base) are never walked: the window is the parent map.
 */
export function computeIntroducedCommits(
  windowCommits: Array<{ sha: string; parents: string[]; subject: string; date?: string }>,
  candidateHashes: string[],
): Map<string, CandidateCommit[]> {
  const bySha = new Map(windowCommits.map((commit) => [commit.sha, commit]));
  const toCandidateCommit = (commit: { sha: string; subject: string; date?: string }): CandidateCommit =>
    commit.date ? { sha: commit.sha, subject: commit.subject, date: commit.date } : { sha: commit.sha, subject: commit.subject };
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
      result.set(hash, [toCandidateCommit(commit)]);
      continue;
    }
    const firstParentSide = reachableFrom([commit.parents[0]]);
    const brought = reachableFrom(commit.parents.slice(1), firstParentSide);
    result.set(hash, windowCommits
      .filter((entry) => brought.has(entry.sha) && entry.parents.length < 2)
      .map((entry) => toCandidateCommit(entry)));
  }
  return result;
}

/**
 * The commits of the source branch since the merge base, read with a single git log: one git
 * process per candidate cost several minutes on a repository whose merges carry thousands of files.
 */
async function listSourceWindowCommits(sourceBranch: string, mergeBase: string): Promise<Array<{ sha: string; parents: string[]; subject: string; date: string }>> {
  const raw = await git().raw(['log', '--format=%H%x1f%P%x1f%cI%x1f%s%x1e', `${mergeBase}..origin/${sourceBranch}`]);
  return parseLogRecords(raw).map(([sha, parents, date, subject]) => ({
    sha,
    parents: splitParents(parents),
    date: date || '',
    subject: subject || '',
  }));
}

async function listTargetSideCommits(range: string, extraArgs: string[] = []): Promise<TargetSideCommit[]> {
  const raw = await git().raw(['log', '--format=%H%x1f%P%x1f%B%x1e', range, ...extraArgs]);
  return parseLogRecords(raw).map(([sha, parents, message]) => ({ sha, parents: splitParents(parents), message: message || '' }));
}

/**
 * The Pull Requests merged into the target branch since the lower bound, promotions left out:
 * their description is the evidence, and their commits are the cherry-picks of the target branch
 * history anyway. Bounded by merge date: a long-lived release Pull Request was opened before the
 * stories it carries were merged.
 */
async function listMergedPullRequests(
  options: Parameters<typeof detectManualCherryPicks>[1],
  since: Date | null,
  commandThis: any,
): Promise<CommonPullRequestInfo[]> {
  if (!options.gitProvider) {
    return [];
  }
  const merged = (await options.gitProvider.listPullRequests({
    status: 'merged',
    targetBranch: options.targetBranch,
    ...(since ? { minDate: since, minDateOn: 'merged' as const } : {}),
    withoutComments: true,
  })) || [];
  uxLog('other', commandThis, `Manual cherry-picks: ${merged.length} Pull Request(s) merged into ${options.targetBranch} to read`);
  return merged.filter((pullRequest) => pullRequest.idNumber > 0 && parsePromotionBranchName(pullRequest.sourceBranch || '') === null);
}

/**
 * The commits each merged Pull Request held: from the local history when it was merged with a
 * merge commit, from the git provider otherwise (splitPullRequestsByMergeKind).
 */
async function listPullRequestsCommits(
  pullRequests: CommonPullRequestInfo[],
  parentsIndex: ParentsIndex,
  gitProvider: ManualCherryPickGitProvider | null,
  commandThis: any,
): Promise<PullRequestWithCommits[]> {
  if (!gitProvider || pullRequests.length === 0) {
    return [];
  }
  const { local, provider } = splitPullRequestsByMergeKind(pullRequests, parentsIndex);
  const onError = (error: any, pullRequest: CommonPullRequestInfo) =>
    uxLog('warning', commandThis, c.yellow(t('gitProviderPullRequestCommitsNotListed', { number: pullRequest.idNumber, message: String(error?.message || error) })));
  const [fromHistory, fromProvider] = await Promise.all([
    mapInAdaptiveBatchesSettled(local, async ({ pullRequest, mergeCommit }) => ({
      pullRequest,
      commits: await listMergedCommitsLocally(mergeCommit),
    }), {
      // Local git processes: a few at a time, the workstation also runs one listing per step
      sizes: [8],
      onError: (error: any, entry) => onError(error, entry.pullRequest),
    }),
    mapInAdaptiveBatchesSettled(provider, async (pullRequest) => {
      const commits = await gitProvider.listPullRequestCommits(pullRequest.idNumber);
      return { pullRequest, commits: commits || [] };
    }, { onError }),
  ]);
  // The listing order of the provider is kept: the first Pull Request naming a SHA is its carrier
  const byNumber = new Map<number, PullRequestWithCommits>();
  for (const result of [...fromHistory, ...fromProvider]) {
    if (result) {
      byNumber.set(result.pullRequest.idNumber, result);
    }
  }
  return pullRequests
    .map((pullRequest) => byNumber.get(pullRequest.idNumber))
    .filter((result): result is PullRequestWithCommits => !!result);
}

// What a merge commit brought: its second parent, without what its first parent already had
async function listMergedCommitsLocally(mergeCommit: string): Promise<PullRequestCommitInfo[]> {
  const raw = await git().raw(['log', '--format=%H%x1f%P%x1f%B%x1e', `${mergeCommit}^2`, '--not', `${mergeCommit}^1`]);
  return parseLogRecords(raw).map(([sha, parents, message]) => ({ sha, message: message || '', parentShas: splitParents(parents) }));
}

function splitParents(parents: string | undefined): string[] {
  return (parents || '').split(' ').filter((parent) => parent);
}

function parseLogRecords(raw: string): string[][] {
  return String(raw || '')
    .split('\x1e')
    .map((record) => record.replace(/^\s+/, ''))
    .filter((record) => record.length > 0)
    .map((record) => record.split('\x1f'));
}
