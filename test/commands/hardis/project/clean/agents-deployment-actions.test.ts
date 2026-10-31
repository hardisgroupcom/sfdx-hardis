import { expect } from 'chai';
import { execSync } from 'child_process';
import * as path from 'path';
import * as yaml from 'js-yaml';
import fs from '../../../../../src/common/utils/fsUtils.js';
import CleanAgentsDeploymentActions from '../../../../../src/commands/hardis/project/clean/agents-deployment-actions.js';
import { listPackageNoOverwriteFiles, upsertAgentActivateAction, upsertAgentRunningUserAction } from '../../../../../src/common/utils/agentUtils.js';
import { parsePackageXmlFile } from '../../../../../src/common/utils/xmlUtils.js';
import { PrePostCommand } from '../../../../../src/common/actionsProvider/actionsProvider.js';

/**
 * The throwaway project lives under the repository, not under the OS temp folder: the command runs with
 * the process cwd set to it, and a cwd without a reachable node_modules breaks the tsx loader.
 * The hooks MUST stay inside the describe blocks: file level hooks would run for the whole suite.
 */

describe('agentUtils.upsertAgentActivateAction', () => {
  it('adds an action that activates the version saved with the User Story, with an English label', () => {
    const actions: PrePostCommand[] = [];
    upsertAgentActivateAction(actions, 'My_Agent', 3, () => 'id-1');
    expect(actions).to.deep.equal([
      {
        id: 'id-1',
        label: 'Activate agent My_Agent version 3',
        type: 'agent-activate',
        command: '',
        context: 'process-deployment-only',
        parameters: { agentName: 'My_Agent', agentVersion: '3' },
        allowFailure: false,
        runOnlyOnceByOrg: false,
      },
    ]);
  });

  it('updates the action already there for the agent, and keeps its id and the other actions', () => {
    const other = { id: 'other', label: 'Other', type: 'command', command: 'echo', context: 'all' } as PrePostCommand;
    const actions: PrePostCommand[] = [
      other,
      { id: 'kept-id', label: 'Old', type: 'agent-activate', command: '', context: 'process-deployment-only', parameters: { agentName: 'my_agent', agentVersion: '2' }, excludeTargetBranches: ['main'] } as any,
    ];
    upsertAgentActivateAction(actions, 'My_Agent', 4, () => 'new-id');
    expect(actions).to.have.length(2);
    expect(actions[0]).to.equal(other);
    expect(actions[1].id).to.equal('kept-id');
    expect(actions[1].parameters).to.deep.equal({ agentName: 'My_Agent', agentVersion: '4' });
    expect(actions[1].label).to.equal('Activate agent My_Agent version 4');
    expect((actions[1] as any).excludeTargetBranches).to.deep.equal(['main']);
  });

  it('keeps latest when the action was set to latest by hand', () => {
    const actions: PrePostCommand[] = [{ id: 'kept-id', label: 'Old', type: 'agent-activate', command: '', context: 'process-deployment-only', parameters: { agentName: 'My_Agent', agentVersion: 'latest' } }];
    upsertAgentActivateAction(actions, 'My_Agent', 5, () => 'new-id');
    expect(actions[0].parameters).to.deep.equal({ agentName: 'My_Agent', agentVersion: 'latest' });
    expect(actions[0].label).to.equal('Activate agent My_Agent, latest version');
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

  async function writeVersion(fullName: string): Promise<void> {
    const folder = path.join(tmpDir, 'force-app', 'main', 'default', 'aiAgentDefinitionVersions', fullName);
    await fs.ensureDir(folder);
    await fs.writeFile(path.join(folder, `${fullName}.aiAgentDefinitionVersion-meta.xml`), '<AiAgentDefinitionVersion/>');
  }

  async function writeDefinition(agentName: string, botUser: string): Promise<void> {
    const folder = path.join(tmpDir, 'force-app', 'main', 'default', 'aiAgents');
    await fs.ensureDir(folder);
    await fs.writeFile(path.join(folder, `${agentName}.aiAgentDefinition-meta.xml`), `<AiAgentDefinition><botUser>${botUser}</botUser></AiAgentDefinition>`);
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

  it('writes the actions of the changed agents in the draft file, and protects the versions in package-no-overwrite.xml', async () => {
    await writeVersion('Old_Agent#1');
    execSync('git add -A && git commit -q -m init', { cwd: tmpDir });
    await writeVersion('Story_Agent#1');
    await writeVersion('Story_Agent#2');
    await writeDefinition('Story_Agent', 'story_agent@source.ext');
    await CleanAgentsDeploymentActions.run(['--delta-from', 'HEAD', '--agent']);

    const draft: any = yaml.load(await fs.readFile(path.join(tmpDir, 'scripts', 'actions', '.sfdx-hardis.draft.yml'), 'utf8'));
    expect(draft.commandsPostDeploy.map((action: any) => [action.type, action.parameters.agentName, action.parameters.agentVersion])).to.deep.equal([
      ['agent-activate', 'Story_Agent', '2'],
    ]);
    expect(draft.commandsPreDeploy.map((action: any) => [action.type, action.parameters.agentName, action.context])).to.deep.equal([
      ['agent-running-user', 'Story_Agent', 'all'],
    ]);
    expect((await parsePackageXmlFile(path.join(tmpDir, 'manifest', 'package-no-overwrite.xml'))).AiAgentDefinitionVersion).to.deep.equal(['*']);
  });

  it('without --delta-from, only handles the versions not committed yet', async () => {
    await writeVersion('Old_Agent#1');
    execSync('git add -A && git commit -q -m init', { cwd: tmpDir });
    await writeVersion('New_Agent#1');
    await CleanAgentsDeploymentActions.run(['--agent']);
    const draft: any = yaml.load(await fs.readFile(path.join(tmpDir, 'scripts', 'actions', '.sfdx-hardis.draft.yml'), 'utf8'));
    expect(draft.commandsPostDeploy.map((action: any) => action.parameters.agentName)).to.deep.equal(['New_Agent']);
    expect(draft.commandsPreDeploy || []).to.deep.equal([]);
  });

  it('writes nothing when no agent version changed', async () => {
    await writeVersion('Old_Agent#1');
    execSync('git add -A && git commit -q -m init', { cwd: tmpDir });
    await CleanAgentsDeploymentActions.run(['--delta-from', 'HEAD', '--agent']);
    expect(fs.existsSync(path.join(tmpDir, 'scripts', 'actions', '.sfdx-hardis.draft.yml'))).to.equal(false);
    expect(fs.existsSync(path.join(tmpDir, 'manifest', 'package-no-overwrite.xml'))).to.equal(false);
  });

  it('lists the default package-no-overwrite.xml and the files of the branch configs', async () => {
    await fs.ensureDir(path.join(tmpDir, 'config', 'branches'));
    await fs.writeFile(path.join(tmpDir, 'config', '.sfdx-hardis.yml'), 'projectName: test\n');
    await fs.writeFile(path.join(tmpDir, 'config', 'branches', '.sfdx-hardis.main.yml'), 'packageNoOverwritePath: manifest/package-no-overwrite-main.xml\n');
    await fs.writeFile(path.join(tmpDir, 'config', 'branches', '.sfdx-hardis.uat.yml'), 'mergeTargets: [main]\n');
    await fs.writeFile(path.join(tmpDir, 'config', 'branches', '.sfdx-hardis.preprod.yaml'), 'packageNoOverwritePath: manifest/package-no-overwrite-preprod.xml\n');
    expect(await listPackageNoOverwriteFiles(tmpDir)).to.deep.equal([
      path.join('manifest', 'package-no-overwrite-main.xml'),
      path.join('manifest', 'package-no-overwrite-preprod.xml'),
      path.join('manifest', 'package-no-overwrite.xml'),
    ]);
  });

  it('leaves the default file out when the project config points to another one', async () => {
    await fs.ensureDir(path.join(tmpDir, 'config'));
    await fs.writeFile(path.join(tmpDir, 'config', '.sfdx-hardis.yml'), 'packageNoOverwritePath: manifest/custom.xml\n');
    expect(await listPackageNoOverwriteFiles(tmpDir)).to.deep.equal([path.join('manifest', 'custom.xml')]);
  });
});
