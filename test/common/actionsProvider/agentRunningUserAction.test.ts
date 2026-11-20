import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import { AgentRunningUserAction } from '../../../src/common/actionsProvider/agentRunningUserAction.js';
import { PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';

function buildAction(parameters: Record<string, any>): PrePostCommand {
  return { id: 'id-1', label: 'Running user', type: 'agent-running-user', command: '', context: 'all', parameters } as PrePostCommand;
}

describe('AgentRunningUserAction', () => {
  it('runs before the deployment only', () => {
    expect(new AgentRunningUserAction().getAllowedWhen()).to.deep.equal(['pre-deploy']);
  });

  it('requires a valid agent API name', async () => {
    const action = new AgentRunningUserAction();
    expect(await action.getDefinitionErrors(buildAction({}))).to.have.length(1);
    expect(await action.getDefinitionErrors(buildAction({ agentName: 'My Agent; rm' }))).to.have.length(1);
    expect(await action.getDefinitionErrors(buildAction({ agentName: 'My_Agent' }))).to.deep.equal([]);
  });

  it('identifies the action by its agent, whatever the case', () => {
    expect(new AgentRunningUserAction().getIdentityParameters(buildAction({ agentName: 'My_Agent' }))).to.deep.equal({ agentName: 'my_agent' });
  });

  it('succeeds without reading the org when the agent runs as no user in the project', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-running-user-action-'));
    const previousCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const result = await new AgentRunningUserAction().run(buildAction({ agentName: 'My_Agent' }));
      expect(result.statusCode).to.equal('success');
    } finally {
      process.chdir(previousCwd);
      await fs.remove(tmpDir);
    }
  });
});
