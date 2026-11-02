import { expect } from 'chai';
import { execSync } from 'child_process';
import * as path from 'path';
import * as yaml from 'js-yaml';
import fs from '../../../../../src/common/utils/fsUtils.js';
import CleanAgentsDeploymentActions from '../../../../../src/commands/hardis/project/clean/agents-deployment-actions.js';
import { upsertAgentPublishAction, upsertAgentRunningUserAction } from '../../../../../src/common/utils/agentUtils.js';
import { PrePostCommand } from '../../../../../src/common/actionsProvider/actionsProvider.js';

/**
 * The throwaway project lives under the repository, not under the OS temp folder: the command runs with
 * the process cwd set to it, and a cwd without a reachable node_modules breaks the tsx loader.
 * The hooks MUST stay inside the describe blocks: file level hooks would run for the whole suite.
 */

describe('agentUtils.upsertAgentPublishAction', () => {
  it('adds a post-deployment action that runs once by org, once per agent', () => {
    const actions: PrePostCommand[] = [];
    upsertAgentPublishAction(actions, 'My_Agent', () => 'id-1');
    upsertAgentPublishAction(actions, 'my_agent', () => 'id-2');
    expect(actions).to.deep.equal([
      {
        id: 'id-1',
        label: 'Publish agent My_Agent and activate the new version',
        type: 'agent-publish',
        command: '',
        context: 'process-deployment-only',
        parameters: { agentName: 'My_Agent' },
        allowFailure: false,
        runOnlyOnceByOrg: true,
      },
    ]);
  });

  it('keeps an action already there as it is', () => {
    const existing: PrePostCommand = {
      id: 'kept-id',
      label: 'Mine',
      type: 'agent-publish',
      command: '',
      context: 'process-deployment-only',
      parameters: { agentName: 'My_Agent' },
      runOnlyOnceByOrg: false,
    };
    const actions: PrePostCommand[] = [existing];
    expect(upsertAgentPublishAction(actions, 'My_Agent', () => 'new-id')).to.equal(existing);
    expect(actions).to.have.lengthOf(1);
    expect(actions[0].runOnlyOnceByOrg).to.equal(false);
  });
});

describe('agentUtils.upsertAgentRunningUserAction', () => {
  it('adds a pre-deployment action that also runs in the deployment checks, once per agent', () => {
    const actions: PrePostCommand[] = [];
    upsertAgentRunningUserAction(actions, 'My_Agent', () => 'id-1');
    upsertAgentRunningUserAction(actions, 'my_agent', () => 'id-2');
    expect(actions).to.deep.equal([
      {
        id: 'id-1',
        label: 'Create the running user of agent My_Agent when the org has none',
        type: 'agent-running-user',
        command: '',
        context: 'all',
        parameters: { agentName: 'My_Agent' },
        allowFailure: false,
        runOnlyOnceByOrg: false,
      },
    ]);
  });
});

describe('hardis:project:clean:agents-deployment-actions', () => {
  const tmpRoot = path.join(process.cwd(), 'tmp');
  let tmpDir = '';
  let previousCwd = '';
  let previousCi: string | undefined;

  async function writeBundle(bundleName: string, agentUser?: string): Promise<void> {
    const folder = path.join(tmpDir, 'force-app', 'main', 'default', 'aiAuthoringBundles', bundleName);
    await fs.ensureDir(folder);
    const access = agentUser ? `access:\n    default_agent_user: "${agentUser}"\n` : '';
    await fs.writeFile(path.join(folder, `${bundleName}.agent`), `config:\n    developer_name: "${bundleName}"\n${access}`);
    await fs.writeFile(path.join(folder, `${bundleName}.bundle-meta.xml`), '<AiAuthoringBundle><bundleType>AGENT</bundleType></AiAuthoringBundle>');
  }

  beforeEach(async () => {
    tmpDir = path.join(tmpRoot, `hardis-agent-actions-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.ensureDir(tmpDir);
    await fs.writeJson(path.join(tmpDir, 'sfdx-project.json'), {
      packageDirectories: [{ path: 'force-app', default: true }],
      namespace: '',
      sfdcLoginUrl: 'https://login.salesforce.com',
      sourceApiVersion: '68.0',
    });
    previousCwd = process.cwd();
    process.chdir(tmpDir);
    // No git provider: the Pull Request is not found, the actions go to the draft file
    previousCi = process.env.CI;
    process.env.CI = 'true';
    execSync('git init -q && git config user.email test@example.com && git config user.name test', { cwd: tmpDir });
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    if (previousCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = previousCi;
    }
    await fs.remove(tmpDir);
  });

  it('writes the actions of the agents whose bundle changed in the draft file', async () => {
    await writeBundle('Old_Agent');
    execSync('git add -A && git commit -q -m init', { cwd: tmpDir });
    await writeBundle('Story_Agent', 'story_agent@source.ext');
    // The bundle of a version is not the one the project publishes
    await writeBundle('Other_Agent_2');
    await CleanAgentsDeploymentActions.run(['--delta-from', 'HEAD', '--agent']);

    const draft: any = yaml.load(await fs.readFile(path.join(tmpDir, 'scripts', 'actions', '.sfdx-hardis.draft.yml'), 'utf8'));
    expect(draft.commandsPostDeploy.map((action: any) => [action.type, action.parameters.agentName, action.runOnlyOnceByOrg])).to.deep.equal([
      ['agent-publish', 'Story_Agent', true],
    ]);
    expect(draft.commandsPreDeploy.map((action: any) => [action.type, action.parameters.agentName, action.context])).to.deep.equal([
      ['agent-running-user', 'Story_Agent', 'all'],
    ]);
    expect(fs.existsSync(path.join(tmpDir, 'manifest', 'package-no-overwrite.xml'))).to.equal(false);
  });

  it('handles a change of a bundle already committed', async () => {
    await writeBundle('Story_Agent');
    execSync('git add -A && git commit -q -m init', { cwd: tmpDir });
    const scriptFile = path.join(tmpDir, 'force-app', 'main', 'default', 'aiAuthoringBundles', 'Story_Agent', 'Story_Agent.agent');
    await fs.writeFile(scriptFile, (await fs.readFile(scriptFile, 'utf8')) + 'system:\n    instructions: "Changed"\n');
    await CleanAgentsDeploymentActions.run(['--agent']);
    const draft: any = yaml.load(await fs.readFile(path.join(tmpDir, 'scripts', 'actions', '.sfdx-hardis.draft.yml'), 'utf8'));
    expect(draft.commandsPostDeploy.map((action: any) => action.parameters.agentName)).to.deep.equal(['Story_Agent']);
    expect(draft.commandsPreDeploy || []).to.deep.equal([]);
  });

  it('writes nothing when no agent bundle changed', async () => {
    await writeBundle('Old_Agent');
    execSync('git add -A && git commit -q -m init', { cwd: tmpDir });
    await CleanAgentsDeploymentActions.run(['--delta-from', 'HEAD', '--agent']);
    expect(fs.existsSync(path.join(tmpDir, 'scripts', 'actions', '.sfdx-hardis.draft.yml'))).to.equal(false);
  });
});
