/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import { attributeCommitsToFirstParents, parseCommitParents } from '../../../src/common/utils/backpromoteUtils.js';


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
