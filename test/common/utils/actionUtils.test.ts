import { expect } from 'chai';
import fs from '../../../src/common/utils/fsUtils.js';
import * as yaml from 'js-yaml';
import * as path from 'path';
import {
  getActionConfigFilePath,
  readActions,
  writeActions,
  validateActionParameters,
  findActionById,
  buildAction,
  applyBranchFilterFlagsToAction,
  buildActionTargetBranchCandidates,
  evaluateActionBranchFilter,
  normalizeBranchName,
  parseBranchListFlag,
  DEV_SANDBOXES_BRANCH_NAME,
} from '../../../src/common/utils/actionUtils.js';
import { setupTmpDir } from './actionTestHelper.js';

describe('actionUtils', () => {
  const ctx = setupTmpDir('sfdx-hardis-test');

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
      const configFile = path.join(ctx.getDir(), 'config', '.sfdx-hardis.yml');
      await fs.ensureDir(path.dirname(configFile));
      await fs.writeFile(configFile, yaml.dump({ someOtherKey: 'value' }));

      const actions = await readActions('project', 'pre-deploy');
      expect(actions).to.deep.equal([]);
    });

    it('reads commandsPreDeploy for pre-deploy', async () => {
      const configFile = path.join(ctx.getDir(), 'config', '.sfdx-hardis.yml');
      await fs.ensureDir(path.dirname(configFile));
      const testActions = [{ id: 'test-1', label: 'Test', type: 'command', command: 'echo hello', context: 'all' }];
      await fs.writeFile(configFile, yaml.dump({ commandsPreDeploy: testActions }));

      const actions = await readActions('project', 'pre-deploy');
      expect(actions).to.have.lengthOf(1);
      expect(actions[0].id).to.equal('test-1');
    });

    it('reads commandsPostDeploy for post-deploy', async () => {
      const configFile = path.join(ctx.getDir(), 'config', '.sfdx-hardis.yml');
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

      expect(fs.existsSync(configFile)).to.equal(true);
      const doc: any = yaml.load(fs.readFileSync(configFile, 'utf-8'));
      expect(doc.commandsPreDeploy).to.have.lengthOf(1);
      expect(doc.commandsPreDeploy[0].id).to.equal('new-1');
    });

    it('preserves other config keys in the file', async () => {
      const configFile = path.join(ctx.getDir(), 'config', '.sfdx-hardis.yml');
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

    it('returns error when packageXmlItems is missing for remove-packagexml-items type', async () => {
      const errors = await validateActionParameters({ type: 'remove-packagexml-items', parameters: {} });
      expect(errors).to.have.lengthOf(1);
    });

    it('returns error when packageXmlItems entries have an invalid format', async () => {
      const errors = await validateActionParameters({
        type: 'remove-packagexml-items',
        parameters: { packageXmlItems: ['ApexClass:MyClass1', 'NoColonHere'] },
      });
      expect(errors).to.have.lengthOf(1);
    });

    it('returns error when remove-packagexml-items action is post-deploy', async () => {
      const errors = await validateActionParameters({
        type: 'remove-packagexml-items',
        when: 'post-deploy',
        parameters: { packageXmlItems: ['ApexClass:MyClass1'] },
      });
      expect(errors).to.have.lengthOf(1);
    });

    it('returns no errors for valid remove-packagexml-items action', async () => {
      const errors = await validateActionParameters({
        type: 'remove-packagexml-items',
        when: 'pre-deploy',
        parameters: { packageXmlItems: ['ApexClass:MyClass1,MyClass3', 'Layout:MyLayout1,MyLayout2,MyLayout3'] },
      });
      expect(errors).to.deep.equal([]);
    });

    it('returns error when both branch filter lists are set', async () => {
      const errors = await validateActionParameters({
        type: 'command',
        command: 'echo hello',
        includeTargetBranches: ['uat'],
        excludeTargetBranches: ['main'],
      });
      expect(errors).to.have.lengthOf(1);
    });

    it('returns no error when only one branch filter list is set', async () => {
      const errors = await validateActionParameters({
        type: 'command',
        command: 'echo hello',
        includeTargetBranches: ['uat'],
      });
      expect(errors).to.deep.equal([]);
    });
  });

  describe('normalizeBranchName', () => {
    it('lowercases, trims and collapses slashes to the config file form', () => {
      expect(normalizeBranchName('  UAT ')).to.equal('uat');
      expect(normalizeBranchName('feature/JIRA-123')).to.equal('feature__jira-123');
      expect(normalizeBranchName('feature__JIRA-123')).to.equal('feature__jira-123');
    });

    it('tolerates empty values', () => {
      expect(normalizeBranchName('')).to.equal('');
      expect(normalizeBranchName(undefined as any)).to.equal('');
    });
  });

  describe('parseBranchListFlag', () => {
    it('splits on commas and drops blanks', () => {
      expect(parseBranchListFlag(' uat , preprod ,, ')).to.deep.equal(['uat', 'preprod']);
    });

    it('returns an empty array for an empty or missing value', () => {
      expect(parseBranchListFlag('')).to.deep.equal([]);
      expect(parseBranchListFlag(undefined as any)).to.deep.equal([]);
    });
  });

  describe('applyBranchFilterFlagsToAction', () => {
    it('leaves the action untouched when neither flag is passed', () => {
      const action: any = { includeTargetBranches: ['uat'] };
      applyBranchFilterFlagsToAction(action, undefined, undefined);
      expect(action.includeTargetBranches).to.deep.equal(['uat']);
      expect(action.excludeTargetBranches).to.equal(undefined);
    });

    // The two lists are mutually exclusive: switching mode must be a single flag, otherwise
    // --include-target-branches on an excluded action would fail the mutual-exclusion validation
    it('clears the opposite list when one is set', () => {
      const action: any = { excludeTargetBranches: ['main'] };
      applyBranchFilterFlagsToAction(action, 'uat,preprod', undefined);
      expect(action.includeTargetBranches).to.deep.equal(['uat', 'preprod']);
      expect(action.excludeTargetBranches).to.equal(undefined);

      const otherAction: any = { includeTargetBranches: ['uat'] };
      applyBranchFilterFlagsToAction(otherAction, undefined, 'main');
      expect(otherAction.excludeTargetBranches).to.deep.equal(['main']);
      expect(otherAction.includeTargetBranches).to.equal(undefined);
    });

    it('removes the restriction when an empty value is passed', () => {
      const action: any = { includeTargetBranches: ['uat'] };
      applyBranchFilterFlagsToAction(action, '', undefined);
      expect(action.includeTargetBranches).to.equal(undefined);
    });

    // Passing both is a configuration error: keep both so validateActionParameters reports it
    // instead of silently honouring one of them
    it('keeps both lists when both flags are passed, so validation can reject it', () => {
      const action: any = {};
      applyBranchFilterFlagsToAction(action, 'uat', 'main');
      expect(action.includeTargetBranches).to.deep.equal(['uat']);
      expect(action.excludeTargetBranches).to.deep.equal(['main']);
    });
  });

  describe('buildActionTargetBranchCandidates', () => {
    const majorBranches = ['main', 'preprod', 'uat', 'integration'];

    it('does not add the dev-sandboxes alias for a major branch', () => {
      expect(buildActionTargetBranchCandidates('uat', majorBranches)).to.deep.equal(['uat']);
    });

    it('adds the dev-sandboxes alias for a branch that is not major', () => {
      expect(buildActionTargetBranchCandidates('feature/JIRA-123', majorBranches))
        .to.deep.equal(['feature/JIRA-123', DEV_SANDBOXES_BRANCH_NAME]);
    });

    it('compares major branch names case-insensitively', () => {
      expect(buildActionTargetBranchCandidates('UAT', majorBranches)).to.deep.equal(['UAT']);
    });

    it('treats every target as a developer sandbox when no major branch is declared', () => {
      expect(buildActionTargetBranchCandidates('main', [])).to.deep.equal(['main', DEV_SANDBOXES_BRANCH_NAME]);
    });
  });

  describe('evaluateActionBranchFilter', () => {
    it('runs the action when no filter is set', () => {
      expect(evaluateActionBranchFilter({}, ['uat']).run).to.equal(true);
    });

    // A leftover empty list must not silently disable an action everywhere
    it('runs the action when the filter lists are empty', () => {
      expect(evaluateActionBranchFilter({ includeTargetBranches: [], excludeTargetBranches: [] }, ['uat']).run).to.equal(true);
      expect(evaluateActionBranchFilter({ includeTargetBranches: ['  '] }, ['uat']).run).to.equal(true);
    });

    it('runs an included action on a listed branch', () => {
      expect(evaluateActionBranchFilter({ includeTargetBranches: ['uat', 'preprod'] }, ['uat']).run).to.equal(true);
    });

    it('skips an included action on an unlisted branch and reports both sides', () => {
      const verdict = evaluateActionBranchFilter({ includeTargetBranches: ['uat', 'preprod'] }, ['main']);
      expect(verdict.run).to.equal(false);
      expect(verdict.invalid).to.equal(undefined);
      expect(verdict.reason).to.contain('uat, preprod');
      expect(verdict.reason).to.contain('main');
    });

    it('skips an excluded action on a listed branch', () => {
      const verdict = evaluateActionBranchFilter({ excludeTargetBranches: ['main'] }, ['main']);
      expect(verdict.run).to.equal(false);
      expect(verdict.reason).to.contain('main');
    });

    it('runs an excluded action on an unlisted branch', () => {
      expect(evaluateActionBranchFilter({ excludeTargetBranches: ['main'] }, ['uat']).run).to.equal(true);
    });

    it('matches branch names ignoring case, whitespace and slash form', () => {
      expect(evaluateActionBranchFilter({ includeTargetBranches: [' UAT '] }, ['uat']).run).to.equal(true);
      expect(evaluateActionBranchFilter({ includeTargetBranches: ['feature__JIRA-123'] }, ['feature/JIRA-123']).run).to.equal(true);
    });

    it('matches the dev-sandboxes alias carried by the candidates', () => {
      const candidates = ['feature/JIRA-123', DEV_SANDBOXES_BRANCH_NAME];
      expect(evaluateActionBranchFilter({ includeTargetBranches: ['dev-sandboxes'] }, candidates).run).to.equal(true);
      expect(evaluateActionBranchFilter({ excludeTargetBranches: ['dev-sandboxes'] }, candidates).run).to.equal(false);
      expect(evaluateActionBranchFilter({ excludeTargetBranches: ['dev-sandboxes'] }, ['uat']).run).to.equal(true);
    });

    it('reports the real target branch rather than the dev-sandboxes alias', () => {
      const verdict = evaluateActionBranchFilter({ includeTargetBranches: ['uat'] }, ['feature/JIRA-123', DEV_SANDBOXES_BRANCH_NAME]);
      expect(verdict.reason).to.contain('feature/JIRA-123');
    });

    it('flags an action defining both lists as invalid', () => {
      const verdict = evaluateActionBranchFilter({ includeTargetBranches: ['uat'], excludeTargetBranches: ['main'] }, ['uat']);
      expect(verdict.run).to.equal(false);
      expect(verdict.invalid).to.equal(true);
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
        allowFailure: false,
        runOnlyOnceByOrg: true,
        customUsername: 'admin@test.com',
        parameters: {},
      });

      expect(action.id).to.equal('test-id');
      expect(action.label).to.equal('Test Action');
      expect(action.type).to.equal('command');
      expect(action.command).to.equal('echo hello');
      expect(action.runOnlyOnceByOrg).to.equal(true);
      expect(action.customUsername).to.equal('admin@test.com');
    });

    it('defaults boolean fields when not provided', () => {
      const action = buildAction({
        id: 'test-id',
        label: 'Test Action',
        type: 'manual',
        parameters: { instructions: 'Do something' },
      });

      expect(action.allowFailure).to.equal(false);
      expect(action.runOnlyOnceByOrg).to.equal(true);
      expect(action.customUsername).to.equal(undefined);
      // No branch filter set: the properties must not be written to the YAML at all
      expect(action.includeTargetBranches).to.equal(undefined);
      expect(action.excludeTargetBranches).to.equal(undefined);
    });

    it('keeps a branch filter and ignores the empty one', () => {
      const action = buildAction({
        id: 'test-id',
        label: 'Test Action',
        type: 'command',
        command: 'echo hello',
        includeTargetBranches: ['uat', 'preprod'],
        excludeTargetBranches: [],
      });

      expect(action.includeTargetBranches).to.deep.equal(['uat', 'preprod']);
      expect(action.excludeTargetBranches).to.equal(undefined);
    });

    it('persists runOnlyOnceByOrg as false when explicitly set to false', () => {
      const action = buildAction({
        id: 'test-id',
        label: 'Test Action',
        type: 'command',
        command: 'echo hello',
        runOnlyOnceByOrg: false,
      });

      expect(action.runOnlyOnceByOrg).to.equal(false);
    });
  });
});
