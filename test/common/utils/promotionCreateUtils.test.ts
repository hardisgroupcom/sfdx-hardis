/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import type { BackpromotePrGroup } from '../../../src/common/utils/backpromoteUtils.js';
import {
  buildConflictResolutionPrompt,
  buildPromotionPullRequestBody,
  buildPromotionPullRequestTitle,
  computePromotionCounter,
  markAlreadyPromotedCandidates,
  parsePullRequestNumbersFlag,
  selectCandidatesByPullRequestNumbers,
  toCandidate,
  toStories,
} from '../../../src/common/utils/promotionCreateUtils.js';

function group(hash: string, prs: Array<{ id: number; title: string }>, message = 'Merge pull request'): BackpromotePrGroup {
  return {
    commit: { hash, message, author: 'dev', date: '2026-09-06T10:00:00Z' },
    associatedPrs: prs.map((pr) => ({ id: pr.id, title: pr.title, author: 'dev', webUrl: `https://git.example.com/pr/${pr.id}`, sourceBranch: `feature/PROJ-${pr.id}` })),
    prConfigs: [],
  };
}

describe('computePromotionCounter()', () => {
  it('starts at 1 and follows the highest existing counter of the day, local or remote', () => {
    expect(computePromotionCounter([], 'uat', 'preprod', '2026-09-06')).to.equal(1);
    const existing = [
      'refs/heads/promotion/uat/preprod/2026-09-06-1',
      'origin/promotion/uat/preprod/2026-09-06-3',
      'promotion/uat/preprod/2026-09-05-9', // another day
      'promotion/uat/main/2026-09-06-7', // another target
      'feature/x',
    ];
    expect(computePromotionCounter(existing, 'uat', 'preprod', '2026-09-06')).to.equal(4);
    expect(computePromotionCounter(existing, 'uat', 'main', '2026-09-06')).to.equal(8);
    expect(computePromotionCounter(existing, 'UAT', 'preprod', '2026-09-06')).to.equal(4);
  });
});

describe('parsePullRequestNumbersFlag()', () => {
  it('accepts commas, spaces and provider prefixes', () => {
    expect(parsePullRequestNumbersFlag('482,487')).to.deep.equal([482, 487]);
    expect(parsePullRequestNumbersFlag(' #482, !487 500 ')).to.deep.equal([482, 487, 500]);
    expect(parsePullRequestNumbersFlag('')).to.deep.equal([]);
    expect(parsePullRequestNumbersFlag(null)).to.deep.equal([]);
    expect(parsePullRequestNumbersFlag('abc,0,-2')).to.deep.equal([]);
  });
});

describe('selectCandidatesByPullRequestNumbers()', () => {
  const candidates = [
    toCandidate(group('aaa1111', [{ id: 482, title: 'Story A' }])),
    toCandidate(group('bbb2222', [{ id: 487, title: 'Story B' }])),
    toCandidate(group('ccc3333', [{ id: 491, title: 'Story C' }])),
  ];

  it('keeps the chronological order whatever the order of the flag, without duplicates', () => {
    const selected = selectCandidatesByPullRequestNumbers(candidates, [491, 482, 491]);
    expect(selected.map((candidate) => candidate.group.commit.hash)).to.deep.equal(['aaa1111', 'ccc3333']);
  });

  it('fails on a number that is not waiting for promotion, naming it', () => {
    expect(() => selectCandidatesByPullRequestNumbers(candidates, [482, 999])).to.throw(/#999/);
  });

  it('labels a candidate with its Pull Request numbers and title', () => {
    expect(candidates[0].label).to.equal('#482 Story A (dev) [aaa1111]');
    expect(candidates[0].pullRequestNumbers).to.deep.equal([482]);
    const noPr = toCandidate(group('ddd4444', [], 'chore: direct commit on uat'));
    expect(noPr.pullRequestNumbers).to.deep.equal([]);
    expect(noPr.label).to.equal('chore: direct commit on uat (dev) [ddd4444]');
  });
});

describe('markAlreadyPromotedCandidates()', () => {
  it('flags the candidates another promotion branch already carries, and leaves the others alone', () => {
    const candidates = [
      toCandidate(group('aaa1111', [{ id: 482, title: 'Story A' }])),
      toCandidate(group('bbb2222', [{ id: 487, title: 'Story B' }])),
    ];
    const alreadyPromoted = new Map([
      [487, { idStr: '900', sourceBranch: 'promotion/uat/preprod/2026-09-05-1', webUrl: 'https://git.example.com/pr/900', merged: true }],
    ]);
    markAlreadyPromotedCandidates(candidates, alreadyPromoted);
    expect(candidates[0].alreadyPromotedBy).to.equal(undefined);
    expect(candidates[1].alreadyPromotedBy?.sourceBranch).to.equal('promotion/uat/preprod/2026-09-05-1');
    expect(candidates[1].alreadyPromotedBy?.merged).to.equal(true);
  });
});

describe('promotion Pull Request title and body', () => {
  const stories = toStories([
    toCandidate(group('aaa1111', [{ id: 482, title: 'Story A' }])),
    toCandidate(group('bbb2222', [{ id: 487, title: 'Story | B' }])),
  ]);

  it('names the promotion after its branches and suffix', () => {
    expect(buildPromotionPullRequestTitle('uat', 'preprod', 'promotion/uat/preprod/2026-09-06-2')).to.equal('Promotion uat to preprod (2026-09-06-2)');
  });

  it('declares the carried Pull Requests in a yaml block the deployment jobs can read', () => {
    const body = buildPromotionPullRequestBody({
      sourceBranch: 'uat',
      targetBranch: 'preprod',
      branchName: 'promotion/uat/preprod/2026-09-06-1',
      stories,
      skipped: toStories([toCandidate(group('ccc3333', [{ id: 491, title: 'Story C' }]))]),
      ticketIds: ['PROJ-482', 'PROJ-487'],
    });
    expect(body).to.contain('```yaml\npromotionPullRequests: [482, 487]\n```');
    expect(body).to.contain('| [#482](https://git.example.com/pr/482) | Story A | dev | `feature/PROJ-482` | `aaa1111` |');
    // A pipe in a title must not break the table
    expect(body).to.contain('Story &#124; B');
    expect(body).to.contain('Tickets: PROJ-482, PROJ-487');
    expect(body).to.contain('## Left out because of cherry-pick conflicts\n\n- #491 Story C');
    expect(body).to.contain('Do not squash this Pull Request');
  });

  it('warns about stories committed with conflict markers and lists their files', () => {
    const conflictedCandidate = toCandidate(group('ccc3333', [{ id: 491, title: 'Story C' }]));
    const withConflicts = toStories([conflictedCandidate], [{ candidate: conflictedCandidate, files: ['force-app/main/default/labels/CustomLabels.labels-meta.xml'] }]);
    expect(withConflicts[0].conflictFiles).to.deep.equal(['force-app/main/default/labels/CustomLabels.labels-meta.xml']);
    const body = buildPromotionPullRequestBody({
      sourceBranch: 'uat',
      targetBranch: 'preprod',
      branchName: 'promotion/uat/preprod/2026-09-06-1',
      stories: [...stories, ...withConflicts],
      skipped: [],
      ticketIds: [],
    });
    expect(body).to.contain('promotionPullRequests: [482, 487, 491]');
    expect(body).to.contain('Conflicts to solve before merging');
    expect(body).to.contain('## Committed with conflict markers\n\n- #491 Story C\n  - `force-app/main/default/labels/CustomLabels.labels-meta.xml`');
    // A clean story has no conflict files
    expect(stories[0].conflictFiles).to.equal(undefined);
  });

  it('embeds a self-contained prompt for a coding agent when conflicts were committed', () => {
    const conflictedCandidate = toCandidate(group('ccc3333', [{ id: 491, title: 'Story C' }]));
    const conflicted = toStories([conflictedCandidate], [{ candidate: conflictedCandidate, files: ['force-app/main/default/labels/CustomLabels.labels-meta.xml'] }]);
    const prompt = buildConflictResolutionPrompt({
      sourceBranch: 'uat',
      targetBranch: 'preprod',
      branchName: 'promotion/uat/preprod/2026-09-06-1',
      conflicted,
      pullRequestUrl: 'https://git.example.com/pr/900',
    });
    expect(prompt).to.contain('git checkout promotion/uat/preprod/2026-09-06-1');
    expect(prompt).to.contain('Pull Request #491: Story C (https://git.example.com/pr/491). Origin commit in `uat`: `ccc3333`');
    expect(prompt).to.contain('- `force-app/main/default/labels/CustomLabels.labels-meta.xml`');
    expect(prompt).to.contain('fix: solve cherry-pick conflicts of promotion/uat/preprod/2026-09-06-1');
    expect(prompt).to.contain('Do not merge the Pull Request (https://git.example.com/pr/900)');
    // The same prompt is embedded in the Pull Request description, in a collapsible block
    const body = buildPromotionPullRequestBody({
      sourceBranch: 'uat',
      targetBranch: 'preprod',
      branchName: 'promotion/uat/preprod/2026-09-06-1',
      stories: conflicted,
      skipped: [],
      ticketIds: [],
    });
    expect(body).to.contain('<summary>Prompt for a coding agent');
    expect(body).to.contain('````markdown\nYou are working in a Salesforce DX git repository');
  });

  it('lists apart the stories whose change was already in the target branch', () => {
    const body = buildPromotionPullRequestBody({
      sourceBranch: 'uat',
      targetBranch: 'preprod',
      branchName: 'promotion/uat/preprod/2026-09-06-1',
      stories,
      skipped: [],
      ticketIds: [],
      alreadyThere: toStories([toCandidate(group('ddd4444', [{ id: 495, title: 'Story D' }]))]),
    });
    expect(body).to.contain('## Already in `preprod`');
    expect(body).to.contain('- #495 Story D');
    // Only the cherry-picked stories are declared as the deployment scope
    expect(body).to.contain('promotionPullRequests: [482, 487]');
  });

  it('omits the tickets and skipped sections when empty', () => {
    const body = buildPromotionPullRequestBody({
      sourceBranch: 'uat',
      targetBranch: 'preprod',
      branchName: 'promotion/uat/preprod/2026-09-06-1',
      stories,
      skipped: [],
      ticketIds: [],
    });
    expect(body).to.not.contain('Tickets:');
    expect(body).to.not.contain('Left out');
  });
});
