import { expect } from 'chai';
import type { PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';
import type { PullRequestData } from '../../../src/common/gitProvider/index.js';
import { buildDeploymentPrCommentSections, humanActionReason } from '../../../src/common/gitProvider/prCommentLayout.js';
import { formatShortDate } from '../../../src/common/gitProvider/prCommentDates.js';
import { parseManualActionCheckboxes } from '../../../src/common/utils/deploymentActionsStateUtils.js';
import { fitPrCommentSections } from '../../../src/common/gitProvider/prCommentSizeGuard.js';

function command(overrides: Partial<PrePostCommand>): PrePostCommand {
  return {
    id: 'action-1',
    label: 'Load reference data',
    type: 'command',
    command: 'echo ok',
    context: 'all',
    ...overrides,
  } as PrePostCommand;
}

function render(prData: Partial<PullRequestData>, checkOnly: boolean, extra: Record<string, any> = {}): string {
  return buildDeploymentPrCommentSections(prData, { checkOnly, targetBranch: 'integration', prNumber: 12, ...extra })
    .map((section) => section.markdown)
    .join('\n\n');
}

describe('Pull Request comment layout', () => {
  it('opens a successful validation on its verdict and a table of checks', () => {
    const body = render(
      {
        status: 'valid',
        deployStatus: 'valid',
        deploymentMetrics: { deployed: 3, created: 0, updated: 1, deleted: 0, unchanged: 2 },
        coverage: { value: 90.26, target: 80, status: 'valid' },
        testClasses: ['AccountServiceTest', 'InvoiceTest'],
      },
      true,
      { quickDeployReusable: true }
    );
    expect(body.startsWith('### ✅ Ready to merge into `integration`')).to.be.true;
    expect(body).to.contain('| Check | Result |');
    expect(body).to.contain('| Metadata | ✅ 1 component would change (1 updated), 3 validated |');
    expect(body).to.contain('| Apex tests | ✅ Coverage 90.26% (target 80%) · 2 test classes |');
    expect(body).to.contain('| Quick Deploy | ✅ The merge job can reuse this validation');
    expect(body).to.contain('<summary>🧪 Apex test classes (2)</summary>');
    // No link inside a summary, no emoji shortcode
    for (const summary of body.match(/<summary>.*<\/summary>/g) || []) {
      expect(summary).to.not.match(/\]\(/);
    }
    expect(body).to.not.match(/:[a-z_]+:/);
  });

  it('says the metadata was deployed when only a post-deployment action failed', () => {
    const body = render(
      {
        status: 'invalid',
        deployStatus: 'valid',
        deploymentMetrics: { deployed: 4, created: 1, updated: 3, deleted: 0, unchanged: 0 },
        metadataOutcome: 'deployed',
        testsNotRunReason: 'smart-tests',
        postDeployActions: {
          orgBranch: 'integration',
          commands: [
            command({ id: 'flaky', label: 'E2E flaky post-deploy', result: { statusCode: 'failed', output: 'Command failed: node flaky.cjs' } }),
            command({ id: 'after', label: 'E2E after the flaky one', result: { statusCode: 'not-run', skippedCode: 'stopped-by-failure', stoppedByLabel: 'E2E flaky post-deploy' } }),
            command({ id: 'gate', label: 'E2E gate', type: 'manual', result: { statusCode: 'skipped', skippedCode: 'already-run-in-org', skippedReason: 'runOnlyOnceByOrg: already run in org (integration) on 2026-10-07T00:57:37.640Z' } }),
          ],
        },
      },
      false
    );
    expect(body).to.contain('### ❌ Deployed to `integration`, but an action failed after the deployment');
    expect(body).to.contain('The org has the new metadata.');
    expect(body).to.contain('| Metadata | ✅ Deployed: 4 components changed (1 created, 3 updated) |');
    expect(body).to.contain('| Apex tests | ⚪ Not needed');
    expect(body).to.contain('| Deployment actions | ❌ 1 failed · ⏸️ 1 not run · ⚪ 1 skipped |');
    expect(body).to.contain('#### ❌ Failed action');
    expect(body).to.contain('Command failed: node flaky.cjs');
    expect(body).to.contain('#### ⏸️ Not run, waiting for the failed action');
    expect(body).to.contain('Already done in integration on Oct 7');
    expect(body).to.not.contain('runOnlyOnceByOrg');
  });

  it('says the metadata was not deployed when the deployment failed', () => {
    const body = render(
      {
        status: 'invalid',
        deployStatus: 'invalid',
        errorCount: 2,
        deployErrorsMarkdownBody: '## Deployment errors\n\n🔨 ApexClass Foo: Variable does not exist: IndustryCode',
      },
      true
    );
    expect(body).to.contain('### ❌ Cannot merge into `integration`: 2 deployment errors');
    expect(body).to.contain('#### ❌ Deployment errors');
    expect(body).to.contain('| Metadata | ❌ 2 errors: nothing was validated |');
    expect(body).to.contain('| Apex tests | ⚪ Not run: the deployment failed first |');
    expect(body).to.not.contain('## Deployment errors');
  });

  it('lists manual actions as checkboxes the next job reads back', () => {
    const body = render(
      {
        status: 'valid',
        preDeployActions: {
          orgBranch: 'integration',
          commands: [
            command({ id: 'setup', label: 'Activate the feature', type: 'manual', when: 'pre-deploy', parameters: { instructions: '1. Open Setup\n2. Click <Activate>' }, pullRequest: { idNumber: 12, idStr: '12', webUrl: 'https://x/12' } as any, result: { statusCode: 'manual' } }),
          ],
        },
      },
      true
    );
    expect(body).to.contain('#### 👋 To do by hand in `integration` before the deployment');
    expect(body).to.contain('  > 2. Click &lt;Activate>');
    const items = parseManualActionCheckboxes(body);
    expect(items).to.have.length(1);
    expect(items[0]).to.include({ actionId: 'setup', orgBranch: 'integration', prNumber: 12, checked: false, kind: 'manual' });
    // The Pull Request being read is not linked again
    expect(body).to.not.contain('https://x/12');
  });

  it('lists tickets and carried Pull Requests one per line, never the commits', () => {
    const body = render(
      {
        status: 'valid',
        tickets: [{ provider: 'JIRA', id: 'PROJ-1', url: 'https://jira/PROJ-1', subject: 'Invoice reminder', foundOnServer: true }],
        pullRequestsInScope: [
          { idStr: '12', idNumber: 12, title: 'This one' },
          { idStr: '7', idNumber: 7, title: 'Carried', webUrl: 'https://x/7', authorName: 'Mariia' },
        ],
      },
      true
    );
    expect(body).to.contain('<summary>🎫 1 ticket · 1 Pull Request</summary>');
    expect(body).to.contain('- [PROJ-1](https://jira/PROJ-1) Invoice reminder');
    expect(body).to.contain('- [#7](https://x/7) Carried, by Mariia');
    expect(body).to.not.contain('This one');
  });

  it('names status-only Flows on one line', () => {
    const body = render(
      {
        status: 'valid',
        flowChanges: [
          { name: 'Invoice_Flow', kind: 'diff' },
          { name: 'Legal_Email', kind: 'status-only', statusBefore: 'Active', statusAfter: 'Obsolete' },
        ],
      },
      true
    );
    expect(body).to.contain('🔀 1 changed: Invoice_Flow (one comment per Flow below)');
    expect(body).to.contain('Legal_Email: status only, Active → Obsolete');
    expect(body).to.not.contain('](#');
  });

  it('says the metadata is in the org when only the coverage check failed after the deployment', () => {
    const body = render(
      {
        status: 'invalid',
        deployStatus: 'invalid',
        metadataOutcome: 'deployed',
        coverage: { value: 78, target: 80, status: 'invalid' },
      },
      false
    );
    expect(body).to.contain('### ❌ Deployed to `integration`, but code coverage 78% is under the 80% target');
    expect(body).to.contain('| Metadata | ✅ Deployed |');
    expect(body).to.not.contain('is not in the org');
  });

  it('says nothing was deployed when there was no metadata and an action failed', () => {
    const body = render(
      {
        status: 'invalid',
        metadataOutcome: 'nothing-to-deploy',
        postDeployActions: { orgBranch: 'integration', commands: [command({ result: { statusCode: 'failed' } })] },
      },
      false
    );
    expect(body).to.contain('### ❌ Nothing to deploy to `integration`, but a post-deployment action failed');
  });

  it('shows how to fix a draft deployment actions file', () => {
    const body = render(
      {
        status: 'invalid',
        title: '❌ Error: Draft deployment actions file found',
        blockingIssueMarkdownBody: '#### ❌ Draft deployment actions file\n\nRename .sfdx-hardis.draft.yml into .sfdx-hardis.12.yml.',
      },
      true
    );
    expect(body).to.contain('### ❌ Cannot merge into `integration`: Draft deployment actions file found');
    expect(body).to.contain('Rename .sfdx-hardis.draft.yml into .sfdx-hardis.12.yml.');
  });

  it('keeps the manual actions when hundreds of errors do not fit', () => {
    const errors = Array.from({ length: 300 }, (_, i) => `<details><summary>⛔ Error ${i}</summary>\n\n${'tip '.repeat(60)}\n<details><summary>🤖 AI</summary>\n\nanswer\n</details>\n</details>\n<br/>\n`).join('');
    const sections = buildDeploymentPrCommentSections(
      {
        status: 'invalid',
        errorCount: 300,
        deployErrorsMarkdownBody: `## Deployment errors\n\n${errors}`,
        preDeployActions: {
          orgBranch: 'integration',
          commands: [command({ id: 'gate', label: 'Gate', type: 'manual', when: 'pre-deploy', result: { statusCode: 'manual' } })],
        },
      },
      { checkOnly: true, targetBranch: 'integration', prNumber: 12 }
    );
    const fitted = fitPrCommentSections(sections, 46000, '50,000');
    expect(fitted.markdown.length).to.be.at.most(46000);
    expect(fitted.markdown).to.contain('… and 290 more in the job log');
    expect(parseManualActionCheckboxes(fitted.markdown)).to.have.length(1);
  });

  it('reports a coverage refusal on the Apex tests row, not as a metadata error', () => {
    const body = render(
      {
        status: 'invalid',
        errorCount: 1,
        coverageWarningsCount: 1,
        deployErrorsMarkdownBody: '## Deployment errors\n\n<details><summary>⛔ CmtE2EInvoice - Test coverage of selected Apex Class is 66,667%</summary>\n\ntip\n</details>',
      },
      true
    );
    expect(body).to.contain('### ❌ Cannot merge into `integration`: the Apex code coverage is too low for 1 class');
    expect(body).to.contain('| Metadata | ⚪ No component error: Salesforce refused the validation for the code coverage |');
    expect(body).to.contain('| Apex tests | ❌ Coverage too low for 1 class: see below |');
    expect(body).to.contain('#### ❌ Apex code coverage');
  });

  it('writes skip reasons for people', () => {
    expect(humanActionReason(command({ result: { statusCode: 'skipped', skippedCode: 'context-deployment-only' } }))).to.equal('Runs after the merge only');
    expect(humanActionReason(command({ result: { statusCode: 'skipped', skippedCode: 'branch-not-targeted' } }), 'uat')).to.equal('Not meant for uat');
    expect(formatShortDate('2026-09-12T18:25:32.012Z')).to.equal('Sep 12');
  });
});

describe('Deployment Actions checkbox lines', () => {
  it('reads the label of old and new checkbox lines the same way', () => {
    const body = [
      '- [ ] <!-- sfdx-hardis-failed-action id:a1 org:integration pr:1 when:post-deploy --> E2E flaky *(org branch: integration)*',
      '- [x] <!-- sfdx-hardis-failed-action id:a2 org:integration pr:1 when:post-deploy --> ⏸️ E2E after *(org branch: integration - waits for a failed action)*',
      '- [ ] <!-- sfdx-hardis-manual-action id:a3 org:uat pr:1 when:post-deploy --> 👋 E2E manual *(org branch: uat - to do by hand)*',
    ].join('\n');
    const items = parseManualActionCheckboxes(body);
    expect(items.map((item) => item.label)).to.deep.equal(['E2E flaky', 'E2E after', 'E2E manual']);
    expect(items[1].checked).to.be.true;
  });
});
