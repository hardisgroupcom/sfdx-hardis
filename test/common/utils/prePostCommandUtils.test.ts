/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import type { ActionResult, PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';
import { buildActionOutput } from '../../../src/common/actionsProvider/actionsProvider.js';
import { buildDeploymentScopeSubjects, getReportedActionStatus, isDeploymentActionsDisabled } from '../../../src/common/utils/prePostCommandUtils.js';
import { buildDeploymentPrCommentSections } from '../../../src/common/gitProvider/utilsPrCommentLayout.js';

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

  // A failed command throws the error of child_process.exec, whose message already repeats stderr:
  // the output is read from its streams, so each line shows once in the Pull Request comment
  it('reads the streams of a thrown exec error, not its message', () => {
    const error = Object.assign(new Error('Command failed: node fail.js\nERP answered 503\nConnecting...\nERP answered 503'), {
      stdout: 'Connecting...\n',
      stderr: 'ERP answered 503',
    });
    expect(buildActionOutput(error)).to.equal('Connecting...\nERP answered 503');
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

// The deployment actions as the Pull Request comment layout shows them (utilsPrCommentLayout.ts)
function renderActions(commands: PrePostCommand[], checkOnly = false): string {
  return buildDeploymentPrCommentSections(
    { status: 'valid', postDeployActions: { orgBranch: 'integration', commands } },
    { checkOnly, targetBranch: 'integration', prNumber: 12 }
  )
    .map((section) => section.markdown)
    .join('\n\n');
}

describe('Deployment actions in the Pull Request comment', () => {
  it('reports a not-run action with its reason', () => {
    const markdown = renderActions([action({ result: NOT_RUN })]);
    expect(markdown).to.contain('| ⏸️ | An action | after | not run: Not run because the metadata deployment failed |');
  });

  it('does not list a not-run manual action as a manual to-do', () => {
    const markdown = renderActions([
      action({ type: 'manual', label: 'Create the inbound Email Service', parameters: { instructions: 'Go to Setup' }, result: NOT_RUN }),
    ]);
    expect(markdown).to.not.contain('To do by hand in');
    expect(markdown).to.not.contain('- [ ]');
    expect(markdown).to.not.contain('Go to Setup');
  });

  it('still lists a manual action that was actually reached', () => {
    const markdown = renderActions([
      action({
        type: 'manual',
        label: 'Create the inbound Email Service',
        parameters: { instructions: 'Go to Setup' },
        result: { statusCode: 'manual', output: 'Go to Setup' },
      }),
    ]);
    expect(markdown).to.contain('#### 👋 To do by hand in `integration` after the deployment');
    expect(markdown).to.contain('**Create the inbound Email Service**');
    expect(markdown).to.contain('  > Go to Setup');
  });

  it('reports an action skipped by its branch filter with the reason', () => {
    const markdown = renderActions([
      action({ label: 'Publish the customer community', result: { statusCode: 'skipped', skippedCode: 'branch-not-targeted' } }),
    ]);
    expect(markdown).to.contain('| ⚪ | Publish the customer community | after | skipped: Not meant for integration |');
  });

  it('does not list a manual action skipped by its branch filter as a to-do', () => {
    const markdown = renderActions([
      action({ type: 'manual', label: 'Create the inbound Email Service', parameters: { instructions: 'Go to Setup' }, result: { statusCode: 'skipped', skippedCode: 'branch-not-targeted' } }),
    ]);
    expect(markdown).to.not.contain('- [ ]');
  });

  // The deployment went on, so the comment must not say the action "failed" without more: a reader
  // scanning the results would take it for a blocking error.
  it('reports a failure allowed to fail as a warning, not as failed', () => {
    const allowed = action({ label: 'Optional step', allowFailure: true, result: { statusCode: 'failed' } });
    expect(getReportedActionStatus(allowed)).to.equal('warning');
    const markdown = renderActions([allowed]);
    expect(markdown).to.contain('| ⚠️ | Optional step | after | failed, allowed to fail |');
    expect(markdown).to.contain('⚠️ 1 failed, allowed to fail');
    expect(markdown).to.not.contain('#### ❌ Failed action');
    // The internal status code is untouched: it still drives the allow-failure decision
    expect(allowed.result?.statusCode).to.equal('failed');
  });

  it('shows a blocking failure first, with its output', () => {
    const blocking = action({ label: 'Required step', result: { statusCode: 'failed', output: 'Error: the ERP answered 503' } });
    expect(getReportedActionStatus(blocking)).to.equal('failed');
    const markdown = renderActions([blocking]);
    expect(markdown).to.contain('#### ❌ Failed action');
    expect(markdown).to.contain('Error: the ERP answered 503');
    expect(markdown).to.contain('| ❌ | Required step | after | failed |');
  });

  it('does not render an empty code block for a whitespace-only output', () => {
    const markdown = renderActions([action({ result: { statusCode: 'failed', output: '\n' } })]);
    expect(markdown).to.not.contain('```');
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
