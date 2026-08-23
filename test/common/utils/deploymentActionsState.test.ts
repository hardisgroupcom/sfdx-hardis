/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  buildDeploymentActionsCommentBody,
  buildManualActionCheckboxMarker,
  checkManualActionCheckboxInBody,
  parseDeploymentActionsCommentBody,
  parseManualActionCheckboxes,
  syncManualActionCheckboxes,
  type ActionDef,
  type DeploymentActionStateEntry,
} from '../../../src/common/utils/deploymentActionsStateUtils.js';
import { GitProvider } from '../../../src/common/gitProvider/index.js';

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

  it('round-trips a warning entry (failed, allowed to fail) through build and parse', () => {
    const entries = [entry({ status: 'warning' })];
    const body = buildDeploymentActionsCommentBody(entries, undefined, 42);
    expect(body).to.contain('⚠️');
    expect(body).to.contain('⚠️ warning (failed, allowed to fail)');

    const parsed = parseDeploymentActionsCommentBody(body);
    expect(parsed).to.have.length(1);
    expect(parsed[0].status).to.equal('warning');
  });

  // A failure allowed to fail did not block the deployment: the comment must not turn red
  it('does not show the error banner for a warning entry', () => {
    const warningBody = buildDeploymentActionsCommentBody([entry({ status: 'warning' })], undefined, 42);
    expect(warningBody).to.contain('pr-banner-actions-completed');
    expect(warningBody).to.not.contain('pr-banner-actions-error');

    const failedBody = buildDeploymentActionsCommentBody([entry({ status: 'failed' })], undefined, 42);
    expect(failedBody).to.contain('pr-banner-actions-error');

    const mixedBody = buildDeploymentActionsCommentBody([entry({ status: 'warning' }), entry({ actionId: 'action-2', status: 'manual' })], undefined, 42);
    expect(mixedBody).to.contain('pr-banner-actions-pending');
  });

  describe('Action Details section', () => {
    function actionDef(overrides: Partial<ActionDef>): ActionDef {
      return {
        id: 'action-1',
        label: 'Enable the feature',
        type: 'command',
        command: 'echo hello',
        context: 'all',
        when: 'pre-deploy',
        executionOrder: 0,
        ...overrides,
      };
    }

    // The former layout was a single line of "**Key:** value | **Key:** value" pairs and italic
    // one-liners per org: hard to scan once an action has several parameters or ran in several orgs.
    it('renders the action properties as a two-column table', () => {
      const defs = new Map<string, ActionDef>([['action-1', actionDef({ runOnlyOnceByOrg: false, allowFailure: true, customUsername: 'admin@example.com' })]]);
      const body = buildDeploymentActionsCommentBody([entry({})], defs, 42);

      expect(body).to.contain('| Property | Value |');
      expect(body).to.contain('| ID | `action-1` |');
      expect(body).to.contain('| Type | command |');
      expect(body).to.contain('| Context | all |');
      expect(body).to.contain('| Run only once per org | no |');
      expect(body).to.contain('| Allow failure | yes |');
      expect(body).to.contain('| Custom username | `admin@example.com` |');
      expect(body).to.contain('| Command | `echo hello` |');
      expect(body).to.not.contain('**ID:**');
    });

    it('renders the results by org as a table, with the output below it', () => {
      const entries = [
        entry({ output: 'Items removed: 1' }),
        entry({ orgBranch: 'uat', status: 'manual', jobId: '5678', jobUrl: 'https://ci.example.com/5678', date: '2026-08-15T05:00:00.000Z' }),
      ];
      const body = buildDeploymentActionsCommentBody(entries, undefined, 42);

      expect(body).to.contain('**Results by org**');
      expect(body).to.contain('| Org branch | Status | Date | Job |');
      expect(body).to.contain('| integration | \u2705 success | 2026-08-14 | [1234](https://ci.example.com/1234) |');
      expect(body).to.contain('| uat | \ud83d\udc4b waiting for manual execution | 2026-08-15 | [5678](https://ci.example.com/5678) |');
      expect(body).to.contain('**Output - integration**\n\n```\nItems removed: 1\n```');
      expect(body).to.not.contain('**Output - uat**');
      expect(body).to.not.contain('*integration - ');
    });

    it('renders a warning entry with its label in the results table', () => {
      const body = buildDeploymentActionsCommentBody([entry({ status: 'warning' })], undefined, 42);
      expect(body).to.contain('| integration | \u26a0\ufe0f warning (failed, allowed to fail) | 2026-08-14 |');
    });

    // Numbered, multi-line steps do not read in a table cell: they stay a block under the table
    it('keeps the manual instructions as a block below the properties table', () => {
      const instructions = '1. Open Setup.\n2. Turn the feature on.\nExpected result: the toggle is on.';
      const defs = new Map<string, ActionDef>([['action-1', actionDef({ type: 'manual', command: '', parameters: { instructions } })]]);
      const body = buildDeploymentActionsCommentBody([entry({ status: 'manual' })], defs, 42);

      expect(body).to.contain('| Type | manual |');
      expect(body).to.contain('**Instructions**\n\n' + instructions + '\n\n');
      expect(body).to.not.contain('| Instructions |');
    });

    it('lists the type-specific parameters and the target branches as rows', () => {
      const defs = new Map<string, ActionDef>([['action-1', actionDef({
        type: 'schedule-batch',
        command: '',
        includeTargetBranches: ['integration', 'uat'],
        parameters: { className: 'MyBatch', cronExpression: '0 0 4 ? * SAT', jobName: 'MyBatch_Schedule' },
      })]]);
      const body = buildDeploymentActionsCommentBody([entry({})], defs, 42);

      expect(body).to.contain('| Include target branches | integration, uat |');
      expect(body).to.contain('| Class name | `MyBatch` |');
      expect(body).to.contain('| Cron expression | `0 0 4 ? * SAT` |');
      expect(body).to.contain('| Job name | MyBatch_Schedule |');
    });

    // A pipe would end the cell. Inside inline code the HTML entity is not decoded, so the
    // backslash escape is used there; plain text keeps the entity like the matrix labels.
    it('escapes pipes in property values without breaking the table', () => {
      const defs = new Map<string, ActionDef>([['action-1', actionDef({
        command: 'cat file | grep x',
        parameters: { note: 'a | b' },
      })]]);
      const body = buildDeploymentActionsCommentBody([entry({})], defs, 42);

      expect(body).to.contain('| Command | `cat file \\| grep x` |');
      expect(body).to.contain('| note | a &#124; b |');
    });

    it('still shows the ID when the action definition is not available', () => {
      const body = buildDeploymentActionsCommentBody([entry({})], undefined, 42);
      expect(body).to.contain('| ID | `action-1` |');
      expect(body).to.contain('| Properties | *not available - YAML file not found* |');
    });
  });

  describe('syncManualActionCheckboxes()', () => {
    const originalList = GitProvider.tryListPullRequestCommentsByMarker;
    const originalGetBody = GitProvider.tryGetDeploymentActionsCommentBodyForPr;

    afterEach(() => {
      GitProvider.tryListPullRequestCommentsByMarker = originalList;
      GitProvider.tryGetDeploymentActionsCommentBodyForPr = originalGetBody;
      delete (globalThis as any)._deploymentActionsMultiPrState;
    });

    // Seen on a promotion: the validation comment of Pull Request 483 carried a ticked checkbox of
    // an action owned by Pull Request 444, outside the scope. On every job scanning that comment,
    // the tick was recorded again with the job's date, and 444's comment rewritten.
    it('does not re-record a tick already stored on a Pull Request outside the scope', async () => {
      delete (globalThis as any)._deploymentActionsMultiPrState;
      const marker = buildManualActionCheckboxMarker('enable-feature', 'integration', 444, 'pre-deploy');
      const foreignDone = entry({ actionId: 'enable-feature', actionLabel: 'Enable the feature', orgBranch: 'integration', jobId: '960332', jobUrl: 'https://ci.example.com/960332', date: '2026-07-26T09:00:00.000Z' });
      const bodies: Record<number, string> = {
        444: buildDeploymentActionsCommentBody([foreignDone], undefined, 444),
        483: buildDeploymentActionsCommentBody([], undefined, 483),
      };
      const loadedPrs: number[] = [];
      GitProvider.tryGetDeploymentActionsCommentBodyForPr = async (prNumber: number) => {
        loadedPrs.push(prNumber);
        return bodies[prNumber] ?? null;
      };
      GitProvider.tryListPullRequestCommentsByMarker = async (_marker: string, prNumber?: number) =>
        prNumber === 483 ? [{ id: 1, prNumber: 483, body: `- [x] ${marker} Enable the feature` }] : [];

      await syncManualActionCheckboxes([483]);

      // The out-of-scope Pull Request state was loaded on demand, and its entry left untouched
      expect(loadedPrs).to.include(444);
      const state = (globalThis as any)._deploymentActionsMultiPrState;
      const kept = state.entriesByPr.get(444).find((e: DeploymentActionStateEntry) => e.actionId === 'enable-feature');
      expect(kept.date).to.equal('2026-07-26');
      expect(kept.jobId).to.equal('960332');
      expect(state.dirtyPrs.has(444)).to.equal(false);
    });

    it('still records a tick whose action has no state yet', async () => {
      delete (globalThis as any)._deploymentActionsMultiPrState;
      const marker = buildManualActionCheckboxMarker('enable-feature', 'uat', 483, 'pre-deploy');
      GitProvider.tryGetDeploymentActionsCommentBodyForPr = async () => null;
      GitProvider.tryListPullRequestCommentsByMarker = async (_marker: string, prNumber?: number) =>
        prNumber === 483 ? [{ id: 1, prNumber: 483, body: `- [x] ${marker} Enable the feature` }] : [];

      await syncManualActionCheckboxes([483]);

      const state = (globalThis as any)._deploymentActionsMultiPrState;
      const recorded = state.entriesByPr.get(483).find((e: DeploymentActionStateEntry) => e.actionId === 'enable-feature' && e.orgBranch === 'uat');
      expect(recorded.status).to.equal('success');
      expect(recorded.output).to.contain('ticked checkbox');
    });
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
