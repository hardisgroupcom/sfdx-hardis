import { expect } from 'chai';
import { UserAccessPolicyAction, buildUserAccessPoliciesConfig } from '../../../src/common/actionsProvider/userAccessPolicyAction.js';
import type { BrowserforceApplyOptions, BrowserforceApplyOutcome } from '../../../src/common/actionsProvider/browserforce/browserforceRunner.js';
import { PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';
import { resolveRunOnlyOnceByOrg } from '../../../src/common/actionsProvider/actionTypes.js';
import {
  assertNoFlagsOfOtherTypes,
  getEffectiveActionContext,
  isRunOnlyOnceByOrgFlagPassed,
  listAvailableActionTypes,
  validateActionParameters,
} from '../../../src/common/utils/actionUtils.js';

function action(parameters: Record<string, any>, extra: Partial<PrePostCommand> = {}): PrePostCommand {
  return {
    id: 'uap-1',
    label: 'Activate policies',
    type: 'user-access-policy',
    when: 'post-deploy',
    context: 'process-deployment-only',
    command: '',
    parameters,
    ...extra,
  } as PrePostCommand;
}

const provider = new UserAccessPolicyAction();

describe('UserAccessPolicyAction type rules', () => {
  it('runs after the deployment only, at every deployment by default', () => {
    expect(provider.getAllowedWhen()).to.deep.equal(['post-deploy']);
    expect(resolveRunOnlyOnceByOrg({ type: 'user-access-policy' })).to.equal(false);
    expect(resolveRunOnlyOnceByOrg({ type: 'user-access-policy', runOnlyOnceByOrg: true })).to.equal(true);
    expect(resolveRunOnlyOnceByOrg({ type: 'apex' })).to.equal(true);
    expect(provider.getFlagNames()).to.deep.equal(['policies', 'activate', 'apply-to-all']);
  });
});

describe('UserAccessPolicyAction.getDefinitionErrors', () => {
  it('accepts policies alone', async () => {
    expect(await provider.getDefinitionErrors(action({ policies: ['Sales_Access'] }))).to.deep.equal([]);
  });

  it('requires at least one policy', async () => {
    expect(await provider.getDefinitionErrors(action({ policies: [] }))).to.have.lengthOf(1);
  });

  it('rejects a name that is not a developer name', async () => {
    expect(await provider.getDefinitionErrors(action({ policies: ["Sales' OR Name != '"] }))).to.have.lengthOf(1);
  });

  it('rejects an action that does nothing, booleans written as strings included', async () => {
    expect(await provider.getDefinitionErrors(action({ policies: ['A'], activate: false, applyToAll: false }))).to.have.lengthOf(1);
    expect(await provider.getDefinitionErrors(action({ policies: ['A'], activate: 'false', applyToAll: 'true' }))).to.deep.equal([]);
  });

  it('is post-deploy only: when saved, with the phase it is saved into, and when run', async () => {
    expect(await validateActionParameters(action({ policies: ['A'] }, { when: 'pre-deploy' }))).to.have.lengthOf(1);
    expect(await validateActionParameters(action({ policies: ['A'] }, { when: undefined }), 'pre-deploy')).to.have.lengthOf(1);
    expect(await provider.checkParameters(action({ policies: ['A'] }, { when: 'pre-deploy' }))).to.not.equal(null);
  });

  it('only accepts the process-deployment-only context, but does not fail a run on it', async () => {
    const allContext = action({ policies: ['A'] }, { context: 'all' });
    expect(await provider.getDefinitionErrors(allContext)).to.have.lengthOf(1);
    expect(await provider.checkParameters(allContext)).to.equal(null);
  });
});

describe('UserAccessPolicyAction.applyFlags', () => {
  it('only changes the parameters whose flag is passed, and stores a clean list and booleans', () => {
    expect(provider.applyFlags({ policies: ['A'], activate: false }, { 'apply-to-all': true })).to.deep.equal({
      policies: ['A'],
      activate: false,
      applyToAll: true,
    });
    expect(provider.applyFlags({ policies: ['A'] }, { policies: ' B, C;B ', activate: false })).to.deep.equal({
      policies: ['B', 'C'],
      activate: false,
      applyToAll: false,
    });
  });
});

describe('UserAccessPolicyAction.collectParameters', () => {
  it('reads the flags when headless, with the defaults applied', async () => {
    expect(await provider.collectParameters({ policies: 'A,B' }, true, {})).to.deep.equal({
      policies: ['A', 'B'],
      activate: true,
      applyToAll: false,
    });
  });

  it('requires --policies when headless', async () => {
    let error: any = null;
    try {
      await provider.collectParameters({ 'apply-to-all': true }, true, {});
    } catch (e) {
      error = e;
    }
    expect(error).to.not.equal(null);
  });
});

describe('UserAccessPolicyAction.getIdentityParameters', () => {
  it('ignores the order of the policies and the defaults written or not', () => {
    expect(provider.getIdentityParameters(action({ policies: ['B', 'A'] }))).to.deep.equal(
      provider.getIdentityParameters(action({ policies: 'A,B', activate: true, applyToAll: false }))
    );
  });
});

describe('UserAccessPolicyAction.run', () => {
  let previousConn: any;

  // Browserforce cannot run in the tests: the calls are recorded and answered with the given outcome
  class TestUserAccessPolicyAction extends UserAccessPolicyAction {
    public calls: BrowserforceApplyOptions[] = [];
    public constructor(private readonly outcome: BrowserforceApplyOutcome = { success: true, outputLines: [] }) {
      super();
    }
    protected async applyWithBrowserforce(options: BrowserforceApplyOptions): Promise<BrowserforceApplyOutcome> {
      this.calls.push(options);
      return this.outcome;
    }
  }

  function fakeConnection(options: { records?: any[]; queryError?: any }): any {
    return {
      instanceUrl: 'https://example.my.salesforce.com',
      getUsername: () => 'admin@example.com',
      query: async () => {
        if (options.queryError) {
          throw options.queryError;
        }
        return { done: true, records: options.records || [] };
      },
    };
  }

  beforeEach(() => {
    previousConn = globalThis.jsForceConn;
  });

  afterEach(() => {
    globalThis.jsForceConn = previousConn;
  });

  it('activates the policies with Browserforce, with their developer name as written in the org', async () => {
    globalThis.jsForceConn = fakeConnection({ records: [{ Id: '3xE000000000001AAA', DeveloperName: 'Sales_Access', Status: 'Design' }] });
    const provider = new TestUserAccessPolicyAction();
    const result = await provider.run(action({ policies: ['sales_access'] }, { pipelineContext: { targetBranch: 'uat' } as any }));
    expect(result.statusCode).to.equal('success');
    expect(provider.calls).to.deep.equal([{
      setting: 'userAccessPolicies',
      config: { accessPolicies: [{ apiName: 'Sales_Access', active: true }] },
      username: 'admin@example.com',
      dryRun: false,
      targetBranch: 'uat',
    }]);
  });

  it('fails when Browserforce fails, with its output', async () => {
    globalThis.jsForceConn = fakeConnection({ records: [{ Id: '3xE000000000001AAA', DeveloperName: 'A', Status: 'Design' }] });
    const provider = new TestUserAccessPolicyAction({ success: false, outputLines: ['You cannot set a policy as active without at least 1 filter and 1 action.'] });
    const result = await provider.run(action({ policies: ['A'] }));
    expect(result.statusCode).to.equal('failed');
    expect(result.output).to.contain('at least 1 filter');
  });

  it('fails when a policy is not in the org, without starting Browserforce', async () => {
    globalThis.jsForceConn = fakeConnection({ records: [{ Id: '3xE000000000001AAA', DeveloperName: 'A', Status: 'Design' }] });
    const provider = new TestUserAccessPolicyAction();
    const result = await provider.run(action({ policies: ['A', 'Missing'] }));
    expect(result.statusCode).to.equal('failed');
    expect(provider.calls).to.have.lengthOf(0);
  });

  it('fails when User Access Policies are not enabled in the org', async () => {
    globalThis.jsForceConn = fakeConnection({ queryError: Object.assign(new Error('sObject type not supported'), { errorCode: 'INVALID_TYPE' }) });
    const provider = new TestUserAccessPolicyAction();
    const result = await provider.run(action({ policies: ['A'] }));
    expect(result.statusCode).to.equal('failed');
    expect(provider.calls).to.have.lengthOf(0);
  });

  it('fails before reading the org when the parameters are wrong', async () => {
    globalThis.jsForceConn = fakeConnection({ queryError: new Error('must not be queried') });
    const provider = new TestUserAccessPolicyAction();
    const result = await provider.run(action({ policies: [] }));
    expect(result.statusCode).to.equal('failed');
    expect(provider.calls).to.have.lengthOf(0);
  });
});

describe('buildUserAccessPoliciesConfig', () => {
  it('only writes active and applyToAll when the action asks for them', () => {
    expect(buildUserAccessPoliciesConfig(['A'], { policies: ['A'], activate: true, applyToAll: false })).to.deep.equal({ accessPolicies: [{ apiName: 'A', active: true }] });
    expect(buildUserAccessPoliciesConfig(['A', 'B'], { policies: ['A', 'B'], activate: false, applyToAll: true })).to.deep.equal({
      accessPolicies: [{ apiName: 'A', applyToAll: true }, { apiName: 'B', applyToAll: true }],
    });
  });
});

describe('user-access-policy in the shared action helpers', () => {
  it('always runs in the process-deployment-only context', () => {
    expect(getEffectiveActionContext(action({ policies: ['A'] }, { context: 'all' }))).to.equal('process-deployment-only');
  });

  it('is only offered for post-deploy actions, and remove-packagexml-items only for pre-deploy ones', async () => {
    const preDeployTypes = (await listAvailableActionTypes('pre-deploy')).map((choice) => choice.value);
    const postDeployTypes = (await listAvailableActionTypes('post-deploy')).map((choice) => choice.value);
    expect(preDeployTypes).to.not.include('user-access-policy');
    expect(preDeployTypes).to.include('remove-packagexml-items');
    expect(postDeployTypes).to.include('user-access-policy');
    expect(postDeployTypes).to.not.include('remove-packagexml-items');
  });

  it('is validated by validateActionParameters, with the phase it is saved into', async () => {
    expect(await validateActionParameters(action({ policies: ['A'] }), 'post-deploy')).to.deep.equal([]);
    expect(await validateActionParameters(action({ policies: ['A'] }, { when: undefined }), 'pre-deploy')).to.have.lengthOf(1);
  });

  it('refuses the flags of another type, and accepts its own', async () => {
    let error: any = null;
    try {
      await assertNoFlagsOfOtherTypes('command', { 'apply-to-all': true });
    } catch (e) {
      error = e;
    }
    expect(error).to.not.equal(null);
    await assertNoFlagsOfOtherTypes('user-access-policy', { policies: 'A', activate: false });
  });

  it('tells a passed --run-only-once-by-org from its default', () => {
    expect(isRunOnlyOnceByOrgFlagPassed(['--type', 'user-access-policy'])).to.equal(false);
    expect(isRunOnlyOnceByOrgFlagPassed(['--run-only-once-by-org'])).to.equal(true);
    expect(isRunOnlyOnceByOrgFlagPassed(['--no-run-only-once-by-org'])).to.equal(true);
  });
});
