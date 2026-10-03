/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  buildClosedByCheckboxNote,
  buildClosedByHandNote,
  buildDeploymentActionsCommentBody,
  buildFailedActionCheckboxMarker,
  buildRunLocallyNote,
  checkManualActionCheckboxInBody,
  decodeMetaMarker,
  encodeMetaMarker,
  getActionStateEntry,
  parseDeploymentActionsCommentBody,
  parseManualActionCheckboxes,
  upsertActionInState,
  type DeploymentActionStateEntry,
} from '../../../src/common/utils/deploymentActionsStateUtils.js';
import { dropActionsMovedToAnotherPullRequest, getEffectiveActionContext } from '../../../src/common/utils/prePostCommandUtils.js';
import { validateMovedFrom } from '../../../src/common/utils/actionUtils.js';
import type { PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';

function entry(overrides: Partial<DeploymentActionStateEntry>): DeploymentActionStateEntry {
  return {
    actionId: 'action-1',
    actionLabel: 'Assign the crew leads',
    orgBranch: 'integration',
    when: 'post-deploy',
    executionOrder: 0,
    status: 'failed',
    jobId: '1234',
    jobUrl: 'https://ci.example.com/1234',
    date: '2026-10-03T05:00:00.000Z',
    output: '',
    ...overrides,
  };
}

function action(overrides: Partial<PrePostCommand>): PrePostCommand {
  return {
    id: 'action-1',
    label: 'Assign the crew leads',
    type: 'command',
    command: 'echo hello',
    context: 'all',
    ...overrides,
  } as PrePostCommand;
}

describe('Deployment Actions state - not-run and moved statuses', () => {
  it('round-trips not-run and moved entries with their links through build and parse', () => {
    const entries = [
      entry({ stoppedActions: [{ pr: 12, actionId: 'action-2' }, { pr: 13, actionId: 'action-9' }] }),
      entry({ actionId: 'action-2', actionLabel: 'Load the reference data', status: 'not-run', executionOrder: 1, blockedBy: { pr: 12, actionId: 'action-1' } }),
      entry({ actionId: 'action-3', actionLabel: 'Recalculate', status: 'moved', executionOrder: 2, movedTo: 15, note: 'Moved to #15' }),
    ];
    const parsed = parseDeploymentActionsCommentBody(buildDeploymentActionsCommentBody(entries, undefined, 12));
    expect(parsed).to.have.length(3);
    const failed = parsed.find((e) => e.actionId === 'action-1')!;
    expect(failed.status).to.equal('failed');
    expect(failed.stoppedActions).to.deep.equal([{ pr: 12, actionId: 'action-2' }, { pr: 13, actionId: 'action-9' }]);
    const notRun = parsed.find((e) => e.actionId === 'action-2')!;
    expect(notRun.status).to.equal('not-run');
    expect(notRun.blockedBy).to.deep.equal({ pr: 12, actionId: 'action-1' });
    const moved = parsed.find((e) => e.actionId === 'action-3')!;
    expect(moved.status).to.equal('moved');
    expect(moved.movedTo).to.equal(15);
    expect(moved.note).to.equal('Moved to #15');
  });

  it('lists failed and stopped actions as checkboxes, and keeps the banner red for a stopped action', () => {
    const body = buildDeploymentActionsCommentBody([
      entry({ status: 'success', actionId: 'done' }),
      entry({ actionId: 'action-2', actionLabel: 'Load the reference data', status: 'not-run' }),
    ], undefined, 12);
    expect(body).to.contain('### Failed actions');
    expect(body).to.contain(`- [ ] ${buildFailedActionCheckboxMarker('action-2', 'integration', 12, 'post-deploy')} Load the reference data *(org branch: integration - not run, a previous action failed)*`);
    expect(body).to.not.contain(buildFailedActionCheckboxMarker('done', 'integration', 12, 'post-deploy'));
    expect(body).to.contain('pr-banner-actions-error');
    expect(body).to.contain('⏸️ not run, a previous action failed');
  });

  it('shows the note column only when an entry carries a note, and the fix Pull Request of a moved action', () => {
    const withoutNote = buildDeploymentActionsCommentBody([entry({ status: 'success' })], undefined, 12);
    expect(withoutNote).to.contain('| Org branch | Status | Date | Job |\n');
    const withNote = buildDeploymentActionsCommentBody([
      entry({ status: 'success', note: 'Run locally by Jane Doe (jane@acme.com) on 2026-10-03 14:05 UTC.', jobId: 'local', jobUrl: '' }),
      entry({ orgBranch: 'uat', status: 'moved', movedTo: 15, note: 'Moved to #15' }),
    ], undefined, 12);
    expect(withNote).to.contain('| Org branch | Status | Date | Job | Note |');
    expect(withNote).to.contain('| integration | ✅ success | 2026-10-03 | local | Run locally by Jane Doe (jane@acme.com) on 2026-10-03 14:05 UTC. |');
    expect(withNote).to.contain('↪️ moved to #15');
    expect(withNote).to.contain('<br/>moved to #15');
  });

  it('writes no meta marker for an entry without recovery details, and ignores a broken one', () => {
    expect(encodeMetaMarker({})).to.equal('');
    expect(decodeMetaMarker('❌ 2026-10-03 <!-- meta:not-base64!! -->')).to.deep.equal({});
    expect(decodeMetaMarker('❌ 2026-10-03')).to.deep.equal({});
  });
});

describe('Deployment Actions state - upsert rules of the recovery statuses', () => {
  afterEach(() => {
    delete (globalThis as any)._deploymentActionsMultiPrState;
  });

  it('never lets a not-run entry hide a success, a manual action or a moved action', () => {
    for (const status of ['success', 'manual', 'moved'] as const) {
      delete (globalThis as any)._deploymentActionsMultiPrState;
      upsertActionInState(entry({ status }), 12);
      upsertActionInState(entry({ status: 'not-run', jobId: '999' }), 12);
      expect(getActionStateEntry(12, 'action-1', 'integration')!.status).to.equal(status);
    }
  });

  it('lets a not-run entry replace a failure, and a moved entry replace a failure but not a success', () => {
    upsertActionInState(entry({ status: 'failed' }), 12);
    upsertActionInState(entry({ status: 'not-run' }), 12);
    expect(getActionStateEntry(12, 'action-1', 'integration')!.status).to.equal('not-run');
    upsertActionInState(entry({ status: 'moved', movedTo: 15 }), 12);
    expect(getActionStateEntry(12, 'action-1', 'integration')!.status).to.equal('moved');

    delete (globalThis as any)._deploymentActionsMultiPrState;
    upsertActionInState(entry({ status: 'success' }), 12);
    upsertActionInState(entry({ status: 'moved', movedTo: 15 }), 12);
    expect(getActionStateEntry(12, 'action-1', 'integration')!.status).to.equal('success');
  });

  it('keeps the stopped actions on the entry of a retry that succeeds, so the next ones can be found', () => {
    upsertActionInState(entry({ stoppedActions: [{ pr: 12, actionId: 'action-2' }] }), 12);
    upsertActionInState(entry({ status: 'success', jobId: 'local', note: 'Run locally by Jane Doe' }), 12);
    const retried = getActionStateEntry(12, 'action-1', 'integration')!;
    expect(retried.status).to.equal('success');
    expect(retried.stoppedActions).to.deep.equal([{ pr: 12, actionId: 'action-2' }]);
  });

  it('keeps the stopped actions when the failed action is moved to a fix Pull Request', () => {
    upsertActionInState(entry({ stoppedActions: [{ pr: 12, actionId: 'action-2' }] }), 12);
    upsertActionInState(entry({ status: 'moved', movedTo: 15 }), 12);
    expect(getActionStateEntry(12, 'action-1', 'integration')!.stoppedActions).to.deep.equal([{ pr: 12, actionId: 'action-2' }]);
  });

  it('keeps the stopped actions of a failure when the action fails again', () => {
    upsertActionInState(entry({ stoppedActions: [{ pr: 12, actionId: 'action-2' }] }), 12);
    upsertActionInState(entry({ jobId: 'local' }), 12);
    expect(getActionStateEntry(12, 'action-1', 'integration')!.stoppedActions).to.deep.equal([{ pr: 12, actionId: 'action-2' }]);
  });
});

describe('Failed action checkboxes', () => {
  const marker = buildFailedActionCheckboxMarker('action-1', 'integration', 12, 'post-deploy');
  const body = `### Failed actions\n\n- [x] ${marker} Assign the crew leads *(org branch: integration)*\n`;

  it('parses a failed action checkbox with its kind', () => {
    const items = parseManualActionCheckboxes(body);
    expect(items).to.have.length(1);
    expect(items[0]).to.include({ kind: 'failed', actionId: 'action-1', orgBranch: 'integration', prNumber: 12, checked: true, label: 'Assign the crew leads' });
  });

  it('ticks a failed action checkbox', () => {
    const res = checkManualActionCheckboxInBody(body.replace('[x]', '[ ]'), 'action-1', 'integration');
    expect(res.changed).to.be.true;
    expect(res.body).to.contain(`- [x] ${marker}`);
  });
});

describe('Recovery notes', () => {
  it('names the person and the Salesforce user who closed a failed action by hand', () => {
    const note = buildClosedByHandNote('failed', 'Jane Doe', 'jane@acme.com', new Date('2026-10-03T14:05:00.000Z'));
    expect(note).to.equal('Failed in CI, then closed by hand by Jane Doe (jane@acme.com) on 2026-10-03 14:05 UTC.');
  });

  it('says a stopped action was not run, and appends the extra note', () => {
    const note = buildClosedByHandNote('not-run', 'Jane Doe', null, new Date('2026-10-03T14:05:00.000Z'), 'Imported with the data loader.');
    expect(note).to.equal('Not run in CI, then closed by hand by Jane Doe on 2026-10-03 14:05 UTC. Imported with the data loader.');
  });

  it('names the Pull Request of a ticked checkbox', () => {
    expect(buildClosedByCheckboxNote('failed', 12)).to.match(/^Failed in CI, then closed by hand via a checkbox in Pull Request #12 \(detected on \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\)\.$/);
  });

  it('describes a local run and a run in CI differently', () => {
    expect(buildRunLocallyNote('Jane Doe', 'jane@acme.com', false)).to.match(/^Run locally by Jane Doe \(jane@acme.com\) on /);
    expect(buildRunLocallyNote(null, 'jane@acme.com', true)).to.match(/^Retried by sf hardis:project:action:run as \(jane@acme.com\) on /);
  });
});

describe('Moved actions', () => {
  it('drops the original copy of an action moved to a fix Pull Request', () => {
    const original = action({ pullRequest: { idNumber: 12, idStr: '12' } as any });
    const copy = action({ movedFrom: 12, pullRequest: { idNumber: 15, idStr: '15' } as any });
    const other = action({ id: 'action-2', pullRequest: { idNumber: 12, idStr: '12' } as any });
    expect(dropActionsMovedToAnotherPullRequest([original, other, copy])).to.deep.equal([other, copy]);
  });

  it('keeps an action with the same id in another Pull Request than the one it was moved from', () => {
    const unrelated = action({ pullRequest: { idNumber: 11, idStr: '11' } as any });
    const copy = action({ movedFrom: 12, pullRequest: { idNumber: 15, idStr: '15' } as any });
    expect(dropActionsMovedToAnotherPullRequest([unrelated, copy])).to.deep.equal([unrelated, copy]);
  });

  it('reads a movedFrom written as a quoted number', () => {
    const original = action({ pullRequest: { idNumber: 12, idStr: '12' } as any });
    const copy = action({ movedFrom: '12' as any, pullRequest: { idNumber: 15, idStr: '15' } as any });
    expect(dropActionsMovedToAnotherPullRequest([original, copy])).to.deep.equal([copy]);
    expect(copy.movedFrom).to.equal(12);
  });

  it('validates movedFrom', () => {
    expect(validateMovedFrom(action({}), 'project')).to.deep.equal([]);
    expect(validateMovedFrom(action({ movedFrom: 12 }), 'pr', '15')).to.deep.equal([]);
    expect(validateMovedFrom(action({ movedFrom: 0 }), 'pr', '15')).to.have.length(1);
    expect(validateMovedFrom(action({ movedFrom: 12 }), 'branch')).to.have.length(1);
    expect(validateMovedFrom(action({ movedFrom: 12 }), 'pr', '12')).to.have.length(1);
    expect(validateMovedFrom(action({ movedFrom: '12' as any }), 'pr', '15')).to.deep.equal([]);
  });
});

describe('getEffectiveActionContext()', () => {
  it('forces run-batch actions to the deployment job', () => {
    expect(getEffectiveActionContext(action({ type: 'run-batch', context: 'all' }))).to.equal('process-deployment-only');
    expect(getEffectiveActionContext(action({ context: 'check-deployment-only' }))).to.equal('check-deployment-only');
    expect(getEffectiveActionContext(action({ context: undefined as any }))).to.equal('all');
  });
});
