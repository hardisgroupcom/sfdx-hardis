/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  buildBackpromoteMergePrompt,
  buildBackpromoteRunCommand,
  classifyBackpromoteCurrentBranch,
  countConflictMarkerBlocks,
  findBackpromoteParentBranchRefusal,
  findBackpromoteTargetOrgRefusal,
  guessBackpromoteParentBranch,
  itemsOfFile,
  metadataKeysToPackageContent,
  packageContentToMetadataKeys,
  parseConflictDecisions,
  parseMetadataKey,
  parseSandboxOfUsername,
  predictConflictingFiles,
  splitListFlag,
  splitMetadataKeysFlag,
} from '../../../src/common/utils/backpromoteRules.js';

describe('backpromote keys and flags', () => {
  it('splits Type:Name on the first colon, keeping spaces and colons of the name', () => {
    expect(parseMetadataKey('Layout:Opportunity-Sales Layout')).to.deep.equal({ type: 'Layout', name: 'Opportunity-Sales Layout' });
    expect(parseMetadataKey('CustomLabel:A:B')).to.deep.equal({ type: 'CustomLabel', name: 'A:B' });
    expect(parseMetadataKey('Layout')).to.be.null;
    expect(parseMetadataKey(':Name')).to.be.null;
    expect(parseMetadataKey('Layout:')).to.be.null;
  });

  it('reads list flags given comma separated or repeated', () => {
    expect(splitListFlag('load-data, assign-ps,,x')).to.deep.equal(['load-data', 'assign-ps', 'x']);
    expect(splitListFlag(['a', 'b,c'])).to.deep.equal(['a', 'b', 'c']);
    expect(splitListFlag(undefined)).to.deep.equal([]);
  });

  it('splits a Type:Name list only where the next item starts, so names keep their commas', () => {
    expect(splitMetadataKeysFlag(['Flow:Quote_Approval,ApexClass:InvoiceCalculator'])).to.deep.equal(['Flow:Quote_Approval', 'ApexClass:InvoiceCalculator']);
    expect(splitMetadataKeysFlag(['Layout:Account, Main Layout'])).to.deep.equal(['Layout:Account, Main Layout']);
    expect(splitMetadataKeysFlag(['Flow:A', 'Flow:A'])).to.deep.equal(['Flow:A']);
  });

  it('builds package.xml content sorted by member, and reads it back', () => {
    const content = metadataKeysToPackageContent(['Flow:B', 'ApexClass:Z', 'Flow:A', 'Flow:A', 'invalid']);
    expect(content).to.deep.equal({ Flow: ['A', 'B'], ApexClass: ['Z'] });
    expect(packageContentToMetadataKeys(content)).to.deep.equal(['Flow:A', 'Flow:B', 'ApexClass:Z']);
  });

  it('reads the conflict decisions of --on-conflict, whatever the path separators', () => {
    const { decisions, invalid } = parseConflictDecisions([
      'force-app/main/default/classes/A.cls=overwrite',
      'force-app\\main\\default\\flows\\Q.flow-meta.xml=Keep',
      'force-app/main/default/reports/a=b/R.report-meta.xml=merge',
      'force-app/main/default/classes/B.cls=deploy',
      'nothing',
    ]);
    expect([...decisions.entries()]).to.deep.equal([
      ['force-app/main/default/classes/A.cls', 'overwrite'],
      ['force-app/main/default/flows/Q.flow-meta.xml', 'keep'],
      ['force-app/main/default/reports/a=b/R.report-meta.xml', 'merge'],
    ]);
    expect(invalid).to.deep.equal(['force-app/main/default/classes/B.cls=deploy', 'nothing']);
  });
});

describe('backpromote branches', () => {
  const majorBranches = ['integration', 'uat', 'preprod', 'main'];

  it('only lets a User Story branch receive a backpromote', () => {
    expect(classifyBackpromoteCurrentBranch('feature/MKTCRMHG-1016-business-model', majorBranches)).to.equal('userStoryBranch');
    expect(classifyBackpromoteCurrentBranch('integration', majorBranches)).to.equal('majorBranch');
    expect(classifyBackpromoteCurrentBranch('promotion/integration/uat/2026-09-11-0859', majorBranches)).to.equal('promotionBranch');
    expect(classifyBackpromoteCurrentBranch('retrofit/from-main', majorBranches)).to.equal('retrofitBranch');
    // Only named like a promotion or retrofit branch
    expect(classifyBackpromoteCurrentBranch('promotion/fix-labels', majorBranches)).to.equal('userStoryBranch');
    expect(classifyBackpromoteCurrentBranch('retrofitting-legacy', majorBranches)).to.equal('userStoryBranch');
  });

  it('refuses a parent branch that is not a major branch, unless the project declares none', () => {
    expect(findBackpromoteParentBranchRefusal('integration', majorBranches)).to.be.null;
    expect(findBackpromoteParentBranchRefusal('feature/E2E-105-apex', majorBranches)).to.deep.equal({ majorBranches });
    expect(findBackpromoteParentBranchRefusal('develop', [])).to.be.null;
  });

  it('guesses the parent branch from where the User Story was created', () => {
    const guess = (currentBranch: string, originBranch: string | null = null) =>
      guessBackpromoteParentBranch({ currentBranch, originBranch, majorBranches, developmentBranch: 'integration' });
    expect(guess('feature/MKTCRMHG-948-order-id', 'uat')).to.equal('uat');
    expect(guess('promotion/integration/uat/2026-09-11-0859')).to.equal('integration');
    expect(guess('promotion/hotfix/uat/2026-09-11-0859')).to.equal('uat');
    expect(guess('feature/no-origin')).to.equal('integration');
  });
});

describe('findBackpromoteTargetOrgRefusal()', () => {
  const majorOrgs = [
    { branchName: 'uat', targetUsername: 'deploy@mycompany.com.uat', instanceUrl: 'https://mycompany--uat.sandbox.my.salesforce.com' },
    { branchName: 'integration', targetUsername: 'deploy@mycompany.com.integ', instanceUrl: 'https://test.salesforce.com' },
  ];

  it('accepts a developer sandbox and a scratch org', () => {
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'sam@mycompany.com.dev', instanceUrl: 'https://mycompany--dev.sandbox.my.salesforce.com', majorOrgs })).to.be.null;
  });

  it('refuses a production org', () => {
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: false, username: 'admin@mycompany.com', instanceUrl: 'https://mycompany.my.salesforce.com', majorOrgs })).to.deep.equal({ reason: 'production' });
  });

  it('refuses the org of a major branch, by username, by instance URL, or by the sandbox of the username', () => {
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'DEPLOY@mycompany.com.uat', instanceUrl: 'https://other.sandbox.my.salesforce.com', majorOrgs })).to.deep.equal({ reason: 'majorOrg', branchName: 'uat' });
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'sam@mycompany.com.uat', instanceUrl: 'https://mycompany--uat.sandbox.my.salesforce.com/', majorOrgs })).to.deep.equal({ reason: 'majorOrg', branchName: 'uat' });
    // The config of the integ sandbox carries the generic login URL: the username is the only evidence
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'sam@mycompany.com.integ', instanceUrl: 'https://mycompany--integ.sandbox.my.salesforce.com', majorOrgs })).to.deep.equal({ reason: 'majorOrg', branchName: 'integration' });
  });

  it('never matches a major org on the generic test.salesforce.com login URL', () => {
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'sam@mycompany.com.dev', instanceUrl: 'https://test.salesforce.com', majorOrgs })).to.be.null;
    expect(parseSandboxOfUsername('deploy@mycompany.com.uat')).to.deep.equal({ base: 'mycompany.com', sandbox: 'uat' });
    expect(parseSandboxOfUsername('admin@mycompany.com')).to.be.null;
  });
});

describe('backpromote conflicts', () => {
  it('counts the conflict blocks left in a file, even half removed', () => {
    const content = ['<a>', '<<<<<<< HEAD', 'x', '=======', 'z', '>>>>>>> origin/integration', '<<<<<<< HEAD', '=======', '>>>>>>> origin/integration'].join('\r\n');
    expect(countConflictMarkerBlocks(content)).to.equal(2);
    expect(countConflictMarkerBlocks('<Flow>\n</Flow>\n')).to.equal(0);
    expect(countConflictMarkerBlocks(['<a>', '  <label>org</label>', '=======', '  <label>integration</label>', '>>>>>>> origin/integration'].join('\n'))).to.equal(1);
    expect(countConflictMarkerBlocks('<<<<<<<< eight is not a marker\n')).to.equal(0);
  });

  it('predicts the files the merge may stop on: changed in the parent branch and in the branch or the org', () => {
    const predicted = predictConflictingFiles({
      parentChangedFiles: ['force-app/main/default/classes/A.cls', 'force-app/main/default/lwc/card/card.js', 'force-app/main/default/flows/F.flow-meta.xml'],
      branchChangedFiles: ['force-app/main/default/classes/A.cls', 'force-app/main/default/classes/Other.cls'],
      // The org preview names the bundle by its folder
      orgChangedFiles: ['force-app/main/default/lwc/card'],
    });
    expect(predicted).to.deep.equal([
      { path: 'force-app/main/default/classes/A.cls', changedInBranch: true, changedInOrg: false },
      { path: 'force-app/main/default/lwc/card/card.js', changedInBranch: false, changedInOrg: true },
    ]);
  });

  it('finds the items a conflicting file belongs to, including bundles', () => {
    const itemPaths = new Map<string, string | null>([
      ['ApexClass:A', 'force-app/main/default/classes/A.cls'],
      ['LightningComponentBundle:card', 'force-app/main/default/lwc/card/card.js-meta.xml'],
      ['Flow:F', null],
    ]);
    expect(itemsOfFile('force-app/main/default/classes/A.cls', itemPaths)).to.deep.equal(['ApexClass:A']);
    expect(itemsOfFile('force-app/main/default/lwc/card/card.js', itemPaths)).to.deep.equal(['LightningComponentBundle:card']);
    expect(itemsOfFile('force-app/main/default/classes/A.cls-meta.xml', itemPaths)).to.deep.equal([]);
  });
});

describe('backpromote command and prompt', () => {
  it('builds the run command of the panel decisions, quoting what needs it', () => {
    const command = buildBackpromoteRunCommand({
      parentBranch: 'integration',
      excludeMetadata: ['Layout:Opportunity-Sales Layout', 'Report:unfiled$public/Pipeline by stage'],
      conflictDecisions: new Map([['force-app/main/default/classes/A.cls', 'overwrite']]),
      actions: ['load-matrix'],
      targetUsername: 'sam@mycompany.com.dev',
    });
    expect(command).to.equal(
      'sf hardis:work:backpromote --parentbranch integration --auto --exclude-metadata "Layout:Opportunity-Sales Layout"' +
      " --exclude-metadata 'Report:unfiled$public/Pipeline by stage' --on-conflict force-app/main/default/classes/A.cls=overwrite" +
      ' --actions load-matrix --target-org sam@mycompany.com.dev'
    );
    expect(buildBackpromoteRunCommand({ parentBranch: 'integration', skipActions: true, skipDestructive: true, noPull: true })).to.equal(
      'sf hardis:work:backpromote --parentbranch integration --auto --skip-destructive --skip-actions --no-pull'
    );
  });

  it('gives the coding agent the files, the two sides, the Pull Requests and the next command', () => {
    const prompt = buildBackpromoteMergePrompt({
      parentBranch: 'integration',
      currentBranch: 'feature/CRM-1432',
      orgLabel: 'mycompany--dev-sam',
      files: [{ path: 'force-app/main/default/flows/Quote_Approval.flow-meta.xml', conflictBlocks: 2 }],
      pullRequests: [{ id: 482, title: 'Quote approval process', webUrl: 'https://github.com/acme/crm/pull/482' }],
      nextCommand: 'sf hardis:work:backpromote --parentbranch integration --auto',
    });
    expect(prompt).to.contain('`force-app/main/default/flows/Quote_Approval.flow-meta.xml`: 2 conflict block(s)');
    expect(prompt).to.contain('<<<<<<< HEAD');
    expect(prompt).to.contain('>>>>>>> origin/integration');
    expect(prompt).to.contain('#482 Quote approval process (https://github.com/acme/crm/pull/482)');
    expect(prompt).to.contain('Do not commit, do not push and do not deploy');
    expect(prompt).to.contain('sf hardis:work:backpromote --parentbranch integration --auto');
  });
});
