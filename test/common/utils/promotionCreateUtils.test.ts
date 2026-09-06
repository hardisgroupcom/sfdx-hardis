/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import { shouldAddVirtualPullRequest, type BackpromotePrGroup } from '../../../src/common/utils/backpromoteUtils.js';
import {
  buildConflictResolutionPrompt,
  buildPromotionPullRequestBody,
  buildPromotionPullRequestTitle,
  computePromotionCounter,
  declaredPullRequestNumbers,
  dropVehiclePullRequests,
  filterOpenPromotionPullRequests,
  gitPathSpec,
  listUnrequestedPullRequestNumbers,
  markAlreadyPromotedCandidates,
  oldestCandidateDate,
  parsePullRequestNumbersFlag,
  selectCandidatesByPullRequestNumbers,
  toCandidate,
  toStories,
  userChangesOutsideReports,
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

describe('merge commit granularity', () => {
  // A candidate is a first-parent merge commit: it may have brought several Pull Requests in at
  // once, and cherry-picking it carries all of them
  const grouped = toCandidate(group('eee5555', [{ id: 500, title: 'Story E' }, { id: 501, title: 'Story F' }]));
  const single = toCandidate(group('fff6666', [{ id: 502, title: 'Story G' }]));

  it('reports the Pull Requests nobody asked for', () => {
    expect(listUnrequestedPullRequestNumbers([grouped, single], [500, 502])).to.deep.equal([
      { candidate: grouped, numbers: [501] },
    ]);
    expect(listUnrequestedPullRequestNumbers([single], [502])).to.deep.equal([]);
    // No explicit request (interactive selection): everything the commit carries is unrequested
    expect(listUnrequestedPullRequestNumbers([single], [])).to.deep.equal([{ candidate: single, numbers: [502] }]);
  });

  it('only calls a commit already promoted when every story it carries was', () => {
    const candidates = [
      toCandidate(group('aaa1111', [{ id: 482, title: 'Story A' }, { id: 483, title: 'Story A2' }])),
      toCandidate(group('bbb2222', [{ id: 487, title: 'Story B' }])),
    ];
    const by = { idStr: '900', sourceBranch: 'promotion/uat/preprod/2026-09-05-1', webUrl: 'https://git.example.com/pr/900', merged: true };
    markAlreadyPromotedCandidates(candidates, new Map([[482, by], [487, by]]));
    // Only half of the first commit was promoted: it still has to travel, and the overlap is kept
    expect(candidates[0].alreadyPromotedBy).to.equal(undefined);
    expect(candidates[0].partiallyPromoted?.numbers).to.deep.equal([482]);
    expect(candidates[1].alreadyPromotedBy?.idStr).to.equal('900');
    expect(candidates[1].partiallyPromoted).to.equal(undefined);
  });
});

describe('oldestCandidateDate()', () => {
  it('bounds the provider queries on the oldest candidate, not on the merge base', () => {
    const older = toCandidate(group('aaa1111', [{ id: 1, title: 'A' }]));
    older.group.commit.date = '2026-09-01T08:00:00Z';
    const newer = toCandidate(group('bbb2222', [{ id: 2, title: 'B' }]));
    newer.group.commit.date = '2026-09-06T08:00:00Z';
    expect(oldestCandidateDate([newer, older])?.toISOString()).to.equal('2026-09-01T08:00:00.000Z');
    expect(oldestCandidateDate([])).to.equal(null);
  });
});

describe('declaredPullRequestNumbers()', () => {
  it('declares the stories already in the target branch too, so their actions still run there', () => {
    const carried = toStories([toCandidate(group('aaa1111', [{ id: 482, title: 'A' }]))]);
    const alreadyThere = toStories([toCandidate(group('bbb2222', [{ id: 487, title: 'B' }]))]);
    expect(declaredPullRequestNumbers(carried, alreadyThere)).to.deep.equal([482, 487]);
    expect(declaredPullRequestNumbers(carried)).to.deep.equal([482]);
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
    // Declared as well: their metadata is already in the target branch, but their deployment
    // actions and Apex test classes still have to run in the target org
    expect(body).to.contain('promotionPullRequests: [482, 487, 495]');
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


describe('dirty working tree before assembling a promotion', () => {
  const files = [
    { path: '.vscode/settings.json', working_dir: 'M' },
    { path: 'hardis-report/promotion-candidates.md', working_dir: '?' },
    { path: 'hardis-report', working_dir: '?' },
    { path: 'force-app/main/default/classes/Foo.cls', working_dir: 'M' },
  ];

  it('the reports sfdx-hardis writes in the repository are not the user work', () => {
    const userChanges = userChangesOutsideReports(files, 'hardis-report');
    expect(userChanges.map((f) => f.path)).to.deep.equal([
      '.vscode/settings.json',
      'force-app/main/default/classes/Foo.cls',
    ]);
  });

  it('windows separators and a trailing slash do not smuggle a report file back in', () => {
    const windowsFiles = [
      { path: 'hardis-report\\promotion-candidates.md', working_dir: '?' },
      { path: 'NOTES.md', working_dir: 'M' },
    ];
    expect(userChangesOutsideReports(windowsFiles, 'hardis-report/').map((f) => f.path)).to.deep.equal(['NOTES.md']);
  });

  it('a report folder is not confused with a folder whose name starts the same way', () => {
    const neighbors = [{ path: 'hardis-report-archive/old.md', working_dir: '?' }];
    expect(userChangesOutsideReports(neighbors, 'hardis-report').map((f) => f.path)).to.deep.equal([
      'hardis-report-archive/old.md',
    ]);
  });

  it('the stash and commit pathspec quotes every path and leaves the reports out', () => {
    const pathSpec = gitPathSpec(userChangesOutsideReports(files, 'hardis-report'));
    expect(pathSpec).to.equal('".vscode/settings.json" "force-app/main/default/classes/Foo.cls"');
    expect(pathSpec).to.not.contain('hardis-report');
  });

  it('nothing to offer when only the reports changed', () => {
    const onlyReports = [{ path: 'hardis-report/x.md', working_dir: '?' }];
    expect(userChangesOutsideReports(onlyReports, 'hardis-report')).to.have.length(0);
  });
});


describe('a single promotion in flight between two branches', () => {
  function openPr(idNumber: number, sourceBranch: string, targetBranch: string) {
    return {
      idNumber,
      idStr: String(idNumber),
      sourceBranch,
      targetBranch,
      title: `Promotion ${idNumber}`,
      description: '',
      authorName: 'dev',
      webUrl: `https://git.example.com/pr/${idNumber}`,
      customBehaviors: {},
      providerInfo: {},
    };
  }

  it('keeps only the promotions of this very pipeline step', () => {
    const open = [
      openPr(10, 'promotion/uat/preprod/2026-09-06-1', 'preprod'),
      openPr(11, 'promotion/uat/preprod/2026-09-05-2', 'preprod'),
      openPr(12, 'promotion/integration/uat/2026-09-06-1', 'uat'), // another step
      openPr(13, 'feature/PROJ-1', 'preprod'), // a User Story, never closed
      openPr(14, 'uat', 'preprod'), // the plain major to major merge, never closed
    ];
    expect(filterOpenPromotionPullRequests(open, 'uat', 'preprod').map((pr) => pr.idNumber)).to.deep.equal([10, 11]);
  });

  it('a promotion retargeted by hand belongs to nobody', () => {
    const open = [openPr(20, 'promotion/uat/preprod/2026-09-06-1', 'main')];
    expect(filterOpenPromotionPullRequests(open, 'uat', 'preprod')).to.have.length(0);
    expect(filterOpenPromotionPullRequests(open, 'uat', 'main')).to.have.length(0);
  });

  it('branch names are matched whatever their case', () => {
    const open = [openPr(30, 'promotion/UAT/PreProd/2026-09-06-1', 'PreProd')];
    expect(filterOpenPromotionPullRequests(open, 'uat', 'preprod').map((pr) => pr.idNumber)).to.deep.equal([30]);
  });

  it('nothing open means nothing to close', () => {
    expect(filterOpenPromotionPullRequests([], 'uat', 'preprod')).to.deep.equal([]);
  });
});


describe('dropVehiclePullRequests()', () => {
  const MAJOR = ['integration', 'uat', 'preprod', 'main'];

  function groupWith(hash: string, prs: Array<{ id: number; title: string; sourceBranch: string }>): BackpromotePrGroup {
    return {
      commit: { hash, message: 'Merge pull request', author: 'dev', date: '2026-09-06T18:00:00Z' },
      associatedPrs: prs.map((pr) => ({ ...pr, author: 'dev', webUrl: `https://git.example.com/pr/${pr.id}` })),
      prConfigs: prs.map((pr) => ({ config: { deploymentApexTestClasses: ['X'] } as any, prId: pr.id, prTitle: pr.title })),
    };
  }

  it('a merge of a major branch into another is not a User Story the promotion carries', () => {
    // Real case: the commit of #454 also matched #235 "MAJOR: deploy integration to uat",
    // whose source branch is the major branch integration
    const groups = [
      groupWith('1111537', [
        { id: 454, title: 'Resolve PROJ-159', sourceBranch: 'feature/PROJ-159-training-ABE' },
        { id: 235, title: 'MAJOR: deploy integration to uat', sourceBranch: 'integration' },
      ]),
    ];
    const kept = dropVehiclePullRequests(groups, MAJOR);
    expect(kept[0].associatedPrs.map((pr) => pr.id)).to.deep.equal([454]);
    // and its deployment actions must not travel either
    expect(kept[0].prConfigs.map((prConfig) => prConfig.prId)).to.deep.equal([454]);
  });

  it('a promotion Pull Request is a vehicle too', () => {
    const groups = [
      groupWith('aaa1111', [
        { id: 480, title: 'Promotion integration to uat', sourceBranch: 'promotion/integration/uat/2026-09-06-1' },
        { id: 481, title: 'Story', sourceBranch: 'feature/PROJ-1' },
      ]),
    ];
    expect(dropVehiclePullRequests(groups, MAJOR)[0].associatedPrs.map((pr) => pr.id)).to.deep.equal([481]);
  });

  it('branches that carry their own change are kept, whatever they are named', () => {
    const groups = [
      groupWith('bbb2222', [
        { id: 1, title: 'A', sourceBranch: 'feature/A' },
        { id: 2, title: 'B', sourceBranch: 'fix/B' },
        { id: 3, title: 'C', sourceBranch: 'retrofit/from-main' },
        { id: 4, title: 'D', sourceBranch: 'hotfix/D' },
      ]),
    ];
    expect(dropVehiclePullRequests(groups, MAJOR)[0].associatedPrs.map((pr) => pr.id)).to.deep.equal([1, 2, 3, 4]);
  });

  it('major branch names are matched whatever their case, and the group object is reused when nothing changes', () => {
    const groups = [groupWith('ccc3333', [{ id: 5, title: 'E', sourceBranch: 'UAT' }])];
    expect(dropVehiclePullRequests(groups, MAJOR)[0].associatedPrs).to.have.length(0);
    const untouched = [groupWith('ddd4444', [{ id: 6, title: 'F', sourceBranch: 'feature/F' }])];
    expect(dropVehiclePullRequests(untouched, MAJOR)[0]).to.equal(untouched[0]);
  });

  it('a commit merged without any Pull Request is left alone', () => {
    const groups = [groupWith('eee5555', [{ id: 0, title: 'direct commit', sourceBranch: '' }])];
    expect(dropVehiclePullRequests(groups, MAJOR)[0].associatedPrs).to.have.length(1);
  });
});


describe('shouldAddVirtualPullRequest()', () => {
  it('a branch merged twice is listed once, not once with its number and once without', () => {
    // Real case: feature/activate-promotions was merged twice into integration; the first merge
    // commit resolved to #491, the second resolved to nothing
    const associatedPrs = [{ sourceBranch: 'feature/activate-promotions' }];
    expect(shouldAddVirtualPullRequest(associatedPrs, new Set([491]), 'feature/activate-promotions')).to.equal(false);
  });

  it('a commit with no Pull Request of its own still gets its virtual entry', () => {
    expect(shouldAddVirtualPullRequest([{ sourceBranch: 'feature/other' }], new Set([491]), 'feature/orphan')).to.equal(true);
    expect(shouldAddVirtualPullRequest([], new Set(), 'feature/orphan')).to.equal(true);
  });

  it('at most one virtual entry per group, and none without a source branch', () => {
    expect(shouldAddVirtualPullRequest([], new Set([0]), 'feature/orphan')).to.equal(false);
    expect(shouldAddVirtualPullRequest([], new Set(), '')).to.equal(false);
  });

  it('branch names are matched whatever their case', () => {
    expect(shouldAddVirtualPullRequest([{ sourceBranch: 'Feature/Activate-Promotions' }], new Set([491]), 'feature/activate-promotions')).to.equal(false);
  });
});
