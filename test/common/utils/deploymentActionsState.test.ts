/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  buildDeploymentActionsCommentBody,
  buildManualActionCheckboxMarker,
  checkManualActionCheckboxInBody,
  parseDeploymentActionsCommentBody,
  parseManualActionCheckboxes,
  type DeploymentActionStateEntry,
} from '../../../src/common/utils/deploymentActionsStateUtils.js';

function entry(overrides: Partial<DeploymentActionStateEntry>): DeploymentActionStateEntry {
  return {
    actionId: 'action-1',
    actionLabel: 'Enable the feature',
    orgBranch: 'integration',
    when: 'pre-deploy',
    executionOrder: 0,
    status: 'success',
    jobId: '1234',
    jobUrl: 'https://ci.example.com/1234',
    date: '2026-08-14T05:00:00.000Z',
    output: '',
    ...overrides,
  };
}

describe('Deployment Actions state comment (matrix format)', () => {
  it('round-trips entries through build and parse', () => {
    const entries = [
      entry({}),
      entry({ orgBranch: 'uat', status: 'manual', jobId: '5678', jobUrl: 'https://ci.example.com/5678' }),
      entry({ actionId: 'action-2', actionLabel: 'Publish the community', when: 'post-deploy', executionOrder: 2, status: 'failed' }),
    ];
    const body = buildDeploymentActionsCommentBody(entries, undefined, 42);
    const parsed = parseDeploymentActionsCommentBody(body);

    expect(parsed).to.have.length(3);
    const first = parsed.find((e) => e.actionId === 'action-1' && e.orgBranch === 'integration');
    expect(first).to.exist;
    expect(first!.status).to.equal('success');
    expect(first!.when).to.equal('pre-deploy');
    expect(first!.executionOrder).to.equal(0);
    expect(first!.actionLabel).to.equal('Enable the feature');
    expect(first!.jobId).to.equal('1234');
    expect(first!.jobUrl).to.equal('https://ci.example.com/1234');
    expect(first!.date).to.equal('2026-08-14');

    const manualEntry = parsed.find((e) => e.actionId === 'action-1' && e.orgBranch === 'uat');
    expect(manualEntry).to.exist;
    expect(manualEntry!.status).to.equal('manual');

    const failedEntry = parsed.find((e) => e.actionId === 'action-2');
    expect(failedEntry).to.exist;
    expect(failedEntry!.status).to.equal('failed');
    expect(failedEntry!.when).to.equal('post-deploy');
    expect(failedEntry!.executionOrder).to.equal(2);
  });

  it('shows one column per org branch and a pending manual actions checklist', () => {
    const entries = [
      entry({}),
      entry({ orgBranch: 'uat', status: 'manual' }),
    ];
    const body = buildDeploymentActionsCommentBody(entries, undefined, 42);

    expect(body).to.contain('| Action | When | integration | uat |');
    expect(body).to.contain('### Pending manual actions');
    expect(body).to.contain('- [ ] <!-- sfdx-hardis-manual-action id:action-1 org:uat pr:42 when:pre-deploy -->');
    expect(body).to.contain('*Legend:');
    expect(body).to.contain('*Last updated:');
  });

  it('escapes pipes and newlines in labels and round-trips them intact', () => {
    const entries = [
      entry({ actionLabel: 'Update queue A | queue B\nsecond line', status: 'manual' }),
    ];
    const body = buildDeploymentActionsCommentBody(entries, undefined, 42);

    // No raw pipe or newline may reach the table row or the checklist line
    expect(body).to.contain('Update queue A &#124; queue B second line');
    const reparsed = parseDeploymentActionsCommentBody(body);
    expect(reparsed).to.have.length(1);
    expect(reparsed[0].actionLabel).to.equal('Update queue A | queue B second line');
    expect(reparsed[0].orgBranch).to.equal('integration');
  });

  it('does not fabricate a date from a date-stamped job URL', () => {
    const entries = [
      entry({ date: '', jobUrl: 'https://ci.example.com/builds/2026-08-14/1234' }),
    ];
    const body = buildDeploymentActionsCommentBody(entries, undefined, 42);
    const reparsed = parseDeploymentActionsCommentBody(body);
    expect(reparsed).to.have.length(1);
    expect(reparsed[0].date).to.equal('');
    expect(reparsed[0].jobUrl).to.equal('https://ci.example.com/builds/2026-08-14/1234');
  });

  it('shows the banner in place of the title heading, with the title as alt text', () => {
    const body = buildDeploymentActionsCommentBody([entry({})], undefined, 42);
    expect(body).to.contain('![🛠️ Deployment Actions](');
    expect(body).to.not.contain('## 🛠️ Deployment Actions');
  });

  it('keeps the title heading when banners are disabled', () => {
    process.env.SFDX_HARDIS_PR_COMMENT_BANNERS = 'false';
    try {
      const body = buildDeploymentActionsCommentBody([entry({})], undefined, 42);
      expect(body).to.contain('## 🛠️ Deployment Actions');
      expect(body).to.not.contain('pr-banner-');
    } finally {
      delete process.env.SFDX_HARDIS_PR_COMMENT_BANNERS;
    }
  });

  it('keeps the previous navigation when the process does not know the comment links', () => {
    const previousBody = [
      '<!-- sfdx-hardis deployment-actions-state -->',
      '<!-- sfdx-hardis nav-start -->',
      '[🔍 Validation](https://git.example.com/pr/42#c1) | **🛠️ Actions**',
      '<!-- sfdx-hardis nav-end -->',
      '',
      'old content',
    ].join('\n');
    const body = buildDeploymentActionsCommentBody([entry({})], undefined, 42, previousBody);
    expect(body).to.contain('[🔍 Validation](https://git.example.com/pr/42#c1) | **🛠️ Actions**');
  });

  it('still parses the legacy one-row-per-org format', () => {
    const legacyBody = `<!-- sfdx-hardis deployment-actions-state -->
## Deployment Actions

| Action | Org branch | When | Status | Job |
|--------|------------|------|--------|-----|
| <!-- actionId:legacy-1 order:1 --> Old action | uat_mercury | post-deploy | ✅ success (2026-07-22) | [36720](https://ci.example.com/36720) |
`;
    const parsed = parseDeploymentActionsCommentBody(legacyBody);
    expect(parsed).to.have.length(1);
    expect(parsed[0].actionId).to.equal('legacy-1');
    expect(parsed[0].orgBranch).to.equal('uat_mercury');
    expect(parsed[0].status).to.equal('success');
    expect(parsed[0].date).to.equal('2026-07-22');
    expect(parsed[0].jobId).to.equal('36720');
  });
});

describe('Manual action checkboxes', () => {
  const marker = buildManualActionCheckboxMarker('action-1', 'uat', 42);
  const body = `#### Manual Actions to perform after deployment:

- [ ] ${marker} Create the inbound Email Service ([42](https://git.example.com/pr/42))
- [x] ${buildManualActionCheckboxMarker('action-2', 'uat', 43)} Assign the permission sets
`;

  it('parses ticked and unticked items', () => {
    const items = parseManualActionCheckboxes(body);
    expect(items).to.have.length(2);
    expect(items[0]).to.include({ actionId: 'action-1', orgBranch: 'uat', prNumber: 42, checked: false });
    expect(items[1]).to.include({ actionId: 'action-2', orgBranch: 'uat', prNumber: 43, checked: true });
  });

  it('ticks the right checkbox and reports the change', () => {
    const res = checkManualActionCheckboxInBody(body, 'action-1', 'uat');
    expect(res.changed).to.be.true;
    expect(res.body).to.contain(`- [x] ${marker}`);
    const again = checkManualActionCheckboxInBody(res.body, 'action-1', 'uat');
    expect(again.changed).to.be.false;
  });

  it('ticks a checkbox on a star-bulleted line too', () => {
    const starBody = `* [ ] ${marker} Create the inbound Email Service\n`;
    const res = checkManualActionCheckboxInBody(starBody, 'action-1', 'uat');
    expect(res.changed).to.be.true;
    expect(res.body).to.contain(`* [x] ${marker}`);
  });

  it('does not touch checkboxes of another org branch', () => {
    const res = checkManualActionCheckboxInBody(body, 'action-1', 'integration');
    expect(res.changed).to.be.false;
    expect(res.body).to.equal(body);
  });

  it('round-trips an action id containing whitespace', () => {
    const spacedId = 'enable feature X';
    const spacedMarker = buildManualActionCheckboxMarker(spacedId, 'uat', 42);
    const spacedBody = `- [x] ${spacedMarker} Enable feature X\n`;
    const items = parseManualActionCheckboxes(spacedBody);
    expect(items).to.have.length(1);
    expect(items[0]).to.include({ actionId: spacedId, orgBranch: 'uat', prNumber: 42, checked: true });
    const untickedBody = `- [ ] ${spacedMarker} Enable feature X\n`;
    const res = checkManualActionCheckboxInBody(untickedBody, spacedId, 'uat');
    expect(res.changed).to.be.true;
  });
});
