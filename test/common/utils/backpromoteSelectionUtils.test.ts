/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  BackpromoteGroupStatus,
  buildBackpromoteMergePrompt,
  buildBackpromoteNewUserStoryCommand,
  buildBackpromoteRunCommand,
  countConflictMarkerBlocks,
  defaultGroupSelection,
  findBackpromoteBranchRefusal,
  findBackpromoteTargetOrgRefusal,
  findItemsAlsoChangedByUnselected,
  findNewestDoneGroupIndex,
  isSameCommit,
  metadataKeysToPackageContent,
  parseMetadataKey,
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

describe('findBackpromoteBranchRefusal()', () => {
  const majorBranches = ['integration', 'uat', 'preprod', 'main'];
  const refusal = (currentBranch: string, parentBranch: string | null, branches = majorBranches) =>
    findBackpromoteBranchRefusal({ currentBranch, parentBranch, majorBranches: branches });

  it('accepts a User Story branch backpromoted from a major branch', () => {
    expect(refusal('feature/MKTCRMHG-1016-business-model', null)).to.be.null;
    expect(refusal('feature/MKTCRMHG-1016-business-model', 'integration')).to.be.null;
  });

  it('refuses a major branch, a promotion branch and a retrofit branch, before the parent branch is known', () => {
    expect(refusal('uat', null)).to.deep.equal({ reason: 'majorBranch' });
    expect(refusal('promotion/integration/uat/2026-09-11-0859', null)).to.deep.equal({ reason: 'promotionBranch' });
    expect(refusal('promotion/uat/preprod/2026-09-06-1', 'preprod')).to.deep.equal({ reason: 'promotionBranch' });
    expect(refusal('retrofit/from-main', 'integration')).to.deep.equal({ reason: 'retrofitBranch' });
  });

  it('treats a branch only named like a promotion or retrofit branch as a User Story branch', () => {
    expect(refusal('promotion/fix-labels', 'integration')).to.be.null;
    expect(refusal('retrofitting-legacy', 'integration')).to.be.null;
  });

  it('refuses the current branch as its own parent, and a parent branch that is not a major branch', () => {
    expect(refusal('feature/E2E-401-dev', 'feature/E2E-401-dev')).to.deep.equal({ reason: 'sameBranch' });
    expect(refusal('feature/E2E-401-dev', 'feature/E2E-105-apex')).to.deep.equal({ reason: 'parentNotMajor', majorBranches });
  });

  it('accepts any parent branch when the project declares no major branch, and still refuses a promotion branch', () => {
    expect(refusal('feature/E2E-401-dev', 'develop', [])).to.be.null;
    expect(refusal('promotion/integration/uat/2026-09-11-0859', 'integration', [])).to.deep.equal({ reason: 'promotionBranch' });
  });
});

describe('buildBackpromoteNewUserStoryCommand()', () => {
  it('creates a User Story branch receiving the backpromote from the parent branch', () => {
    expect(buildBackpromoteNewUserStoryCommand('integration')).to.equal('sf hardis:work:new --backpromote integration');
    expect(buildBackpromoteNewUserStoryCommand('release/2026 Q3')).to.equal('sf hardis:work:new --backpromote "release/2026 Q3"');
  });

  it('offers nothing without a parent branch', () => {
    expect(buildBackpromoteNewUserStoryCommand('')).to.be.null;
    expect(buildBackpromoteNewUserStoryCommand('  ')).to.be.null;
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
});

describe('backpromote merge helpers', () => {
  it('counts the conflict blocks left in a file', () => {
    const content = ['<a>', '<<<<<<< your org', 'x', '||||||| last backpromoted', 'y', '=======', 'z', '>>>>>>> integration', '<<<<<<< your org', '=======', '>>>>>>> integration'].join('\r\n');
    expect(countConflictMarkerBlocks(content)).to.equal(2);
    expect(countConflictMarkerBlocks('<Flow>\n</Flow>\n')).to.equal(0);
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
