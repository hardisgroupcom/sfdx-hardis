/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import type { ActionResult, PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';
import { buildActionOutput } from '../../../src/common/actionsProvider/actionsProvider.js';
import { buildActionsResultMarkdown, buildDeploymentScopeSubjects, getReportedActionStatus, isDeploymentActionsDisabled } from '../../../src/common/utils/prePostCommandUtils.js';

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

describe('buildDeploymentScopeSubjects()', () => {
  it('names both subjects when the Pull Requests carry both', () => {
    const configs = [{ commandsPreDeploy: [{ id: 'a' }], deploymentApexTestClasses: ['MyTest'] }];
    expect(buildDeploymentScopeSubjects(configs, true)).to.deep.equal(['Deployment actions', 'Apex test classes']);
  });

  // Announcing Apex test classes on a Pull Request that carries none describes content
  // the reader will not find in the comment
  it('names only the deployment actions when there is no test class', () => {
    const configs = [{ commandsPostDeploy: [{ id: 'a' }] }];
    expect(buildDeploymentScopeSubjects(configs, true)).to.deep.equal(['Deployment actions']);
  });

  it('names only the Apex test classes when there is no action', () => {
    const configs = [{ deploymentApexTestClasses: ['MyTest'] }];
    expect(buildDeploymentScopeSubjects(configs, true)).to.deep.equal(['Apex test classes']);
  });

  it('names nothing when the Pull Requests carry neither', () => {
    expect(buildDeploymentScopeSubjects([{ commandsPreDeploy: [] }, null], true)).to.deep.equal([]);
    expect(buildDeploymentScopeSubjects([], true)).to.deep.equal([]);
  });

  // Test classes declared while the feature is off are never used, so they must not be announced
  it('ignores the test classes when the feature is not enabled', () => {
    const configs = [{ commandsPreDeploy: [{ id: 'a' }], deploymentApexTestClasses: ['MyTest'] }];
    expect(buildDeploymentScopeSubjects(configs, false)).to.deep.equal(['Deployment actions']);
  });

  it('collects the subjects across all the Pull Requests of the scope', () => {
    const configs = [{ commandsPreDeploy: [{ id: 'a' }] }, { deploymentApexTestClasses: ['MyTest'] }];
    expect(buildDeploymentScopeSubjects(configs, true)).to.deep.equal(['Deployment actions', 'Apex test classes']);
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

  it('reports an action skipped by its branch filter with the reason', () => {
    const commands = [
      action({
        label: 'Publish the customer community',
        result: {
          statusCode: 'skipped',
          skippedCode: 'branch-not-targeted',
          skippedReason: 'Action only runs on target branches uat, preprod, and this deployment targets main',
        },
      }),
    ];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false);

    expect(markdown).to.contain('⚪');
    expect(markdown).to.contain('skipped');
    expect(markdown).to.contain('this deployment targets main');
    expect(markdown).to.not.contain('See details below');
  });

  it('does not list a manual action skipped by its branch filter as a to-do', () => {
    const commands = [
      action({
        type: 'manual',
        label: 'Create the inbound Email Service',
        parameters: { instructions: 'Go to Setup' },
        result: {
          statusCode: 'skipped',
          skippedCode: 'branch-not-targeted',
          skippedReason: 'Action is excluded from target branch main',
        },
      }),
    ];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false);

    expect(markdown).to.not.contain('Manual Actions to perform after deployment');
    expect(markdown).to.not.contain('- [ ]');
  });

  // A legend explaining outcomes absent from the table above it is noise
  it('lists only the statuses present in the table', () => {
    const commands = [
      action({ label: 'Ran fine', result: { statusCode: 'success' } }),
      action({ label: 'Not for this branch', result: { statusCode: 'skipped', skippedReason: 'Action is excluded from target branch main' } }),
    ];
    const markdown = buildActionsResultMarkdown('commandsPostDeploy', commands, false);

    expect(markdown).to.contain('*Legend: ✅ success · ⚪ skipped*');
    expect(markdown).to.not.contain('waiting for manual execution');
    expect(markdown).to.not.contain('not run');
    expect(markdown).to.not.contain('allowed to fail');
  });

  it('distinguishes a failure allowed to fail from a blocking one in the legend', () => {
    const allowed = [action({ allowFailure: true, result: { statusCode: 'failed' } })];
    expect(buildActionsResultMarkdown('commandsPostDeploy', allowed, false))
      .to.contain('*Legend: ⚠️ warning (failed, allowed to fail)*');

    const blocking = [action({ result: { statusCode: 'failed' } })];
    expect(buildActionsResultMarkdown('commandsPostDeploy', blocking, false))
      .to.contain('*Legend: ❌ failed*');
  });

  // The deployment went on, so the comment must not say the action "failed": a reader scanning
  // the status column would take it for a blocking error.
  it('reports a failure allowed to fail as a warning, not as failed', () => {
    const allowed = action({ label: 'Optional step', allowFailure: true, result: { statusCode: 'failed' } });
    expect(getReportedActionStatus(allowed)).to.equal('warning');

    const markdown = buildActionsResultMarkdown('commandsPostDeploy', [allowed], false);
    expect(markdown).to.contain('| ⚠️ | Optional step | command | warning | (Allowed to fail) |');
    expect(markdown).to.not.contain('| failed |');

    // The internal status code is untouched: it still drives the allow-failure decision
    expect(allowed.result?.statusCode).to.equal('failed');
  });

  it('keeps reporting a blocking failure as failed', () => {
    const blocking = action({ label: 'Required step', result: { statusCode: 'failed' } });
    expect(getReportedActionStatus(blocking)).to.equal('failed');
    expect(buildActionsResultMarkdown('commandsPostDeploy', [blocking], false))
      .to.contain('| ❌ | Required step | command | failed | See details below |');
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

describe('isDeploymentActionsDisabled()', () => {
  const ENV_VAR = 'SFDX_HARDIS_DISABLE_DEPLOYMENT_ACTIONS';
  const previousValue = process.env[ENV_VAR];

  afterEach(() => {
    if (previousValue === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = previousValue;
    }
  });

  it('is enabled by default', () => {
    delete process.env[ENV_VAR];
    expect(isDeploymentActionsDisabled({})).to.equal(false);
    expect(isDeploymentActionsDisabled(null)).to.equal(false);
    expect(isDeploymentActionsDisabled({ disableDeploymentActions: false })).to.equal(false);
  });

  it('is disabled by the disableDeploymentActions config property', () => {
    delete process.env[ENV_VAR];
    expect(isDeploymentActionsDisabled({ disableDeploymentActions: true })).to.equal(true);
  });

  // A string value coming from a hand-written YAML file must not disable the feature silently
  it('only accepts a boolean true from the config', () => {
    delete process.env[ENV_VAR];
    expect(isDeploymentActionsDisabled({ disableDeploymentActions: 'true' })).to.equal(false);
  });

  it('is disabled by the env var, without any config property', () => {
    process.env[ENV_VAR] = 'true';
    expect(isDeploymentActionsDisabled({})).to.equal(true);
    process.env[ENV_VAR] = '1';
    expect(isDeploymentActionsDisabled({})).to.equal(true);
  });

  // The env var wins over the config property in both directions, so a single CI job can
  // disable or re-enable the feature without a config commit
  it('lets the env var override the config property', () => {
    process.env[ENV_VAR] = 'false';
    expect(isDeploymentActionsDisabled({ disableDeploymentActions: true })).to.equal(false);
    process.env[ENV_VAR] = '0';
    expect(isDeploymentActionsDisabled({ disableDeploymentActions: true })).to.equal(false);
  });

  it('ignores an unrecognized env var value', () => {
    process.env[ENV_VAR] = 'maybe';
    expect(isDeploymentActionsDisabled({ disableDeploymentActions: true })).to.equal(true);
    expect(isDeploymentActionsDisabled({})).to.equal(false);
  });
});
