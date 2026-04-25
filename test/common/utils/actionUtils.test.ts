import { expect } from 'chai';
import fs from 'fs-extra';
import * as yaml from 'js-yaml';
import * as os from 'os';
import * as path from 'path';
import {
  getActionConfigFilePath,
  readActions,
  writeActions,
  validateActionParameters,
  findActionById,
  buildAction,
} from '../../../src/common/utils/actionUtils.js';

describe('actionUtils', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sfdx-hardis-test-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.remove(tmpDir);
  });

  describe('getActionConfigFilePath', () => {
    it('returns project config path for project scope', async () => {
      const result = await getActionConfigFilePath('project');
      expect(result).to.equal(path.join('config', '.sfdx-hardis.yml'));
    });

    it('returns branch config path with specified branch', async () => {
      const result = await getActionConfigFilePath('branch', 'integration');
      expect(result).to.equal(path.join('config', 'branches', '.sfdx-hardis.integration.yml'));
    });

    it('returns PR config path with PR id', async () => {
      const result = await getActionConfigFilePath('pr', undefined, '42');
      expect(result).to.equal(path.join('scripts', 'actions', '.sfdx-hardis.42.yml'));
    });

    it('returns draft config path when no PR id', async () => {
      const result = await getActionConfigFilePath('pr');
      expect(result).to.equal(path.join('scripts', 'actions', '.sfdx-hardis.draft.yml'));
    });
  });

  describe('readActions', () => {
    it('returns empty array when file does not exist', async () => {
      const actions = await readActions('project', 'pre-deploy');
      expect(actions).to.deep.equal([]);
    });

    it('returns empty array when key is missing', async () => {
      const configFile = path.join(tmpDir, 'config', '.sfdx-hardis.yml');
      await fs.ensureDir(path.dirname(configFile));
      await fs.writeFile(configFile, yaml.dump({ someOtherKey: 'value' }));

      const actions = await readActions('project', 'pre-deploy');
      expect(actions).to.deep.equal([]);
    });

    it('reads commandsPreDeploy for pre-deploy', async () => {
      const configFile = path.join(tmpDir, 'config', '.sfdx-hardis.yml');
      await fs.ensureDir(path.dirname(configFile));
      const testActions = [{ id: 'test-1', label: 'Test', type: 'command', command: 'echo hello', context: 'all' }];
      await fs.writeFile(configFile, yaml.dump({ commandsPreDeploy: testActions }));

      const actions = await readActions('project', 'pre-deploy');
      expect(actions).to.have.lengthOf(1);
      expect(actions[0].id).to.equal('test-1');
    });

    it('reads commandsPostDeploy for post-deploy', async () => {
      const configFile = path.join(tmpDir, 'config', '.sfdx-hardis.yml');
      await fs.ensureDir(path.dirname(configFile));
      const testActions = [{ id: 'post-1', label: 'Post Test', type: 'manual', context: 'all', parameters: { instructions: 'Do something' } }];
      await fs.writeFile(configFile, yaml.dump({ commandsPostDeploy: testActions }));

      const actions = await readActions('project', 'post-deploy');
      expect(actions).to.have.lengthOf(1);
      expect(actions[0].id).to.equal('post-1');
    });
  });

  describe('writeActions', () => {
    it('creates file and directories when they do not exist', async () => {
      const actions = [{ id: 'new-1', label: 'New Action', type: 'command' as const, command: 'echo test', context: 'all' as const }];
      const configFile = await writeActions('project', 'pre-deploy', actions);

      expect(fs.existsSync(configFile)).to.be.true;
      const doc: any = yaml.load(fs.readFileSync(configFile, 'utf-8'));
      expect(doc.commandsPreDeploy).to.have.lengthOf(1);
      expect(doc.commandsPreDeploy[0].id).to.equal('new-1');
    });

    it('preserves other config keys in the file', async () => {
      const configFile = path.join(tmpDir, 'config', '.sfdx-hardis.yml');
      await fs.ensureDir(path.dirname(configFile));
      await fs.writeFile(configFile, yaml.dump({ targetUsername: 'admin@test.com', commandsPostDeploy: [] }));

      const actions = [{ id: 'act-1', label: 'Action', type: 'command' as const, command: 'echo x', context: 'all' as const }];
      await writeActions('project', 'pre-deploy', actions);

      const doc: any = yaml.load(fs.readFileSync(configFile, 'utf-8'));
      expect(doc.targetUsername).to.equal('admin@test.com');
      expect(doc.commandsPreDeploy).to.have.lengthOf(1);
      expect(doc.commandsPostDeploy).to.deep.equal([]);
    });

    it('writes to branch scope config file', async () => {
      const actions = [{ id: 'b-1', label: 'Branch Action', type: 'data' as const, command: '', context: 'all' as const }];
      const configFile = await writeActions('branch', 'post-deploy', actions, 'integration');

      expect(configFile).to.include('integration');
      const doc: any = yaml.load(fs.readFileSync(configFile, 'utf-8'));
      expect(doc.commandsPostDeploy).to.have.lengthOf(1);
    });

    it('writes to PR scope config file', async () => {
      const actions = [{ id: 'pr-1', label: 'PR Action', type: 'manual' as const, command: '', context: 'all' as const }];
      const configFile = await writeActions('pr', 'pre-deploy', actions, undefined, '99');

      expect(configFile).to.include('99');
      const doc: any = yaml.load(fs.readFileSync(configFile, 'utf-8'));
      expect(doc.commandsPreDeploy).to.have.lengthOf(1);
    });
  });

  describe('validateActionParameters', () => {
    it('returns no errors for valid command action', async () => {
      const errors = await validateActionParameters({ type: 'command', command: 'echo hello' });
      expect(errors).to.deep.equal([]);
    });

    it('returns error when command is missing for command type', async () => {
      const errors = await validateActionParameters({ type: 'command' });
      expect(errors).to.have.lengthOf(1);
    });

    it('returns error when apexScript is missing for apex type', async () => {
      const errors = await validateActionParameters({ type: 'apex', parameters: {} });
      expect(errors).to.have.lengthOf(1);
    });

    it('returns error when apexScript file does not exist', async () => {
      const errors = await validateActionParameters({ type: 'apex', parameters: { apexScript: '/nonexistent/script.apex' } });
      expect(errors).to.have.lengthOf(1);
    });

    it('returns error when instructions are missing for manual type', async () => {
      const errors = await validateActionParameters({ type: 'manual', parameters: {} });
      expect(errors).to.have.lengthOf(1);
    });

    it('returns no errors for valid manual action', async () => {
      const errors = await validateActionParameters({ type: 'manual', parameters: { instructions: 'Do this step' } });
      expect(errors).to.deep.equal([]);
    });

    it('returns error when communityName is missing for publish-community', async () => {
      const errors = await validateActionParameters({ type: 'publish-community', parameters: {} });
      expect(errors).to.have.lengthOf(1);
    });

    it('returns no errors for valid publish-community action', async () => {
      const errors = await validateActionParameters({ type: 'publish-community', parameters: { communityName: 'MyPortal' } });
      expect(errors).to.deep.equal([]);
    });

    it('returns errors when schedule-batch is missing both className and cronExpression', async () => {
      const errors = await validateActionParameters({ type: 'schedule-batch', parameters: {} });
      expect(errors).to.have.lengthOf(2);
    });

    it('returns no errors for valid schedule-batch action', async () => {
      const errors = await validateActionParameters({ type: 'schedule-batch', parameters: { className: 'MyBatch', cronExpression: '0 0 * * *' } });
      expect(errors).to.deep.equal([]);
    });
  });

  describe('findActionById', () => {
    const actions = [
      { id: 'a1', label: 'First', type: 'command' as const, command: 'echo 1', context: 'all' as const },
      { id: 'a2', label: 'Second', type: 'command' as const, command: 'echo 2', context: 'all' as const },
    ];

    it('finds action by ID and returns index', () => {
      const result = findActionById(actions, 'a2');
      expect(result.action.label).to.equal('Second');
      expect(result.index).to.equal(1);
    });

    it('throws when action ID is not found', () => {
      expect(() => findActionById(actions, 'nonexistent')).to.throw();
    });
  });

  describe('buildAction', () => {
    it('builds a command action with all fields', () => {
      const action = buildAction({
        id: 'test-id',
        label: 'Test Action',
        type: 'command',
        command: 'echo hello',
        context: 'all',
        skipIfError: true,
        allowFailure: false,
        runOnlyOnceByOrg: true,
        customUsername: 'admin@test.com',
        parameters: {},
      });

      expect(action.id).to.equal('test-id');
      expect(action.label).to.equal('Test Action');
      expect(action.type).to.equal('command');
      expect(action.command).to.equal('echo hello');
      expect(action.skipIfError).to.be.true;
      expect(action.runOnlyOnceByOrg).to.be.true;
      expect(action.customUsername).to.equal('admin@test.com');
    });

    it('omits optional fields when false/empty', () => {
      const action = buildAction({
        id: 'test-id',
        label: 'Test Action',
        type: 'manual',
        parameters: { instructions: 'Do something' },
      });

      expect(action.skipIfError).to.be.undefined;
      expect(action.allowFailure).to.be.undefined;
      expect(action.runOnlyOnceByOrg).to.be.undefined;
      expect(action.customUsername).to.be.undefined;
      expect(action.parameters).to.deep.equal({ instructions: 'Do something' });
    });
  });
});
