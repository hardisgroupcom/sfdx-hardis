/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import { GitProvider } from '../../../src/common/gitProvider/index.js';
import type { CommonPullRequestInfo } from '../../../src/common/gitProvider/index.js';
import {
  applyManualCherryPickMatches,
  buildTargetSideEvidence,
  computeIntroducedCommits,
  extractCherryPickSources,
  matchCandidate,
  type ManualCherryPickMatch,
} from '../../../src/common/utils/manualCherryPickUtils.js';
import { isManualCherryPickDetectionEnabled } from '../../../src/common/utils/promotionBranchUtils.js';
import { retryWhileRefLocked } from '../../../src/common/utils/index.js';
import { toCandidateSummary, type PromotionCandidate } from '../../../src/common/utils/promotionCreateUtils.js';

void GitProvider;

const sha = (char: string) => char.repeat(40);

function pullRequest(idNumber: number, sourceBranch: string): CommonPullRequestInfo {
  return {
    idNumber,
    idStr: `!${idNumber}`,
    targetBranch: 'UAT',
    sourceBranch,
    title: `PR ${idNumber}`,
    description: '',
    authorName: 'someone',
    webUrl: `https://gitlab.example.com/mr/${idNumber}`,
    customBehaviors: {},
    providerInfo: {},
  };
}

function candidate(hash: string, numbers: number[] = [1]): PromotionCandidate {
  return {
    group: {
      commit: { hash, message: 'Merge', author: 'someone', date: '2026-08-01T00:00:00Z' },
      associatedPrs: numbers.map((id) => ({ id, title: `Story ${id}`, author: 'someone', webUrl: '', sourceBranch: `feature/${id}` })),
      prConfigs: [],
    },
    pullRequestNumbers: numbers,
    label: `#${numbers.join(', #')}`,
  };
}

describe('manualCherryPickUtils', () => {
  describe('extractCherryPickSources', () => {
    it('reads every -x trailer of a message, one per hop', () => {
      const message = `fix: thing\n\n(cherry picked from commit ${sha('a')})\n(cherry picked from commit ${sha('b')})`;
      expect(extractCherryPickSources(message)).to.deep.equal([sha('a'), sha('b')]);
    });

    it('reads nothing from a message without trailer', () => {
      expect(extractCherryPickSources('feat: no pick here')).to.deep.equal([]);
      expect(extractCherryPickSources('')).to.deep.equal([]);
    });
  });

  describe('buildTargetSideEvidence', () => {
    it('maps the trailers of the target branch to the commits carrying them', () => {
      const evidence = buildTargetSideEvidence([{ sha: sha('t'), message: `story\n\n(cherry picked from commit ${sha('a')})` }], []);
      expect(evidence.bySourceSha.get(sha('a'))).to.deep.equal({ signal: 'cherry-pick-trailer', targetCommit: sha('t') });
    });

    it('reads the commits a squashed Pull Request held: their own SHA and their trailers', () => {
      const release = pullRequest(414, 'release/uat-DI2EIRISCRMOA-1467');
      const evidence = buildTargetSideEvidence([], [{
        pullRequest: release,
        commits: [
          { sha: sha('m'), message: "Merge branch 'feature/x' into 'INT'", parentShas: [sha('1'), sha('2')] },
          { sha: sha('p'), message: `story\n\n(cherry picked from commit ${sha('a')})`, parentShas: [sha('3')] },
        ],
      }]);
      expect(evidence.bySourceSha.get(sha('m'))?.signal).to.equal('pull-request-commits');
      expect(evidence.bySourceSha.get(sha('a'))).to.deep.include({ signal: 'pull-request-commits', targetCommit: sha('p') });
      expect(evidence.bySourceSha.get(sha('a'))?.pullRequest).to.deep.equal({
        idStr: '!414',
        sourceBranch: 'release/uat-DI2EIRISCRMOA-1467',
        webUrl: 'https://gitlab.example.com/mr/414',
      });
    });

    it('keeps the target branch history first when both sides name the same commit', () => {
      const evidence = buildTargetSideEvidence(
        [{ sha: sha('t'), message: `story\n\n(cherry picked from commit ${sha('a')})` }],
        [{ pullRequest: pullRequest(9, 'release/x'), commits: [{ sha: sha('p'), message: `story\n\n(cherry picked from commit ${sha('a')})`, parentShas: [] }] }],
      );
      expect(evidence.bySourceSha.get(sha('a'))?.signal).to.equal('cherry-pick-trailer');
    });
  });

  describe('matchCandidate', () => {
    const noSubjects = new Map<string, number>();

    it('matches a merge commit named directly (picked with -m 1, or held by a squashed sync merge)', () => {
      const evidence = buildTargetSideEvidence([{ sha: sha('t'), message: `(cherry picked from commit ${sha('c')})` }], []);
      const match = matchCandidate(sha('c'), [{ sha: sha('s'), subject: 'story' }], evidence, noSubjects);
      expect(match.status).to.equal('cherry-picked');
    });

    it('matches a candidate whose every introduced commit is on the target side', () => {
      const evidence = buildTargetSideEvidence([
        { sha: sha('t'), message: `(cherry picked from commit ${sha('1')})` },
        { sha: sha('u'), message: `(cherry picked from commit ${sha('2')})` },
      ], []);
      const match = matchCandidate(sha('c'), [{ sha: sha('1'), subject: 'a' }, { sha: sha('2'), subject: 'b' }], evidence, noSubjects);
      expect(match.status).to.equal('cherry-picked');
    });

    it('reports a candidate only part of whose commits travelled as partial, never as moved', () => {
      const evidence = buildTargetSideEvidence([{ sha: sha('t'), message: `(cherry picked from commit ${sha('1')})` }], []);
      const match = matchCandidate(sha('c'), [{ sha: sha('1'), subject: 'a' }, { sha: sha('2'), subject: 'b' }], evidence, noSubjects);
      expect(match).to.deep.include({ status: 'partial', foundCommits: [sha('1')], totalCommits: 2 });
    });

    it('reports a unique title match as probable only', () => {
      const evidence = buildTargetSideEvidence([{ sha: sha('t'), message: 'DI2EIRISCRMOA-12 / Feature / Thing\n\nbody' }], []);
      const subjects = new Map([['DI2EIRISCRMOA-12 / Feature / Thing', 1]]);
      const match = matchCandidate(sha('c'), [{ sha: sha('1'), subject: 'DI2EIRISCRMOA-12 / Feature / Thing' }], evidence, subjects);
      expect(match).to.deep.equal({ status: 'probable', targetCommit: sha('t'), subject: 'DI2EIRISCRMOA-12 / Feature / Thing' });
    });

    it('does not guess from a title two candidates share', () => {
      const evidence = buildTargetSideEvidence([{ sha: sha('t'), message: 'Thing --V2' }], []);
      const subjects = new Map([['Thing --V2', 2]]);
      expect(matchCandidate(sha('c'), [{ sha: sha('1'), subject: 'Thing --V2' }], evidence, subjects).status).to.equal('none');
    });

    it('does not guess from a title two target commits share', () => {
      const evidence = buildTargetSideEvidence([{ sha: sha('t'), message: 'Thing' }, { sha: sha('u'), message: 'Thing' }], []);
      const subjects = new Map([['Thing', 1]]);
      expect(matchCandidate(sha('c'), [{ sha: sha('1'), subject: 'Thing' }], evidence, subjects).status).to.equal('none');
    });
  });

  describe('applyManualCherryPickMatches', () => {
    it('never overrides a promotion: its declaration is what the deployment jobs read', () => {
      const promoted = candidate(sha('c'));
      promoted.alreadyPromotedBy = { idStr: '#7', sourceBranch: 'promotion/INT/UAT/2026-10-01-1200', webUrl: '', merged: true };
      const matches = new Map<string, ManualCherryPickMatch>([[sha('c'), { status: 'cherry-picked', evidence: { signal: 'cherry-pick-trailer', targetCommit: sha('t') } }]]);
      applyManualCherryPickMatches([promoted], matches, 'UAT');
      expect(promoted.alreadyPromotedBy.manualCherryPick).to.be.undefined;
    });

    it('records each status on the candidate and in the JSON summary', () => {
      const picked = candidate(sha('a'), [1]);
      const partial = candidate(sha('b'), [2]);
      const probable = candidate(sha('c'), [3]);
      const matches = new Map<string, ManualCherryPickMatch>([
        [sha('a'), { status: 'cherry-picked', evidence: { signal: 'pull-request-commits', targetCommit: sha('p'), pullRequest: { idStr: '!414', sourceBranch: 'release/uat-1467', webUrl: 'u' } } }],
        [sha('b'), { status: 'partial', foundCommits: [sha('1')], totalCommits: 2, evidence: { signal: 'cherry-pick-trailer', targetCommit: sha('t') } }],
        [sha('c'), { status: 'probable', targetCommit: sha('u'), subject: 'Thing' }],
      ]);
      applyManualCherryPickMatches([picked, partial, probable], matches, 'UAT');

      expect(toCandidateSummary(picked).alreadyPromotedBy).to.deep.equal({
        pullRequest: '!414',
        branch: 'release/uat-1467',
        url: 'u',
        merged: true,
        manualCherryPick: { signal: 'pull-request-commits', targetCommit: sha('p') },
      });
      expect(partial.alreadyPromotedBy).to.be.undefined;
      expect(toCandidateSummary(partial).partiallyCherryPicked).to.deep.equal({ foundCommits: [sha('1')], totalCommits: 2, branch: 'UAT', targetCommit: sha('t') });
      expect(probable.alreadyPromotedBy).to.be.undefined;
      expect(toCandidateSummary(probable).probablyCherryPicked).to.deep.equal({ targetCommit: sha('u'), subject: 'Thing', branch: 'UAT' });
    });

    it('names the target commit when no Pull Request held the pick', () => {
      const picked = candidate(sha('a'));
      applyManualCherryPickMatches([picked], new Map([[sha('a'), { status: 'cherry-picked', evidence: { signal: 'cherry-pick-trailer', targetCommit: sha('t') } } as ManualCherryPickMatch]]), 'UAT');
      expect(picked.alreadyPromotedBy).to.deep.include({ idStr: sha('t').substring(0, 8), sourceBranch: 'UAT', merged: true });
    });
  });

  describe('computeIntroducedCommits', () => {
    // m2 merges feature commits f1, f2 on top of m1, which merged g1. b is before the window.
    const window = [
      { sha: 'm2', parents: ['m1', 'f2'], subject: 'Merge f' },
      { sha: 'f2', parents: ['f1'], subject: 'f2' },
      { sha: 'f1', parents: ['m1'], subject: 'f1' },
      { sha: 'm1', parents: ['b', 'g1'], subject: 'Merge g' },
      { sha: 'g1', parents: ['b'], subject: 'g1' },
    ];

    it('keeps what a merge brought, not what its first parent already had', () => {
      const result = computeIntroducedCommits(window, ['m2', 'm1']);
      expect(result.get('m2')!.map((commit) => commit.sha).sort()).to.deep.equal(['f1', 'f2']);
      expect(result.get('m1')!.map((commit) => commit.sha)).to.deep.equal(['g1']);
    });

    it('returns a non-merge candidate itself, and nothing for a commit outside the window', () => {
      const result = computeIntroducedCommits(window, ['g1', 'zz']);
      expect(result.get('g1')).to.deep.equal([{ sha: 'g1', subject: 'g1' }]);
      expect(result.get('zz')).to.deep.equal([]);
    });
  });

  describe('retryWhileRefLocked', () => {
    it('fetches again when a parallel fetch holds the ref lock, and stops on any other error', async () => {
      let calls = 0;
      const result = await retryWhileRefLocked(async () => {
        calls++;
        if (calls < 3) throw new Error("error: cannot lock ref 'refs/remotes/origin/UAT': is at abc but expected def");
        return 'fetched';
      }, 4, 1);
      expect(result).to.equal('fetched');
      expect(calls).to.equal(3);

      let otherCalls = 0;
      let thrown: any = null;
      try {
        await retryWhileRefLocked(async () => {
          otherCalls++;
          throw new Error('Authentication failed');
        }, 4, 1);
      } catch (error) {
        thrown = error;
      }
      expect(thrown?.message).to.equal('Authentication failed');
      expect(otherCalls).to.equal(1);
    });
  });

  describe('isManualCherryPickDetectionEnabled', () => {
    it('is off by default, and off whenever promotion branches are', () => {
      expect(isManualCherryPickDetectionEnabled({})).to.be.false;
      expect(isManualCherryPickDetectionEnabled({ enablePromotionBranches: true })).to.be.false;
      expect(isManualCherryPickDetectionEnabled({ detectManualCherryPicks: true })).to.be.false;
      expect(isManualCherryPickDetectionEnabled({ enablePromotionBranches: true, detectManualCherryPicks: true })).to.be.true;
    });
  });
});
