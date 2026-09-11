/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  BackpromoteGroupStatus,
  buildBackpromoteBranchName,
  buildBackpromoteMergePrompt,
  classifyBackpromoteCurrentBranch,
  decideBackpromoteWorkingBranch,
  findBackpromoteParentBranchRefusal,
  guessBackpromoteParentBranch,
  buildBackpromoteRunCommand,
  countConflictMarkerBlocks,
  defaultGroupSelection,
  findBackpromoteTargetOrgRefusal,
  findItemsAlsoChangedByUnselected,
  findNewestDoneGroupIndex,
  isSameCommit,
  metadataKeysToPackageContent,
  parseMetadataKey,
  parsePullRequestNumbers,
  parseSandboxOfUsername,
  resolveBackpromoteMergeBase,
  resolveExplicitGroupSelection,
  selectDeltaUnion,
  splitListFlag,
  splitMetadataKeysFlag,
  unionGroupDeltas,
} from '../../../src/common/utils/backpromoteSelectionUtils.js';

// Five groups merged in integration, oldest first, like the sample of the Backpromote panel
const group = (hash: string, ...prIds: number[]) => ({ commit: { hash }, associatedPrs: prIds.map((id) => ({ id })) });
const G478 = 'a478000000000000000000000000000000000000';
const G481 = 'b481000000000000000000000000000000000000';
const G482 = 'c482000000000000000000000000000000000000';
const G485 = 'd485000000000000000000000000000000000000';
const G487 = 'e487000000000000000000000000000000000000';
const groups = [group(G478, 478), group(G481, 481), group(G482, 482), group(G485, 485), group(G487, 487)];

describe('backpromote keys and flags', () => {
  it('matches a full SHA with a prefix of 7 characters or more, and nothing shorter', () => {
    expect(isSameCommit(G482, 'c482000')).to.be.true;
    expect(isSameCommit('c482000', G482)).to.be.true;
    expect(isSameCommit(G482, 'c48')).to.be.false;
    expect(isSameCommit(G482, G481)).to.be.false;
  });

  it('splits Type:Name on the first colon, keeping spaces and colons of the name', () => {
    expect(parseMetadataKey('Layout:Opportunity-Sales Layout')).to.deep.equal({ type: 'Layout', name: 'Opportunity-Sales Layout' });
    expect(parseMetadataKey('CustomLabel:A:B')).to.deep.equal({ type: 'CustomLabel', name: 'A:B' });
    expect(parseMetadataKey('Layout')).to.be.null;
    expect(parseMetadataKey(':Name')).to.be.null;
    expect(parseMetadataKey('Layout:')).to.be.null;
  });

  it('reads list flags given comma separated or repeated', () => {
    expect(splitListFlag('478, 481,,487')).to.deep.equal(['478', '481', '487']);
    expect(splitListFlag(['a', 'b,c'])).to.deep.equal(['a', 'b', 'c']);
    expect(splitListFlag(undefined)).to.deep.equal([]);
  });

  it('splits a Type:Name list only where the next item starts, so names keep their commas', () => {
    expect(splitMetadataKeysFlag(['Flow:Quote_Approval,ApexClass:InvoiceCalculator'])).to.deep.equal(['Flow:Quote_Approval', 'ApexClass:InvoiceCalculator']);
    expect(splitMetadataKeysFlag(['Layout:Account, Main Layout'])).to.deep.equal(['Layout:Account, Main Layout']);
    expect(splitMetadataKeysFlag(['Flow:A', 'Flow:A'])).to.deep.equal(['Flow:A']);
  });

  it('builds package.xml content sorted by member', () => {
    expect(metadataKeysToPackageContent(['Flow:B', 'ApexClass:Z', 'Flow:A', 'Flow:A', 'invalid'])).to.deep.equal({ Flow: ['A', 'B'], ApexClass: ['Z'] });
  });
});

describe('backpromote window and default selection', () => {
  it('starts the window at the newest group already backpromoted to the org', () => {
    expect(findNewestDoneGroupIndex(['done', 'pending', 'done', 'pending', 'pending'])).to.equal(2);
    expect(findNewestDoneGroupIndex(['pending', 'pending'])).to.equal(-1);
    expect(findNewestDoneGroupIndex([])).to.equal(-1);
  });

  it('preselects the pending groups that can be remembered, never a merge without Pull Request', () => {
    const histories = [
      { status: 'done' as BackpromoteGroupStatus, trackable: true },
      { status: 'pending' as BackpromoteGroupStatus, trackable: true },
      { status: 'pending' as BackpromoteGroupStatus, trackable: false },
      { status: 'pending' as BackpromoteGroupStatus, trackable: true },
    ];
    expect(defaultGroupSelection(histories)).to.deep.equal([1, 3]);
  });

  it('preselects the newest Pull Request only when the org never received a backpromote', () => {
    const histories = [
      { status: 'pending' as BackpromoteGroupStatus, trackable: true },
      { status: 'pending' as BackpromoteGroupStatus, trackable: true },
      { status: 'pending' as BackpromoteGroupStatus, trackable: false },
    ];
    expect(defaultGroupSelection(histories, { noHistory: true })).to.deep.equal([1]);
    expect(defaultGroupSelection([], { noHistory: true })).to.deep.equal([]);
  });

  it('reads Pull Request numbers written with or without a #', () => {
    expect(parsePullRequestNumbers(['#482', '481', '482'])).to.deep.equal({ ids: [482, 481], invalid: [] });
    expect(parsePullRequestNumbers(['abc', '#12x'])).to.deep.equal({ ids: [], invalid: ['abc', '#12x'] });
  });
});

describe('resolveBackpromoteMergeBase()', () => {
  const hashes = [G478, G481, G482, G485, G487];

  it('starts the merge from the newest group the org already received', () => {
    const statuses: BackpromoteGroupStatus[] = ['done', 'done', 'pending', 'pending', 'pending'];
    expect(resolveBackpromoteMergeBase({ groupHashesOldestFirst: hashes, statuses, selectedIndexes: [3] })).to.equal(G481);
  });

  it('keeps a pending Pull Request left out on the incoming side instead of putting it in the base', () => {
    // #481 is pending and unticked, #482 is selected: with #481 in the base, git merge-file would
    // read its change as a deletion made in the org and drop it without a conflict marker
    const statuses: BackpromoteGroupStatus[] = ['done', 'pending', 'pending', 'pending', 'pending'];
    expect(resolveBackpromoteMergeBase({ groupHashesOldestFirst: hashes, statuses, selectedIndexes: [2] })).to.equal(G478);
  });

  it('starts just before the window when nothing of it ever reached the org', () => {
    const statuses: BackpromoteGroupStatus[] = ['pending', 'pending', 'pending', 'pending', 'pending'];
    expect(resolveBackpromoteMergeBase({ groupHashesOldestFirst: hashes, statuses, selectedIndexes: [4] })).to.equal(`${G478}^1`);
    expect(resolveBackpromoteMergeBase({ groupHashesOldestFirst: hashes, statuses, selectedIndexes: [] })).to.be.null;
  });
});

describe('resolveExplicitGroupSelection()', () => {
  const statuses: BackpromoteGroupStatus[] = ['done', 'pending', 'pending', 'pending', 'pending'];

  it('selects the groups of the given Pull Requests and commits, in history order', () => {
    const resolved = resolveExplicitGroupSelection(groups, statuses, { pullRequests: [487, 481], commits: ['c482000'], to: null });
    expect(resolved.selected).to.deep.equal([1, 2, 4]);
    expect(resolved.unknownPullRequests).to.deep.equal([]);
    expect(resolved.unknownCommits).to.deep.equal([]);
  });

  it('selects every group still pending up to --to, by Pull Request number or by SHA', () => {
    expect(resolveExplicitGroupSelection(groups, statuses, { pullRequests: [], commits: [], to: '485' }).selected).to.deep.equal([1, 2, 3]);
    expect(resolveExplicitGroupSelection(groups, statuses, { pullRequests: [], commits: [], to: 'd485000' }).selected).to.deep.equal([1, 2, 3]);
  });

  it('reports the Pull Requests and commits it cannot find instead of ignoring them', () => {
    const resolved = resolveExplicitGroupSelection(groups, statuses, { pullRequests: [999], commits: ['0123456789'], to: '777' });
    expect(resolved.selected).to.deep.equal([]);
    expect(resolved.unknownPullRequests).to.deep.equal([999, 777]);
    expect(resolved.unknownCommits).to.deep.equal(['0123456789']);
  });

  it('lets an explicit Pull Request designate a group already done, to backpromote it again', () => {
    expect(resolveExplicitGroupSelection(groups, statuses, { pullRequests: [478], commits: [], to: null }).selected).to.deep.equal([0]);
  });

  it('takes the pending group of a Pull Request number, never an old done group quoting it', () => {
    // #487 is also named by the message of the oldest group (a revert, a "fixes #487" line)
    const withEcho = [group(G478, 478, 487), group(G481, 481), group(G482, 482), group(G485, 485), group(G487, 487)];
    const resolved = resolveExplicitGroupSelection(withEcho, statuses, { pullRequests: [487], commits: [], to: null });
    expect(resolved.selected).to.deep.equal([4]);
  });

  it('never reaches back before the newest group already backpromoted with --to', () => {
    const withUntracked = [group(G478, 478), group(G481), group(G482, 482), group(G485, 485), group(G487, 487)];
    const withDone: BackpromoteGroupStatus[] = ['done', 'pending', 'done', 'pending', 'pending'];
    expect(resolveExplicitGroupSelection(withUntracked, withDone, { pullRequests: [], commits: [], to: '485' }).selected).to.deep.equal([3]);
  });
});

describe('selectDeltaUnion()', () => {
  const union = unionGroupDeltas([
    { hash: G478, items: { CustomObject: ['Account'], ApexClass: ['Rollup'] }, deletions: {} },
    { hash: G481, items: { ApexClass: ['InvoiceCalculator', 'Rollup'] }, deletions: {} },
    { hash: G482, items: { Flow: ['Quote_Approval'], CustomField: ['Opportunity.Legacy_Score__c'] }, deletions: {} },
    { hash: G485, items: {}, deletions: { CustomField: ['Opportunity.Legacy_Score__c'] } },
    { hash: G487, items: { Flow: ['Quote_Approval'] }, deletions: { ApexClass: ['Old'] } },
  ]);
  const order = [G478, G481, G482, G485, G487];

  it('remembers every group touching an item', () => {
    expect(union.items.get('ApexClass:Rollup')).to.deep.equal([G478, G481]);
    expect(union.items.get('Flow:Quote_Approval')).to.deep.equal([G482, G487]);
  });

  it('keeps only the items of the selected groups', () => {
    const selection = selectDeltaUnion(union, [G478], order);
    expect([...selection.items.keys()].sort()).to.deep.equal(['ApexClass:Rollup', 'CustomObject:Account']);
    expect(selection.deletions.size).to.equal(0);
  });

  it('does not deploy an item a later group deleted, and deletes it when that group is selected', () => {
    const onlyAdd = selectDeltaUnion(union, [G482], order);
    expect(onlyAdd.items.has('CustomField:Opportunity.Legacy_Score__c')).to.be.false;
    expect(onlyAdd.deletions.has('CustomField:Opportunity.Legacy_Score__c')).to.be.false;
    const withDeletion = selectDeltaUnion(union, [G482, G485], order);
    expect(withDeletion.deletions.has('CustomField:Opportunity.Legacy_Score__c')).to.be.true;
    expect(withDeletion.items.has('CustomField:Opportunity.Legacy_Score__c')).to.be.false;
  });

  it('does not delete an item a later group re-created', () => {
    const recreated = unionGroupDeltas([
      { hash: G481, items: {}, deletions: { Flow: ['X'] } },
      { hash: G482, items: { Flow: ['X'] }, deletions: {} },
    ]);
    const selection = selectDeltaUnion(recreated, [G481, G482], order);
    expect(selection.deletions.size).to.equal(0);
    expect(selection.items.has('Flow:X')).to.be.true;
  });

  it('warns about the selected items also changed by a pending group left out', () => {
    const selection = selectDeltaUnion(union, [G481, G482], order);
    expect(findItemsAlsoChangedByUnselected(selection, [G481, G482], [G481, G482, G485, G487])).to.deep.equal(['Flow:Quote_Approval']);
    expect(findItemsAlsoChangedByUnselected(selection, [G481, G482], [G481, G482])).to.deep.equal([]);
  });
});

describe('backpromote working branch', () => {
  const majorBranches = ['integration', 'uat', 'preprod', 'main'];
  const decide = (currentBranch: string, upToDate: boolean, backpromoteReturnBranch: string | null = null) =>
    decideBackpromoteWorkingBranch({ currentBranch, parentBranch: 'integration', majorBranches, upToDate, backpromoteReturnBranch });

  it('stays on a User Story branch up to date with the parent branch', () => {
    expect(decide('feature/MKTCRMHG-1016-business-model', true)).to.deep.equal({ mode: 'currentBranch', reason: 'userStoryBranch', returnBranch: null });
  });

  it('works on a new backpromote branch when the User Story branch is behind the parent branch, and comes back', () => {
    expect(decide('feature/MKTCRMHG-1016-business-model', false)).to.deep.equal({
      mode: 'newBackpromoteBranch',
      reason: 'notUpToDate',
      returnBranch: 'feature/MKTCRMHG-1016-business-model',
    });
  });

  it('never works on a major, promotion or retrofit branch, even up to date', () => {
    expect(decide('integration', true)).to.deep.equal({ mode: 'newBackpromoteBranch', reason: 'majorBranch', returnBranch: 'integration' });
    expect(decide('uat', true).reason).to.equal('majorBranch');
    expect(decide('promotion/integration/uat/2026-09-11-0859', true)).to.deep.equal({
      mode: 'newBackpromoteBranch',
      reason: 'promotionBranch',
      returnBranch: 'promotion/integration/uat/2026-09-11-0859',
    });
    expect(decide('retrofit/from-main', true).reason).to.equal('retrofitBranch');
  });

  it('never works on the parent branch itself, even when the project declares no major branch', () => {
    expect(
      decideBackpromoteWorkingBranch({ currentBranch: 'develop', parentBranch: 'develop', majorBranches: [], upToDate: true, backpromoteReturnBranch: null }).mode
    ).to.equal('newBackpromoteBranch');
  });

  it('stays on a backpromote branch a previous run created, to finish its merge', () => {
    expect(decide('backpromote/integration/2026-09-11-0859', true, 'feature/E2E-401-dev')).to.deep.equal({
      mode: 'currentBranch',
      reason: 'backpromoteBranch',
      returnBranch: 'feature/E2E-401-dev',
    });
  });

  it('lists what a backpromote branch holds when teammates merged since it was created', () => {
    expect(decide('backpromote/integration/2026-09-11-0859', false, 'feature/E2E-401-dev')).to.deep.equal({
      mode: 'currentBranch',
      reason: 'backpromoteBranchBehind',
      returnBranch: 'feature/E2E-401-dev',
      listFromCurrentBranch: true,
    });
  });

  it('refuses to backpromote from another parent branch while a backpromote branch is not finished', () => {
    const decided = decideBackpromoteWorkingBranch({
      currentBranch: 'backpromote/integration/2026-09-11-0859',
      parentBranch: 'uat',
      majorBranches,
      upToDate: true,
      backpromoteReturnBranch: 'feature/E2E-401-dev',
      backpromoteParentBranch: 'integration',
    });
    expect(decided.refusal).to.deep.equal({ reason: 'backpromoteBranchOtherParent', parentBranch: 'integration' });
  });

  it('stays where a solved merge waits, even when the branch fell behind meanwhile', () => {
    expect(
      decideBackpromoteWorkingBranch({
        currentBranch: 'feature/E2E-401-dev',
        parentBranch: 'integration',
        majorBranches,
        upToDate: false,
        backpromoteReturnBranch: null,
        hasSolvedMerge: true,
      })
    ).to.deep.equal({ mode: 'currentBranch', reason: 'solvedMerge', returnBranch: null });
  });

  it('treats a branch only named like a promotion or retrofit branch as a User Story branch', () => {
    expect(classifyBackpromoteCurrentBranch('promotion/fix-labels', majorBranches)).to.equal('userStoryBranch');
    expect(classifyBackpromoteCurrentBranch('retrofitting-legacy', majorBranches)).to.equal('userStoryBranch');
  });

  it('refuses a parent branch that is not a major branch, unless the project declares none', () => {
    expect(findBackpromoteParentBranchRefusal('integration', majorBranches)).to.be.null;
    expect(findBackpromoteParentBranchRefusal('feature/E2E-105-apex', majorBranches)).to.deep.equal({ majorBranches });
    expect(findBackpromoteParentBranchRefusal('develop', [])).to.be.null;
  });

  it('guesses the parent branch from the current branch', () => {
    const guess = (currentBranch: string, originBranch: string | null = null, backpromoteParentBranch: string | null = null) =>
      guessBackpromoteParentBranch({ currentBranch, originBranch, backpromoteParentBranch, majorBranches, developmentBranch: 'integration' });
    expect(guess('feature/MKTCRMHG-948-order-id', 'uat')).to.equal('uat');
    expect(guess('preprod')).to.equal('preprod');
    expect(guess('promotion/integration/uat/2026-09-11-0859')).to.equal('integration');
    expect(guess('promotion/hotfix/uat/2026-09-11-0859')).to.equal('uat');
    expect(guess('backpromote/preprod/2026-09-11-0859', null, 'preprod')).to.equal('preprod');
    expect(guess('feature/no-origin')).to.equal('integration');
  });

  it('names a new backpromote branch after the parent branch and the UTC minute, without reusing a name', () => {
    const date = new Date('2026-09-11T08:59:30.000Z');
    expect(buildBackpromoteBranchName('integration', date)).to.equal('backpromote/integration/2026-09-11-0859');
    expect(
      buildBackpromoteBranchName('integration', date, ['backpromote/integration/2026-09-11-0859', 'backpromote/integration/2026-09-11-0859-2'])
    ).to.equal('backpromote/integration/2026-09-11-0859-3');
  });
});

describe('findBackpromoteTargetOrgRefusal()', () => {
  const majorOrgs = [
    { branchName: 'uat', targetUsername: 'deploy@mycompany.com.uat', instanceUrl: 'https://mycompany--uat.sandbox.my.salesforce.com' },
    { branchName: 'integration', instanceUrl: 'https://test.salesforce.com' },
  ];

  it('accepts a developer sandbox and a scratch org', () => {
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'sam@mycompany.com.dev', instanceUrl: 'https://mycompany--dev.sandbox.my.salesforce.com', majorOrgs })).to.be.null;
  });

  it('refuses a production org', () => {
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: false, username: 'admin@mycompany.com', instanceUrl: 'https://mycompany.my.salesforce.com', majorOrgs })).to.deep.equal({ reason: 'production' });
  });

  it('refuses the org of a major branch, by username or by instance URL', () => {
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'DEPLOY@mycompany.com.uat', instanceUrl: 'https://other.sandbox.my.salesforce.com', majorOrgs })).to.deep.equal({ reason: 'majorOrg', branchName: 'uat' });
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'sam@mycompany.com.uat', instanceUrl: 'https://mycompany--uat.sandbox.my.salesforce.com/', majorOrgs })).to.deep.equal({ reason: 'majorOrg', branchName: 'uat' });
  });

  it('never matches a major org on the generic test.salesforce.com login URL', () => {
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'sam@mycompany.com.dev', instanceUrl: 'https://test.salesforce.com', majorOrgs })).to.be.null;
  });

  it('refuses a major sandbox a developer is signed into with their own user', () => {
    // The config of a major sandbox usually carries the generic login URL, so the username of its
    // deployment user is the only evidence that this org is the one the pipeline deploys
    expect(
      findBackpromoteTargetOrgRefusal({
        isSandbox: true,
        username: 'sam@mycompany.com.uat',
        instanceUrl: 'https://mycompany--uat.sandbox.my.salesforce.com',
        majorOrgs: [{ branchName: 'uat', targetUsername: 'deploy@mycompany.com.uat', instanceUrl: 'https://test.salesforce.com' }],
      })
    ).to.deep.equal({ reason: 'majorOrg', branchName: 'uat' });
  });

  it('leaves a developer sandbox of the same company alone', () => {
    expect(
      findBackpromoteTargetOrgRefusal({
        isSandbox: true,
        username: 'sam@mycompany.com.devsam',
        instanceUrl: 'https://mycompany--devsam.sandbox.my.salesforce.com',
        majorOrgs: [{ branchName: 'uat', targetUsername: 'deploy@mycompany.com.uat', instanceUrl: 'https://test.salesforce.com' }],
      })
    ).to.be.null;
    expect(parseSandboxOfUsername('deploy@mycompany.com.uat')).to.deep.equal({ base: 'mycompany.com', sandbox: 'uat' });
    expect(parseSandboxOfUsername('admin@mycompany.com')).to.be.null;
  });
});

describe('backpromote merge helpers', () => {
  it('counts the conflict blocks left in a file', () => {
    const content = ['<a>', '<<<<<<< your org', 'x', '||||||| last backpromoted', 'y', '=======', 'z', '>>>>>>> integration', '<<<<<<< your org', '=======', '>>>>>>> integration'].join('\r\n');
    expect(countConflictMarkerBlocks(content)).to.equal(2);
    expect(countConflictMarkerBlocks('<Flow>\n</Flow>\n')).to.equal(0);
  });

  it('still finds a conflict when only some marker lines were removed', () => {
    // Deleting the <<<<<<< line and leaving the rest is the usual half-solved file: deploying it
    // would send ======= and >>>>>>> lines to the org
    expect(countConflictMarkerBlocks(['<a>', '  <label>org</label>', '=======', '  <label>integration</label>', '>>>>>>> integration'].join('\n'))).to.equal(1);
    expect(countConflictMarkerBlocks(['<<<<<<< your org', 'x'].join('\n'))).to.equal(1);
    expect(countConflictMarkerBlocks('<<<<<<<< eight is not a marker\n')).to.equal(0);
  });

  it('builds the run command of a selection, quoting what needs it', () => {
    const command = buildBackpromoteRunCommand({
      parentBranch: 'integration',
      pullRequests: [481, 482],
      commits: ['0123456789abcdef0123'],
      excludeMetadata: ['Layout:Opportunity-Sales Layout'],
      mergedMetadata: ['Flow:Quote_Approval'],
      actions: ['load-matrix'],
      targetUsername: 'sam@mycompany.com.dev',
    });
    expect(command).to.equal(
      'sf hardis:work:backpromote --parentbranch integration --pull-requests 481,482 --commits 0123456789ab' +
      ' --exclude-metadata "Layout:Opportunity-Sales Layout" --merged-metadata Flow:Quote_Approval --actions load-matrix' +
      ' --target-org sam@mycompany.com.dev'
    );
    expect(buildBackpromoteRunCommand({ parentBranch: 'integration', pullRequests: [1], commits: [], actions: ['a'], skipActions: true, skipDestructive: true })).to.equal(
      'sf hardis:work:backpromote --parentbranch integration --pull-requests 1 --skip-destructive --skip-actions'
    );
  });

  it('quotes an unfiled$public item so a shell does not expand it', () => {
    const command = buildBackpromoteRunCommand({
      parentBranch: 'integration',
      pullRequests: [482],
      commits: [],
      excludeMetadata: ['Report:unfiled$public/Pipeline by stage'],
    });
    expect(command).to.contain("--exclude-metadata 'Report:unfiled$public/Pipeline by stage'");
  });

  it('gives the coding agent the files, the three sides, the Pull Requests and the next command', () => {
    const prompt = buildBackpromoteMergePrompt({
      parentBranch: 'integration',
      currentBranch: 'feature/CRM-1432',
      orgLabel: 'mycompany--dev-sam',
      files: [{ key: 'Flow:Quote_Approval', localPath: 'force-app/main/default/flows/Quote_Approval.flow-meta.xml', conflictBlocks: 2 }],
      pullRequests: [{ id: 482, title: 'Quote approval process', webUrl: 'https://github.com/acme/crm/pull/482' }],
      nextCommand: 'sf hardis:work:backpromote --parentbranch integration --pull-requests 482 --merged-metadata Flow:Quote_Approval',
    });
    expect(prompt).to.contain('`force-app/main/default/flows/Quote_Approval.flow-meta.xml` (Flow:Quote_Approval): 2 conflict block(s)');
    expect(prompt).to.contain('<<<<<<< your org');
    expect(prompt).to.contain('>>>>>>> integration');
    expect(prompt).to.contain('#482 Quote approval process (https://github.com/acme/crm/pull/482)');
    expect(prompt).to.contain('Do not commit, do not push and do not deploy');
    expect(prompt).to.contain('--merged-metadata Flow:Quote_Approval');
  });
});
