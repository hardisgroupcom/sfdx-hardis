/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import type { ActionResult, PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';
import { buildActionOutput } from '../../../src/common/actionsProvider/actionsProvider.js';
import { buildActionsResultMarkdown } from '../../../src/common/utils/prePostCommandUtils.js';

function action(overrides: Partial<PrePostCommand>): PrePostCommand {
  return {
    id: 'action-id',
    label: 'An action',
    type: 'command',
    command: 'echo hello',
    context: 'all',
    when: 'post-deploy',
    ...overrides,
  } as PrePostCommand;
}

const NOT_RUN: ActionResult = {
  statusCode: 'not-run',
  skippedReason: 'Not run because the metadata deployment failed',
};

describe('buildActionOutput()', () => {
  it('joins stdout and stderr when both are present', () => {
    expect(buildActionOutput({ status: 1, stdout: 'out', stderr: 'err' })).to.equal('out\nerr');
  });

  it('keeps the only non-empty stream', () => {
    expect(buildActionOutput({ status: 0, stdout: 'out', stderr: '' })).to.equal('out');
    expect(buildActionOutput({ status: 1, stdout: '   ', stderr: 'err' })).to.equal('err');
  });

  // execCommand returns this shape for commands containing --json when called with fail:false:
  // no stdout, no stderr, the details are only in errorMessage.
  it('falls back to errorMessage when there is no stdout and no stderr', () => {
    const res = { status: 1, errorMessage: 'Error processing command\nAgent not found', error: new Error('boom') };
    expect(buildActionOutput(res)).to.equal('Error processing command\nAgent not found');
  });

  it('falls back to the error message when there is no errorMessage either', () => {
    expect(buildActionOutput({ status: 1, error: new Error('boom') })).to.equal('boom');
  });

  it('returns an empty string rather than blank lines when there is nothing to report', () => {
    expect(buildActionOutput({ status: 0 })).to.equal('');
    expect(buildActionOutput({ status: 0, stdout: '\n', stderr: '' })).to.equal('');
  });
});

describe('buildActionsResultMarkdown()', () => {
  it('reports a not-run action with its reason instead of "See details below"', () => {
    const commands = [action({ result: NOT_RUN })];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false);

    expect(markdown).to.contain('⏭️');
    expect(markdown).to.contain('not-run');
    expect(markdown).to.contain('Not run because the metadata deployment failed');
    expect(markdown).to.not.contain('See details below');
  });

  it('does not list a not-run manual action as a manual to-do', () => {
    const commands = [
      action({ type: 'manual', label: 'Create the inbound Email Service', parameters: { instructions: 'Go to Setup' }, result: NOT_RUN }),
    ];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false);

    expect(markdown).to.not.contain('Manual Actions to perform after deployment');
    expect(markdown).to.not.contain('- [ ]');
    expect(markdown).to.not.contain('Go to Setup');
  });

  it('still lists a manual action that was actually reached', () => {
    const commands = [
      action({
        type: 'manual',
        label: 'Create the inbound Email Service',
        parameters: { instructions: 'Go to Setup' },
        result: { statusCode: 'manual', output: 'Go to Setup' },
      }),
    ];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false);

    expect(markdown).to.contain('Manual Actions to perform after deployment');
    expect(markdown).to.contain('- [ ] Create the inbound Email Service');
    expect(markdown).to.contain('Go to Setup');
  });

  it('does not render an empty code block for a whitespace-only output', () => {
    const commands = [action({ result: { statusCode: 'failed', output: '\n' } })];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false);

    expect(markdown).to.not.contain('Expand to see details for each action');
    expect(markdown).to.not.contain('```');
  });

  it('renders the output of a failed action so the reason is visible', () => {
    const commands = [action({ result: { statusCode: 'failed', output: 'Agent not found' } })];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false);

    expect(markdown).to.contain('Expand to see details for each action');
    expect(markdown).to.contain('Agent not found');
  });

  it('describes a manual action as waiting for manual execution, with a status legend', () => {
    const commands = [
      action({ type: 'manual', parameters: { instructions: 'Go to Setup' }, result: { statusCode: 'manual', output: 'Go to Setup' } }),
    ];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false);

    expect(markdown).to.contain('waiting for manual execution');
    expect(markdown).to.not.contain('| manual | manual |');
    expect(markdown).to.contain('*Legend:');
  });

  it('renders manual instructions as a blockquote instead of a code fence', () => {
    const commands = [
      action({ type: 'manual', parameters: { instructions: '1. Go to Setup\n2. Click Save' }, result: { statusCode: 'manual' } }),
    ];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false);

    expect(markdown).to.contain('> 1. Go to Setup');
    expect(markdown).to.contain('> 2. Click Save');
    expect(markdown).to.not.contain('```\n1. Go to Setup');
  });

  it('adds a hidden checkbox marker when the org branch is known', () => {
    const commands = [
      action({ id: 'manual-1', type: 'manual', parameters: { instructions: 'Go to Setup' }, result: { statusCode: 'manual' } }),
    ];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false, 'uat');

    expect(markdown).to.contain('- [ ] <!-- sfdx-hardis-manual-action id:manual-1 org:uat pr:0 when:post-deploy -->');
  });

  it('renders an already-done manual action as a ticked to-do, and a context-skipped one not at all', () => {
    const commands = [
      action({
        id: 'done-1', type: 'manual', label: 'Done action',
        // skippedCode is the detection contract: the reason wording must not matter
        result: { statusCode: 'skipped', skippedCode: 'already-run-in-org', skippedReason: 'some reworded reason' },
      }),
      action({
        id: 'ctx-1', type: 'manual', label: 'Context skipped action',
        result: { statusCode: 'skipped', skippedReason: 'Action context is process-deployment-only but we are in check deployment mode' },
      }),
      action({ id: 'pending-1', type: 'manual', label: 'Pending action', result: { statusCode: 'manual' } }),
    ];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false, 'uat');

    expect(markdown).to.contain('- [x] <!-- sfdx-hardis-manual-action id:done-1 org:uat pr:0 when:post-deploy --> Done action');
    expect(markdown).to.contain('- [ ] <!-- sfdx-hardis-manual-action id:pending-1 org:uat pr:0 when:post-deploy --> Pending action');
    expect(markdown).to.not.contain('] <!-- sfdx-hardis-manual-action id:ctx-1');
  });

  it('neutralizes raw HTML tags in manual instructions', () => {
    const commands = [
      action({ type: 'manual', parameters: { instructions: 'Click </details> then **Save**' }, result: { statusCode: 'manual' } }),
    ];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false);

    expect(markdown).to.contain('> Click &lt;/details> then **Save**');
    expect(markdown).to.not.contain('> Click </details>');
  });

  it('notes when two distinct actions share the same label', () => {
    const commands = [
      action({ id: 'a1', label: 'Strip items', result: { statusCode: 'success', output: 'done' } }),
      action({ id: 'a2', label: 'Strip items', result: { statusCode: 'success', output: 'done' } }),
    ];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false);

    expect(markdown).to.contain('distinct actions');
  });
});
