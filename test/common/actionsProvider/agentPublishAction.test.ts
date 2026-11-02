import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import { AgentPublishAction } from '../../../src/common/actionsProvider/agentPublishAction.js';
import { PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';
import { DEPLOYMENT_ACTION_TYPES, DEPLOYMENT_ONLY_ACTION_TYPES, resolveRunOnlyOnceByOrg } from '../../../src/common/actionsProvider/actionTypes.js';
import { validateActionParameters } from '../../../src/common/utils/actionUtils.js';

function action(parameters: Record<string, any>, extra: Partial<PrePostCommand> = {}): PrePostCommand {
  return {
    id: 'agent-publish-1',
    label: 'Publish the service agent',
    type: 'agent-publish',
    when: 'post-deploy',
    context: 'process-deployment-only',
    command: '',
    parameters,
    ...extra,
  } as PrePostCommand;
}

const provider = new AgentPublishAction();

describe('AgentPublishAction type rules', () => {
  it('is a deployment-only action that runs once by org unless told otherwise', () => {
    expect(DEPLOYMENT_ACTION_TYPES).to.include('agent-publish');
    expect(provider.getAllowedWhen()).to.deep.equal(['post-deploy']);
    expect(DEPLOYMENT_ONLY_ACTION_TYPES).to.include('agent-publish');
    expect(resolveRunOnlyOnceByOrg({ type: 'agent-publish' })).to.equal(true);
    expect(resolveRunOnlyOnceByOrg({ type: 'agent-publish', runOnlyOnceByOrg: false })).to.equal(false);
    expect(provider.getFlagNames()).to.deep.equal(['agent-name']);
  });
});

describe('AgentPublishAction.getDefinitionErrors', () => {
  it('accepts an agent API name', async () => {
    expect(await provider.getDefinitionErrors(action({ agentName: 'My_Agent' }))).to.deep.equal([]);
  });

  it('refuses a missing or invalid agent name, and another context', async () => {
    expect(await provider.getDefinitionErrors(action({}))).to.have.lengthOf(1);
    expect(await provider.getDefinitionErrors(action({ agentName: 'My Agent; rm -rf' }))).to.have.lengthOf(1);
    expect(await provider.getDefinitionErrors(action({ agentName: 'My_Agent' }, { context: 'all' }))).to.have.lengthOf(1);
  });

  it('is validated through the generic action validation', async () => {
    expect(await validateActionParameters(action({ agentName: 'My_Agent' }))).to.deep.equal([]);
    expect(await validateActionParameters(action({ agentName: 'My_Agent' }, { when: 'pre-deploy' }))).to.not.deep.equal([]);
  });
});

describe('AgentPublishAction parameters', () => {
  it('reads --agent-name, trimmed', () => {
    expect(provider.applyFlags({}, { 'agent-name': ' My_Agent ' })).to.deep.equal({ agentName: 'My_Agent' });
  });

  it('requires --agent-name without prompts', async () => {
    let error: any = null;
    try {
      await provider.collectParameters({}, true, {});
    } catch (e) {
      error = e;
    }
    expect(error).to.not.equal(null);
  });

  it('identifies an action by its agent, in any case', () => {
    expect(provider.getIdentityParameters(action({ agentName: 'My_Agent' }))).to.deep.equal({ agentName: 'my_agent' });
  });
});

describe('AgentPublishAction.run', () => {
  let previousConn: any;
  let previousCwd: string;
  let tmpDir: string;

  beforeEach(() => {
    previousConn = globalThis.jsForceConn;
    previousCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-publish-'));
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    globalThis.jsForceConn = previousConn;
    process.chdir(previousCwd);
    await fs.remove(tmpDir);
  });

  it('fails before reading the org when the project has no bundle for the agent', async () => {
    globalThis.jsForceConn = { metadata: { list: async () => { throw new Error('must not be called'); } } };
    const result = await provider.run(action({ agentName: 'My_Agent' }));
    expect(result.statusCode).to.equal('failed');
    expect(result.output).to.contain('aiAuthoringBundles/My_Agent/My_Agent.agent');
  });

  it('fails before reading the org when the parameters are wrong', async () => {
    globalThis.jsForceConn = { metadata: { list: async () => { throw new Error('must not be called'); } } };
    const result = await provider.run(action({ agentName: '' }));
    expect(result.statusCode).to.equal('failed');
  });
});
