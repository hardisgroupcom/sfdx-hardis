/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  buildBackpromoteBranchName,
  buildBackpromoteMergePrompt,
  buildBackpromoteRunCommand,
  buildTwoWayMergeWithMarkers,
  classifyBackpromoteCurrentBranch,
  countConflictMarkerBlocks,
  countDifferingLines,
  deriveSandboxName,
  filterNoOverwriteKeys,
  findBackpromoteParentBranchRefusal,
  findBackpromoteTargetOrgRefusal,
  isBinaryMetadataFile,
  itemsOfFile,
  listAllowedBackpromoteParentBranches,
  metadataKeysToPackageContent,
  packageContentToMetadataKeys,
  parseBackpromoteBranchName,
  parseDiffDecisions,
  parseMetadataKey,
  parseSandboxOfUsername,
  sameFileContent,
  sourcePathTail,
  splitListFlag,
  splitMetadataKeysFlag,
  walkBackpromoteHistory,
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

  it('reads the decisions of --on-diff, whatever the path separators', () => {
    const { decisions, invalid } = parseDiffDecisions([
      'force-app/main/default/classes/A.cls=git',
      'force-app\\main\\default\\flows\\Q.flow-meta.xml=Org',
      'force-app/main/default/reports/a=b/R.report-meta.xml=merge',
      'force-app/main/default/classes/B.cls=overwrite',
      'nothing',
    ]);
    expect([...decisions.entries()]).to.deep.equal([
      ['force-app/main/default/classes/A.cls', 'git'],
      ['force-app/main/default/flows/Q.flow-meta.xml', 'org'],
      ['force-app/main/default/reports/a=b/R.report-meta.xml', 'merge'],
    ]);
    expect(invalid).to.deep.equal(['force-app/main/default/classes/B.cls=overwrite', 'nothing']);
  });

  it('holds back the items of package-no-overwrite.xml, by name or by wildcard', () => {
    const noOverwrite = { Profile: ['*'], Layout: ['Account-Account Layout'] };
    expect(filterNoOverwriteKeys(['Profile:Admin', 'Layout:Account-Account Layout', 'Layout:Case-Case Layout', 'ApexClass:A'], noOverwrite)).to.deep.equal(['Profile:Admin', 'Layout:Account-Account Layout']);
    expect(filterNoOverwriteKeys(['Profile:Admin'], null)).to.deep.equal([]);
  });
});

describe('backpromote branches', () => {
  it('names the backpromote branch after the parent branch and the sandbox, and reads it back', () => {
    expect(buildBackpromoteBranchName('integration', 'dev1')).to.equal('backpromote/integration/dev1');
    expect(parseBackpromoteBranchName('backpromote/integration/dev1')).to.deep.equal({ parentBranch: 'integration', sandboxName: 'dev1' });
    // The parent branch may hold slashes: the sandbox name is always the last segment
    expect(parseBackpromoteBranchName('backpromote/release/2026.09/dev-sam')).to.deep.equal({ parentBranch: 'release/2026.09', sandboxName: 'dev-sam' });
    expect(parseBackpromoteBranchName('backpromote/dev1')).to.be.null;
    expect(parseBackpromoteBranchName('feature/backpromote/x')).to.be.null;
  });

  it('classifies the technical branches the pipeline ignores', () => {
    const majorBranches = ['integration', 'uat', 'preprod', 'main'];
    expect(classifyBackpromoteCurrentBranch('feature/MKTCRMHG-1016-business-model', majorBranches)).to.equal('userStoryBranch');
    expect(classifyBackpromoteCurrentBranch('integration', majorBranches)).to.equal('majorBranch');
    expect(classifyBackpromoteCurrentBranch('promotion/integration/uat/2026-09-11-0859', majorBranches)).to.equal('promotionBranch');
    expect(classifyBackpromoteCurrentBranch('retrofit/from-main', majorBranches)).to.equal('retrofitBranch');
    expect(classifyBackpromoteCurrentBranch('backpromote/integration/dev1', majorBranches)).to.equal('backpromoteBranch');
    expect(classifyBackpromoteCurrentBranch('promotion/fix-labels', majorBranches)).to.equal('userStoryBranch');
  });

  it('only allows the development branch and availableTargetBranches as parent branches', () => {
    const allowed = listAllowedBackpromoteParentBranches({ developmentBranch: 'integration', availableTargetBranches: ['integration', 'uat', ' ', 'preprod'] });
    expect(allowed).to.deep.equal(['integration', 'uat', 'preprod']);
    expect(findBackpromoteParentBranchRefusal('uat', allowed)).to.be.null;
    expect(findBackpromoteParentBranchRefusal('main', allowed)).to.deep.equal({ allowedBranches: allowed });
    expect(listAllowedBackpromoteParentBranches({ developmentBranch: 'integration' })).to.deep.equal(['integration']);
    expect(listAllowedBackpromoteParentBranches(null)).to.deep.equal([]);
  });
});

describe('backpromote target org', () => {
  const majorOrgs = [
    { branchName: 'uat', targetUsername: 'deploy@mycompany.com.uat', instanceUrl: 'https://mycompany--uat.sandbox.my.salesforce.com' },
    { branchName: 'integration', targetUsername: 'deploy@mycompany.com.integ', instanceUrl: 'https://test.salesforce.com' },
  ];

  it('accepts a developer sandbox and a scratch org, refuses production and the major orgs', () => {
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'sam@mycompany.com.dev', instanceUrl: 'https://mycompany--dev.sandbox.my.salesforce.com', majorOrgs })).to.be.null;
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: false, username: 'admin@mycompany.com', instanceUrl: 'https://mycompany.my.salesforce.com', majorOrgs })).to.deep.equal({ reason: 'production' });
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'DEPLOY@mycompany.com.uat', instanceUrl: 'https://other.sandbox.my.salesforce.com', majorOrgs })).to.deep.equal({ reason: 'majorOrg', branchName: 'uat' });
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'sam@mycompany.com.uat', instanceUrl: 'https://mycompany--uat.sandbox.my.salesforce.com/', majorOrgs })).to.deep.equal({ reason: 'majorOrg', branchName: 'uat' });
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'sam@mycompany.com.integ', instanceUrl: 'https://mycompany--integ.sandbox.my.salesforce.com', majorOrgs })).to.deep.equal({ reason: 'majorOrg', branchName: 'integration' });
    expect(findBackpromoteTargetOrgRefusal({ isSandbox: true, username: 'sam@mycompany.com.dev', instanceUrl: 'https://test.salesforce.com', majorOrgs })).to.be.null;
    expect(parseSandboxOfUsername('deploy@mycompany.com.uat')).to.deep.equal({ base: 'mycompany.com', sandbox: 'uat' });
    expect(parseSandboxOfUsername('admin@mycompany.com')).to.be.null;
  });

  it('derives the sandbox name from the instance URL, then the username, then the org id', () => {
    expect(deriveSandboxName({ instanceUrl: 'https://mycompany--Dev1.sandbox.my.salesforce.com', username: 'sam@mycompany.com.dev1', orgId: '00D1' })).to.equal('dev1');
    expect(deriveSandboxName({ instanceUrl: 'https://test.salesforce.com', username: 'sam@mycompany.com.devsam', orgId: '00D1' })).to.equal('devsam');
    expect(deriveSandboxName({ instanceUrl: 'https://ability-app-1234.scratch.my.salesforce.com', username: 'test-abc@example.com', orgId: '00D5j000000ABCDEAA' })).to.equal('00d5j000000abcdeaa');
    expect(deriveSandboxName({ instanceUrl: 'https://mycompany--dev1.sandbox.my.salesforce.com', username: 'x', orgId: 'y', override: 'Sam Box' })).to.equal('sam-box');
  });
});

describe('backpromote history walk', () => {
  const row = (sandboxName: string, orgId: string) => ({ sandboxName, orgId });

  it('stops at the first Pull Request holding a row for this sandbox and org id, and starts right after it', () => {
    const walk = walkBackpromoteHistory(
      [
        { pullRequestNumbers: [418], rows: [] },
        { pullRequestNumbers: [417], rows: [row('dev2', '00D2')] },
        { pullRequestNumbers: [415], rows: [row('dev1', '00D1')] },
        { pullRequestNumbers: [412], rows: [row('dev1', '00D1')] },
      ],
      'dev1',
      '00D1',
    );
    expect(walk.foundIndex).to.equal(2);
    expect(walk.defaultStartIndex).to.equal(1);
    expect(walk.verdicts.map((verdict) => verdict.row !== null)).to.deep.equal([false, false, true, true]);
  });

  it('treats a row with another org id as before the refresh, and finds nothing when no row matches', () => {
    const walk = walkBackpromoteHistory(
      [
        { pullRequestNumbers: [418], rows: [row('dev1', '00Dold')] },
        { pullRequestNumbers: [417], rows: [] },
      ],
      'dev1',
      '00Dnew',
    );
    expect(walk.foundIndex).to.equal(-1);
    expect(walk.defaultStartIndex).to.be.null;
    expect(walk.verdicts[0]).to.deep.equal({ row: null, beforeRefresh: true });
  });

  it('pre-selects nothing when the newest Pull Request is already backpromoted', () => {
    const walk = walkBackpromoteHistory([{ pullRequestNumbers: [418], rows: [row('dev1', '00D1')] }], 'dev1', '00D1');
    expect(walk.foundIndex).to.equal(0);
    expect(walk.defaultStartIndex).to.be.null;
  });
});

describe('backpromote merges and comparison', () => {
  it('counts the conflict blocks left in a file, even half removed', () => {
    const content = ['<a>', '<<<<<<< sandbox', 'x', '=======', 'z', '>>>>>>> integration', '<<<<<<< sandbox', '=======', '>>>>>>> integration'].join('\r\n');
    expect(countConflictMarkerBlocks(content)).to.equal(2);
    expect(countConflictMarkerBlocks('<Flow>\n</Flow>\n')).to.equal(0);
    expect(countConflictMarkerBlocks(['<a>', '  <label>org</label>', '=======', '  <label>integration</label>', '>>>>>>> integration'].join('\n'))).to.equal(1);
    expect(countConflictMarkerBlocks('<<<<<<<< eight is not a marker\n')).to.equal(0);
  });

  it('writes a two-way merge with markers around every differing block only', () => {
    const sandbox = '<Layout>\n  <a/>\n  <fromOrg/>\n  <z/>\n</Layout>\n';
    const parent = '<Layout>\n  <a/>\n  <fromGit/>\n  <z/>\n  <tail/>\n</Layout>\n';
    const merged = buildTwoWayMergeWithMarkers(sandbox, parent, { sandbox: 'sandbox dev1', parent: 'integration' });
    expect(merged.conflictBlocks).to.equal(2);
    expect(merged.content).to.equal(
      '<Layout>\n  <a/>\n<<<<<<< sandbox dev1\n  <fromOrg/>\n=======\n  <fromGit/>\n>>>>>>> integration\n  <z/>\n<<<<<<< sandbox dev1\n=======\n  <tail/>\n>>>>>>> integration\n</Layout>\n'
    );
    expect(countConflictMarkerBlocks(merged.content)).to.equal(2);
    expect(buildTwoWayMergeWithMarkers('same\n', 'same\n', { sandbox: 's', parent: 'p' })).to.deep.equal({ content: 'same\n', conflictBlocks: 0 });
  });

  it('compares contents ignoring line endings and trailing blank lines, and counts the differing lines', () => {
    expect(sameFileContent('a\r\nb\r\n', 'a\nb')).to.be.true;
    expect(sameFileContent('a\nb\n', 'a\nc\n')).to.be.false;
    expect(countDifferingLines('a\nb\nc\n', 'a\nx\ny\nc\n')).to.equal(3);
    expect(isBinaryMetadataFile('force-app/main/default/staticresources/Lib.zip')).to.be.true;
    expect(isBinaryMetadataFile('force-app/main/default/staticresources/Lib.resource-meta.xml')).to.be.false;
  });

  it('matches a repository file with its retrieved copy by the tail after main/default', () => {
    expect(sourcePathTail('force-app/main/default/classes/A.cls')).to.equal('classes/A.cls');
    expect(sourcePathTail('main/default/classes/A.cls')).to.equal('classes/A.cls');
    expect(sourcePathTail('classes/A.cls')).to.equal('classes/A.cls');
    expect(sourcePathTail('my-pkg/classes/A.cls', ['my-pkg'])).to.equal('classes/A.cls');
  });

  it('finds the items a file belongs to, including bundles', () => {
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
  it('builds the run command of the decisions, quoting what needs it', () => {
    const command = buildBackpromoteRunCommand({
      mode: 'auto',
      parentBranch: 'integration',
      targetOrg: 'dev1',
      fromPullRequest: 412,
      runId: '7f3a',
      excludeMetadata: ['Layout:Opportunity-Sales Layout', 'Report:unfiled$public/Pipeline by stage'],
      diffDecisions: new Map([['force-app/main/default/classes/A.cls', 'merge']]),
      diffDefault: 'org',
      actions: ['load-matrix'],
      json: true,
    });
    expect(command).to.equal(
      'sf hardis:work:backpromote --auto --target-org dev1 --parent-branch integration --from-pull-request 412 --run-id 7f3a' +
      ' --exclude-metadata "Layout:Opportunity-Sales Layout"' +
      " --exclude-metadata 'Report:unfiled$public/Pipeline by stage' --on-diff force-app/main/default/classes/A.cls=merge" +
      ' --on-diff-default org --actions load-matrix --json'
    );
    expect(buildBackpromoteRunCommand({ mode: 'agent', parentBranch: 'integration', skipActions: true, skipDestructive: true, diffDefault: 'git', confirmActions: ['step-1'] })).to.equal(
      'sf hardis:work:backpromote --agent --parent-branch integration --skip-destructive --skip-actions --confirm-action step-1'
    );
  });

  it('gives the coding agent every prepared file, its versions, the Pull Requests and the next command', () => {
    const prompt = buildBackpromoteMergePrompt({
      parentBranch: 'integration',
      backpromoteBranch: 'backpromote/integration/dev1',
      sandboxName: 'dev1',
      files: [
        {
          path: 'force-app/main/default/flows/Quote_Approval.flow-meta.xml',
          absolutePath: 'C:/git/crm/force-app/main/default/flows/Quote_Approval.flow-meta.xml',
          conflictBlocks: 2,
          versions: { base: 'C:/tmp/base/flows/Quote_Approval.flow-meta.xml', sandbox: 'C:/tmp/org/flows/Quote_Approval.flow-meta.xml', parentHead: 'C:/tmp/git/flows/Quote_Approval.flow-meta.xml' },
          pullRequests: [482],
        },
        { path: 'force-app/main/default/classes/A.cls', absolutePath: 'C:/git/crm/force-app/main/default/classes/A.cls', conflictBlocks: 1, versions: { base: null, sandbox: 'C:/tmp/org/classes/A.cls', parentHead: 'C:/tmp/git/classes/A.cls' }, pullRequests: [] },
      ],
      pullRequests: [{ id: 482, title: 'Quote approval process', webUrl: 'https://github.com/acme/crm/pull/482' }],
      nextCommand: 'sf hardis:work:backpromote --auto --run-id 7f3a',
      agentMode: false,
    });
    expect(prompt).to.contain('`force-app/main/default/flows/Quote_Approval.flow-meta.xml` (2 conflict block(s))');
    expect(prompt).to.contain('common base');
    expect(prompt).to.contain('`force-app/main/default/classes/A.cls` (1 conflict block(s))');
    expect(prompt).to.contain('changed in integration by the Pull Request(s) #482');
    expect(prompt).to.contain('backpromote/integration/dev1');
    expect(prompt).to.contain('#482 Quote approval process (https://github.com/acme/crm/pull/482)');
    expect(prompt).to.contain('Do not commit, do not push and do not deploy');
    expect(prompt).to.contain('sf hardis:work:backpromote --auto --run-id 7f3a');
  });
});
