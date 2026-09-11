/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import {
  attributeCommitsToFirstParents,
  backpromoteActionStatusFromResult,
  isVehicleMerge,
  mergedSourceBranches,
  parseCommitParents,
  splitVehicleMerges,
} from '../../../src/common/utils/backpromoteUtils.js';


describe('parseCommitParents()', () => {
  it('reads the parents of each commit of a git rev-list --parents output', () => {
    const parents = parseCommitParents(['aaa bbb ccc', 'bbb ddd', 'ddd', '', ''].join('\n'));
    expect(parents.get('aaa')).to.deep.equal(['bbb', 'ccc']);
    expect(parents.get('bbb')).to.deep.equal(['ddd']);
    expect(parents.get('ddd')).to.deep.equal([]);
    expect(parents.size).to.equal(3);
  });
});

describe('attributeCommitsToFirstParents()', () => {
  // The pipeline shape that broke: preprod holds two promotions merged one after the other, and
  // the commit each one brought in is a cherry-pick whose author date is the date it had on the
  // branch it came from, so it is older than the merge before it.
  //
  //   0839015 (merge #6)      parents baea47b 57922cd    date 01:46
  //   baea47b (merge #9)      parents 6e787d2 676dcc1    date 01:43
  //   676dcc1 (cherry-pick)   parents 6e787d2            date 01:30  <- older than 6e787d2
  //   6e787d2 (merge #8)      parents b23e6fc 707f204    date 01:40
  //   707f204 (cherry-pick)   parents b23e6fc            date 01:34
  const commits = [
    { hash: '0839015', date: '2026-09-07T01:46:00+02:00' },
    { hash: 'baea47b', date: '2026-09-07T01:43:00+02:00' },
    { hash: '676dcc1', date: '2026-09-07T01:30:00+02:00' },
    { hash: '6e787d2', date: '2026-09-07T01:40:00+02:00' },
    { hash: '707f204', date: '2026-09-07T01:34:00+02:00' },
    { hash: '57922cd', date: '2026-09-07T01:46:00+02:00' },
  ];
  const parents = parseCommitParents(
    [
      '0839015 baea47b 57922cd',
      'baea47b 6e787d2 676dcc1',
      '676dcc1 6e787d2',
      '6e787d2 b23e6fc 707f204',
      '707f204 b23e6fc',
      '57922cd b5886e7',
    ].join('\n'),
  );

  it('gives each merge the commits it really brought in, whatever their dates say', () => {
    const firstParents = [
      { hash: '6e787d2', date: '2026-09-07T01:40:00+02:00' },
      { hash: 'baea47b', date: '2026-09-07T01:43:00+02:00' },
      { hash: '0839015', date: '2026-09-07T01:46:00+02:00' },
    ];
    const attributed = attributeCommitsToFirstParents(firstParents, commits, parents);
    expect(attributed.get('6e787d2')?.map((commit) => commit.hash)).to.deep.equal(['6e787d2', '707f204']);
    // 676dcc1 is older than the merge before it, and still belongs to the merge that brought it in
    expect(attributed.get('baea47b')?.map((commit) => commit.hash)).to.deep.equal(['baea47b', '676dcc1']);
    expect(attributed.get('0839015')?.map((commit) => commit.hash)).to.deep.equal(['0839015', '57922cd']);
  });

  it('a commit reachable from two merges belongs to the older one, and commits outside the window are left out', () => {
    const shared = [
      { hash: 'newer' },
      { hash: 'older' },
      { hash: 'common' },
    ];
    const sharedParents = parseCommitParents(['newer older common', 'older base common', 'common base'].join('\n'));
    const attributed = attributeCommitsToFirstParents([{ hash: 'older' }, { hash: 'newer' }], shared, sharedParents);
    expect(attributed.get('older')?.map((commit) => commit.hash)).to.deep.equal(['older', 'common']);
    expect(attributed.get('newer')?.map((commit) => commit.hash)).to.deep.equal(['newer']);
  });
});


describe('mergedSourceBranches()', () => {
  it('reads the merged branch from a git or GitLab merge message', () => {
    expect(
      mergedSourceBranches({ hash: 'aaa', message: "Merge branch 'integration' into uat" }, new Map(), new Map()),
    ).to.deep.equal(['integration']);
  });

  it('reads the merged branch from a GitHub merge message, dropping the owner', () => {
    expect(
      mergedSourceBranches(
        { hash: 'aaa', message: 'Merge pull request #12 from cloudity/feature/SFB-1-do-things' },
        new Map(),
        new Map(),
      ),
    ).to.deep.equal(['feature/SFB-1-do-things']);
  });

  // Azure DevOps completes a Pull Request without fast-forward, which is what keeps the -x
  // trailers of the cherry-picks, and writes the sentence without a # and with the target branch
  // after it. Read as GitHub's, the number is lost and a story a promotion carried can no longer
  // be selected on its own.
  it('reads the merged branch from an Azure DevOps merge message, which has no #', () => {
    expect(
      mergedSourceBranches(
        { hash: 'aaa', message: 'Merge pull request 52 from feature/E2E-101-alpha into integration' },
        new Map(),
        new Map(),
      ),
    ).to.deep.equal(['feature/E2E-101-alpha']);
  });

  it('finds the Pull Request number of an Azure DevOps merge message', () => {
    const branches = mergedSourceBranches(
      { hash: 'aaa', message: 'Merge pull request 58 from promotion/integration/uat/2026-09-09-1 into uat' },
      new Map(),
      new Map([[58, { sourceBranch: 'promotion/integration/uat/2026-09-09-1' }]]),
    );
    expect(branches).to.deep.equal(['promotion/integration/uat/2026-09-09-1']);
  });

  it('reads the source branch of the Pull Request the merge commit closed', () => {
    const branches = mergedSourceBranches(
      { hash: 'aaa', message: 'Merged PR 42: promote things' },
      new Map([['aaa', 42]]),
      new Map([[42, { sourceBranch: 'integration' }]]),
    );
    expect(branches).to.deep.equal(['integration']);
  });
});

describe('isVehicleMerge()', () => {
  it('recognizes a major branch and a promotion branch', () => {
    expect(isVehicleMerge(['integration'], ['integration', 'uat', 'preprod'])).to.be.true;
    expect(isVehicleMerge(['promotion/uat/preprod/2026-09-06-1'], ['integration', 'uat'])).to.be.true;
  });

  it('leaves a User Story branch alone', () => {
    expect(isVehicleMerge(['feature/SFB-1-do-things'], ['integration', 'uat'])).to.be.false;
    expect(isVehicleMerge([], ['integration', 'uat'])).to.be.false;
  });
});

describe('splitVehicleMerges()', () => {
  // uat holds a single integration -> uat sync merge, which brought in two User Story merges:
  //
  //   sync    (merge integration into uat)   parents uatBase, feat2
  //   feat2   (merge feature/two)            parents feat1, work2
  //   feat1   (merge feature/one)            parents intBase, work1
  const commits = [
    { hash: 'sync', message: "Merge branch 'integration' into uat" },
    { hash: 'feat2', message: "Merge branch 'feature/two' into integration" },
    { hash: 'work2', message: 'work two' },
    { hash: 'feat1', message: "Merge branch 'feature/one' into integration" },
    { hash: 'work1', message: 'work one' },
  ];
  const parents = parseCommitParents(
    ['sync uatBase feat2', 'feat2 feat1 work2', 'work2 feat1', 'feat1 intBase work1', 'work1 intBase'].join('\n'),
  );
  const windowHashes = new Set(commits.map((commit) => commit.hash));
  const firstParentsOf = async (fromCommit: string, toCommit: string) => {
    expect(fromCommit).to.equal('uatBase');
    expect(toCommit).to.equal('feat2');
    // git log order: newest first
    return [commits[1], commits[3]];
  };

  it('replaces a major-to-major merge by the User Story merges it brought in, newest first', async () => {
    const split = await splitVehicleMerges(
      [commits[0]],
      ['integration', 'uat', 'preprod'],
      parents,
      windowHashes,
      (commit) => mergedSourceBranches(commit, new Map(), new Map()),
      firstParentsOf,
    );
    expect(split.map((commit) => commit.hash)).to.deep.equal(['feat2', 'feat1']);
  });

  it('leaves a User Story merge as it is', async () => {
    const split = await splitVehicleMerges(
      [commits[1]],
      ['integration', 'uat'],
      parents,
      windowHashes,
      (commit) => mergedSourceBranches(commit, new Map(), new Map()),
      async () => {
        throw new Error('should not be opened up');
      },
    );
    expect(split.map((commit) => commit.hash)).to.deep.equal(['feat2']);
  });

  it('keeps the vehicle whole when what it brought in is outside the window being listed', async () => {
    const split = await splitVehicleMerges(
      [commits[0]],
      ['integration', 'uat'],
      parents,
      new Set(['sync']),
      (commit) => mergedSourceBranches(commit, new Map(), new Map()),
      firstParentsOf,
    );
    expect(split.map((commit) => commit.hash)).to.deep.equal(['sync']);
  });
});

describe('attributeCommitsToFirstParents() with opened-up vehicle merges', () => {
  it('keeps the vehicle merge as a boundary so the merge after it does not swallow it', () => {
    const commits = [{ hash: 'next' }, { hash: 'sync' }, { hash: 'feat' }];
    const parents = parseCommitParents(['next sync other', 'sync uatBase feat', 'feat intBase work'].join('\n'));
    const attributed = attributeCommitsToFirstParents(
      [{ hash: 'feat' }, { hash: 'next' }],
      commits,
      parents,
      new Set(['sync']),
    );
    expect(attributed.get('feat')?.map((commit) => commit.hash)).to.deep.equal(['feat']);
    expect(attributed.get('next')?.map((commit) => commit.hash)).to.deep.equal(['next']);
  });
});

describe('backpromoteActionStatusFromResult()', () => {
  it('never records a manual action as done', () => {
    expect(backpromoteActionStatusFromResult({ statusCode: 'manual' })).to.equal('manual');
    expect(backpromoteActionStatusFromResult({ statusCode: 'failed' })).to.equal('failed');
    expect(backpromoteActionStatusFromResult({ statusCode: 'skipped' })).to.equal('skipped');
    expect(backpromoteActionStatusFromResult({ statusCode: 'not-run' })).to.equal('skipped');
    expect(backpromoteActionStatusFromResult({ statusCode: 'success' })).to.equal('success');
    expect(backpromoteActionStatusFromResult(undefined)).to.equal('success');
  });
});
