import { expect } from 'chai';
import { AgentActivateAction } from '../../../src/common/actionsProvider/agentActivateAction.js';
import { PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';
import { DEPLOYMENT_ONLY_ACTION_TYPES, resolveRunOnlyOnceByOrg } from '../../../src/common/actionsProvider/actionTypes.js';
import { validateActionParameters } from '../../../src/common/utils/actionUtils.js';

function action(parameters: Record<string, any>, extra: Partial<PrePostCommand> = {}): PrePostCommand {
  return {
    id: 'agent-1',
    label: 'Activate the service agent',
    type: 'agent-activate',
    when: 'post-deploy',
    context: 'process-deployment-only',
    command: '',
    parameters,
    ...extra,
  } as PrePostCommand;
}

const provider = new AgentActivateAction();

describe('AgentActivateAction type rules', () => {
  it('runs after the deployment only, in deployment jobs, at every deployment by default', () => {
    expect(provider.getAllowedWhen()).to.deep.equal(['post-deploy']);
    expect(DEPLOYMENT_ONLY_ACTION_TYPES).to.include('agent-activate');
    expect(resolveRunOnlyOnceByOrg({ type: 'agent-activate' })).to.equal(false);
    expect(resolveRunOnlyOnceByOrg({ type: 'agent-activate', runOnlyOnceByOrg: true })).to.equal(true);
    expect(provider.getFlagNames()).to.deep.equal(['agent-name', 'agent-version']);
  });
});

describe('AgentActivateAction.getDefinitionErrors', () => {
  it('accepts an agent name alone, or with a version number', async () => {
    expect(await provider.getDefinitionErrors(action({ agentName: 'My_Agent' }))).to.deep.equal([]);
    expect(await provider.getDefinitionErrors(action({ agentName: 'My_Agent', agentVersion: '3' }))).to.deep.equal([]);
    expect(await provider.getDefinitionErrors(action({ agentName: 'My_Agent', agentVersion: 4 }))).to.deep.equal([]);
  });

  it('requires an agent name that can be written in a command line', async () => {
    expect(await provider.getDefinitionErrors(action({}))).to.have.lengthOf(1);
    expect(await provider.getDefinitionErrors(action({ agentName: 'My_Agent; rm -rf /' }))).to.have.lengthOf(1);
  });

  it('rejects a version that is neither a number nor latest', async () => {
    expect(await provider.getDefinitionErrors(action({ agentName: 'A', agentVersion: 'v2' }))).to.have.lengthOf(1);
    expect(await provider.getDefinitionErrors(action({ agentName: 'A', agentVersion: '0' }))).to.have.lengthOf(1);
  });

  it('is post-deploy only, and only accepts the process-deployment-only context', async () => {
    expect(await validateActionParameters(action({ agentName: 'A' }, { when: 'pre-deploy' }))).to.have.lengthOf(1);
    expect(await provider.checkParameters(action({ agentName: 'A' }, { when: 'pre-deploy' }))).to.not.equal(null);
    const allContext = action({ agentName: 'A' }, { context: 'all' });
    expect(await provider.getDefinitionErrors(allContext)).to.have.lengthOf(1);
    expect(await provider.checkParameters(allContext)).to.equal(null);
  });
});

describe('AgentActivateAction parameters', () => {
  it('applies only the flags passed, with latest as the default version', () => {
    expect(provider.applyFlags({ agentName: 'A', agentVersion: '2' }, { 'agent-version': 'LATEST' })).to.deep.equal({ agentName: 'A', agentVersion: 'latest' });
    expect(provider.applyFlags({}, { 'agent-name': ' B ' })).to.deep.equal({ agentName: 'B', agentVersion: 'latest' });
  });

  it('requires --agent-name when headless', async () => {
    let error: any = null;
    try {
      await provider.collectParameters({}, true, {});
    } catch (e) {
      error = e;
    }
    expect(error).to.not.equal(null);
    expect(await provider.collectParameters({ 'agent-name': 'A' }, true, {})).to.deep.equal({ agentName: 'A', agentVersion: 'latest' });
  });

  it('treats an unset version and latest as the same action', () => {
    expect(provider.getIdentityParameters(action({ agentName: 'My_Agent' }))).to.deep.equal(
      provider.getIdentityParameters(action({ agentName: 'my_agent', agentVersion: 'Latest' }))
    );
  });
});

describe('AgentActivateAction.run', () => {
  let previousConn: any;

  function fakeConnection(versions: Array<{ fullName: string; status: string }>): any {
    return {
      getUsername: () => 'admin@example.com',
      metadata: { list: async () => versions.map((version) => ({ fullName: version.fullName })) },
      query: async () => ({
        done: true,
        records: versions.map((version) => {
          const [name, number] = version.fullName.split('#');
          return { BotDefinition: { DeveloperName: name }, VersionNumber: Number(number), Status: version.status };
        }),
      }),
    };
  }

  beforeEach(() => {
    previousConn = globalThis.jsForceConn;
  });

  afterEach(() => {
    globalThis.jsForceConn = previousConn;
  });

  it('leaves the latest version as it is when it is already active', async () => {
    globalThis.jsForceConn = fakeConnection([
      { fullName: 'My_Agent#1', status: 'Inactive' },
      { fullName: 'My_Agent#2', status: 'Active' },
    ]);
    const result = await provider.run(action({ agentName: 'My_Agent' }));
    expect(result.statusCode).to.equal('success');
  });

  it('fails when the version is not in the org', async () => {
    globalThis.jsForceConn = fakeConnection([{ fullName: 'My_Agent#1', status: 'Active' }]);
    const result = await provider.run(action({ agentName: 'My_Agent', agentVersion: '5' }));
    expect(result.statusCode).to.equal('failed');
  });

  it('fails before reading the org when the parameters are wrong', async () => {
    globalThis.jsForceConn = { metadata: { list: async () => { throw new Error('must not be called'); } } };
    const result = await provider.run(action({ agentName: '' }));
    expect(result.statusCode).to.equal('failed');
  });
});
