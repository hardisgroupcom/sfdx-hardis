/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import { GitProvider } from '../../../src/common/gitProvider/index.js';
import { detectManualCherryPicks } from '../../../src/common/utils/manualCherryPickUtils.js';
import { toCandidateSummary, type PromotionCandidateSummary } from '../../../src/common/utils/promotionCreateUtils.js';
import { buildManualCherryPickFixture, type ManualCherryPickFixture } from './manualCherryPickFixture.js';

void GitProvider;

// detectManualCherryPicks on a real repository: the git logs and the provider listing together
describe('detectManualCherryPicks (real repository)', () => {
  const run = async (fixture: ManualCherryPickFixture): Promise<Map<number, PromotionCandidateSummary>> => {
    const previous = process.cwd();
    process.chdir(fixture.repo);
    try {
      const candidates = fixture.candidates();
      const minDate = new Date(Math.min(...candidates.map((candidate) => Date.parse(candidate.group.commit.date))));
      await detectManualCherryPicks(candidates, {
        sourceBranch: 'INT',
        targetBranch: 'UAT',
        mergeBase: fixture.mergeBase,
        minDate,
        gitProvider: fixture.gitProvider,
      });
      return new Map(candidates.map((candidate) => [candidate.pullRequestNumbers[0], toCandidateSummary(candidate)]));
    } finally {
      process.chdir(previous);
    }
  };

  describe('release branches and a pick made before a back-merge', () => {
    let fixture: ManualCherryPickFixture;
    let result: Map<number, PromotionCandidateSummary>;

    before(async () => {
      fixture = buildManualCherryPickFixture({ withHotfix: false });
      result = await run(fixture);
    });

    after(() => fixture.cleanup());

    it('finds a story squashed into the target branch through the commits the provider lists', () => {
      const carrier = result.get(1)?.alreadyPromotedBy?.manualCherryPick?.carrier;
      expect(carrier).to.deep.include({ pullRequest: 101, commits: [fixture.commits.s101], heldSourceBranchCommits: false, ownCommits: 0 });
    });

    it('reads a Pull Request merged with a merge commit from the local history, with the same carrier', () => {
      const manual = result.get(2)?.alreadyPromotedBy?.manualCherryPick;
      expect(manual?.signal).to.equal('pull-request-commits');
      expect(manual?.carrier).to.deep.include({ pullRequest: 102, commits: [fixture.commits.m102] });
      // Only the squashed one was asked to the provider
      expect(Object.fromEntries(fixture.commitCalls)).to.deep.equal({ 101: 1 });
    });

    it('finds a pick of the target branch the last back-merge put before the merge base', () => {
      expect(result.get(3)?.alreadyPromotedBy?.manualCherryPick).to.deep.equal({
        signal: 'cherry-pick-trailer',
        targetCommit: fixture.commits.t3,
        carrier: { pullRequest: null, commits: [fixture.commits.t3] },
      });
    });

    it('leaves the other stories as candidates, and the partly picked one flagged', () => {
      expect(result.get(4)?.alreadyPromotedBy).to.be.undefined;
      expect(result.get(5)?.alreadyPromotedBy).to.be.undefined;
      expect(result.get(6)?.alreadyPromotedBy).to.be.undefined;
      expect(result.get(6)?.partiallyCherryPicked).to.deep.include({ foundCommits: [fixture.commits.f1], totalCommits: 2 });
    });
  });

  describe('a hotfix branched from the source branch', () => {
    let fixture: ManualCherryPickFixture;
    let result: Map<number, PromotionCandidateSummary>;

    before(async () => {
      fixture = buildManualCherryPickFixture({ withHotfix: true });
      result = await run(fixture);
    });

    after(() => fixture.cleanup());

    it('moves the stories it brought, and says it held source commits and a fix of its own', () => {
      const carrier = result.get(4)?.alreadyPromotedBy?.manualCherryPick?.carrier;
      expect(carrier).to.deep.include({ pullRequest: 104, heldSourceBranchCommits: true, ownCommits: 1 });
      expect(result.get(5)?.alreadyPromotedBy).to.be.undefined;
    });
  });
});
