import { expect } from 'chai';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import { ActionsProvider, PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';
import { ACTION_TYPES, validateActionParameters } from '../../../src/common/utils/actionUtils.js';
import { isBuiltInActionType, validateCustomFunctionDefinition } from '../../../src/common/utils/customFunctionUtils.js';
import { runSingleDeploymentAction, SingleActionRunContext } from '../../../src/common/utils/prePostCommandUtils.js';
import {
  buildLegacyOrgInitSteps,
  checkOrgInitSteps,
  getOrgInitSteps,
  getScratchOrgDefHints,
  normalizeOrgInitStep,
  runOrgInitSteps,
  selectOrgInitSteps,
  validateScratchOrgDef,
} from '../../../src/common/utils/orgInitUtils.js';
import { setupTmpDir } from './actionTestHelper.js';

describe('orgInitUtils', () => {
  setupTmpDir('sfdx-hardis-org-init');

  describe('getOrgInitSteps', () => {
    it('reads orgInitSteps when the key exists, and reports the older keys still present', () => {
      const info = getOrgInitSteps({
        orgInitSteps: [{ id: 'a', label: 'A', type: 'command', command: 'echo a' }],
        initPermissionSets: ['PS_Admin'],
      });
      expect(info.source).to.equal('orgInitSteps');
      expect(info.steps.map((step) => step.id)).to.deep.equal(['a']);
      expect(info.legacyKeys).to.deep.equal(['initPermissionSets']);
    });

    it('builds the list from the older keys when orgInitSteps is absent', () => {
      const info = getOrgInitSteps({ initPermissionSets: ['PS_Admin'] });
      expect(info.source).to.equal('legacy');
      expect(info.steps.map((step) => step.id)).to.deep.equal([
        'legacy-install-packages',
        'legacy-deploy-sources',
        'legacy-permission-sets',
      ]);
    });
  });

  describe('buildLegacyOrgInitSteps', () => {
    it('keeps the order scratch:create and sandbox creation used to run', async () => {
      await fs.ensureDir(path.join('scripts', 'data', 'ScratchInit'));
      await fs.ensureDir(path.join('scripts', 'data', 'SandboxInit'));
      const steps = buildLegacyOrgInitSteps({
        initPermissionSets: [{ name: 'PS_Admin' }, 'PS_Other'],
        scratchOrgInitApexScripts: ['scripts/apex/init-scratch.apex'],
        sandboxOrgInitApexScripts: ['scripts/apex/init-sandbox.apex'],
        dataPackages: [
          { dataPath: 'scripts/data/Accounts', importInSandboxOrgs: true },
          { dataPath: 'scripts/data/NotImported', importInSandboxOrgs: false },
          { dataPath: 'other/Folder', importInSandboxOrgs: true },
        ],
      });
      expect(steps.map((step) => [step.id, step.type, step.orgTypes])).to.deep.equal([
        ['legacy-install-packages', 'install-packages', ['scratch']],
        ['legacy-deploy-sources', 'deploy-sources', ['scratch']],
        ['legacy-permission-sets', 'assign-permission-sets', ['scratch', 'sandbox']],
        ['legacy-scratch-apex-1', 'apex', ['scratch']],
        ['legacy-sandbox-apex-1', 'apex', ['sandbox']],
        ['legacy-data-scratchinit', 'data', ['scratch']],
        ['legacy-data-sandboxinit', 'data', ['sandbox']],
        ['legacy-data-package-1', 'data', ['scratch', 'sandbox']],
        ['legacy-data-package-2', 'data', ['scratch', 'sandbox']],
      ]);
      expect(steps[2].parameters?.permissionSets).to.deep.equal(['PS_Admin', 'PS_Other']);
      // A failed assignment used to be logged without stopping the initialization
      expect(steps[2].allowFailure).to.equal(true);
      expect(steps[7].parameters?.sfdmuProject).to.equal('Accounts');
      expect(steps[8].parameters?.sfdmuProject).to.equal('other/Folder');
      // Every step runs when the pool is filled, so an org taken from the pool is ready
      expect(steps.every((step) => step.runAtPoolFill === true)).to.equal(true);
    });

    it('skips the data folders that do not exist', () => {
      const steps = buildLegacyOrgInitSteps({});
      expect(steps.map((step) => step.id)).to.deep.equal(['legacy-install-packages', 'legacy-deploy-sources']);
    });
  });

  describe('normalizeOrgInitStep', () => {
    it('fills the defaults', () => {
      const step = normalizeOrgInitStep({ id: 'x', type: 'apex' });
      expect(step.enabled).to.equal(true);
      expect(step.allowFailure).to.equal(false);
      expect(step.runAtPoolFill).to.equal(true);
      expect(step.orgTypes).to.deep.equal(['scratch', 'sandbox']);
      expect(step.label).to.equal('x');
    });

    it('keeps explicit values and drops unknown org types', () => {
      const step = normalizeOrgInitStep({ id: 'x', type: 'apex', enabled: false, runAtPoolFill: false, orgTypes: ['sandbox', 'production' as any] });
      expect(step.enabled).to.equal(false);
      expect(step.runAtPoolFill).to.equal(false);
      expect(step.orgTypes).to.deep.equal(['sandbox']);
    });
  });

  describe('selectOrgInitSteps', () => {
    const steps = [
      normalizeOrgInitStep({ id: 'both', type: 'command' }),
      normalizeOrgInitStep({ id: 'scratch-only', type: 'command', orgTypes: ['scratch'] }),
      normalizeOrgInitStep({ id: 'at-fetch', type: 'command', runAtPoolFill: false }),
      normalizeOrgInitStep({ id: 'disabled', type: 'command', enabled: false }),
    ];
    const ids = (selected: PrePostCommand[]) => selected.map((step) => step.id);

    it('filters by org type and skips disabled steps', () => {
      expect(ids(selectOrgInitSteps(steps, { orgType: 'scratch', phase: 'all' }))).to.deep.equal(['both', 'scratch-only', 'at-fetch']);
      expect(ids(selectOrgInitSteps(steps, { orgType: 'sandbox', phase: 'all' }))).to.deep.equal(['both', 'at-fetch']);
    });

    it('splits the steps between pool fill and pool fetch', () => {
      expect(ids(selectOrgInitSteps(steps, { orgType: 'scratch', phase: 'pool-fill' }))).to.deep.equal(['both', 'scratch-only']);
      expect(ids(selectOrgInitSteps(steps, { orgType: 'scratch', phase: 'after-pool-fetch' }))).to.deep.equal(['at-fetch']);
    });

    it('keeps only the requested step ids', () => {
      expect(ids(selectOrgInitSteps(steps, { orgType: 'scratch', phase: 'all', stepIds: ['at-fetch'] }))).to.deep.equal(['at-fetch']);
    });
  });

  describe('checkOrgInitSteps', () => {
    it('accepts valid steps', async () => {
      const errors = await checkOrgInitSteps([
        normalizeOrgInitStep({ id: 'a', type: 'install-packages' }),
        normalizeOrgInitStep({ id: 'b', type: 'deploy-sources', orgTypes: ['scratch'] }),
        normalizeOrgInitStep({ id: 'c', type: 'assign-permission-sets', parameters: { permissionSets: ['PS'] } }),
        normalizeOrgInitStep({ id: 'd', type: 'command', command: 'echo d' }),
      ]);
      expect(errors).to.deep.equal([]);
    });

    it('refuses deployment-only types, deployment-only fields, duplicate ids and sources on sandboxes', async () => {
      const errors = await checkOrgInitSteps([
        normalizeOrgInitStep({ id: 'manual', type: 'manual', parameters: { instructions: 'x' } }),
        normalizeOrgInitStep({ id: 'xml', type: 'remove-packagexml-items' }),
        normalizeOrgInitStep({ id: 'when', type: 'command', command: 'echo', when: 'post-deploy' }),
        normalizeOrgInitStep({ id: 'when', type: 'command', command: 'echo' }),
        normalizeOrgInitStep({ id: 'sources', type: 'deploy-sources' }),
        normalizeOrgInitStep({ id: 'permsets', type: 'assign-permission-sets' }),
        normalizeOrgInitStep({ id: 'unknown', type: 'notAFunction' }),
      ]);
      const stepIds = errors.map((error) => error.stepId);
      expect(stepIds).to.include.members(['manual', 'xml', 'when', 'sources', 'permsets', 'unknown']);
      expect(errors.filter((error) => error.stepId === 'when').length).to.equal(2);
    });

    it('accepts a data step pointing to a project-relative folder', async () => {
      await fs.ensureDir(path.join('other', 'Folder'));
      const errors = await checkOrgInitSteps([
        normalizeOrgInitStep({ id: 'data', type: 'data', parameters: { sfdmuProject: 'other/Folder' } }),
      ]);
      expect(errors).to.deep.equal([]);
    });
  });

  describe('runOrgInitSteps', () => {
    const originalBuild = ActionsProvider.buildActionInstance;
    let ranIds: string[] = [];

    beforeEach(() => {
      ranIds = [];
      // Each step result comes from its command: "fail" fails, anything else succeeds
      ActionsProvider.buildActionInstance = (async () => ({
        customUsernameToUse: null,
        run: async (cmd: PrePostCommand) => {
          ranIds.push(cmd.id);
          expect(cmd.orgInitContext?.orgType).to.equal('scratch');
          return cmd.command === 'fail' ? { statusCode: 'failed', output: 'boom' } : { statusCode: 'success' };
        },
      })) as any;
    });

    afterEach(() => {
      ActionsProvider.buildActionInstance = originalBuild;
    });

    it('stops at the first failure and reports the remaining steps as skipped', async () => {
      let error: Error | null = null;
      try {
        await runOrgInitSteps({
          orgUsername: 'user@example.com',
          orgType: 'scratch',
          phase: 'all',
          config: {
            orgInitSteps: [
              { id: 'one', type: 'command', command: 'echo 1' },
              { id: 'two', type: 'command', command: 'fail' },
              { id: 'three', type: 'command', command: 'echo 3' },
            ],
          },
        });
      } catch (e) {
        error = e as Error;
      }
      expect(error).to.not.equal(null);
      expect(ranIds).to.deep.equal(['one', 'two']);
    });

    it('goes on after a failure that is allowed', async () => {
      const results = await runOrgInitSteps({
        orgUsername: 'user@example.com',
        orgType: 'scratch',
        phase: 'all',
        config: {
          orgInitSteps: [
            { id: 'one', type: 'command', command: 'fail', allowFailure: true },
            { id: 'two', type: 'command', command: 'echo 2' },
          ],
        },
      });
      expect(ranIds).to.deep.equal(['one', 'two']);
      expect(results.map((result) => result.status)).to.deep.equal(['warning', 'success']);
    });

    it('refuses an unknown step id', async () => {
      let error: Error | null = null;
      try {
        await runOrgInitSteps({
          orgUsername: 'user@example.com',
          orgType: 'scratch',
          phase: 'all',
          stepIds: ['nope'],
          config: { orgInitSteps: [{ id: 'one', type: 'command', command: 'echo 1' }] },
        });
      } catch (e) {
        error = e as Error;
      }
      expect(error?.message).to.contain('nope');
      expect(ranIds).to.deep.equal([]);
    });

    it('restores the environment after the run', async () => {
      const previous = process.env.SF_TARGET_ORG;
      await runOrgInitSteps({
        orgUsername: 'user@example.com',
        orgType: 'scratch',
        phase: 'all',
        config: { orgInitSteps: [{ id: 'one', type: 'command', command: 'echo 1' }] },
      });
      expect(process.env.SF_TARGET_ORG).to.equal(previous);
    });
  });

  describe('validateScratchOrgDef', () => {
    it('accepts a valid definition', () => {
      expect(validateScratchOrgDef({ edition: 'Developer', features: ['EnableSetPasswordInApi'], settings: { lightningExperienceSettings: { enableS1DesktopEnabled: true } } })).to.deep.equal([]);
    });

    it('reports an unknown settings name and a wrong type', () => {
      const issues = validateScratchOrgDef({ hasSampleData: 'yes', settings: { notARealSettings: {} } });
      expect(issues.some((issue) => issue.startsWith('hasSampleData'))).to.equal(true);
      expect(issues.some((issue) => issue.startsWith('settings.notARealSettings'))).to.equal(true);
    });

    it('refuses a value that is not an object', () => {
      expect(validateScratchOrgDef([])).to.have.length(1);
    });

    it('reads editions, features and settings names from the Salesforce CLI schema', () => {
      const hints = getScratchOrgDefHints();
      expect(hints.editions).to.include('Developer');
      expect(hints.settingsNames).to.include('lightningExperienceSettings');
      expect(hints.features.length).to.be.greaterThan(10);
    });
  });

  describe('org init types stay out of deployment actions', () => {
    it('does not offer them as deployment action types', () => {
      for (const type of ['install-packages', 'deploy-sources', 'assign-permission-sets']) {
        expect(ACTION_TYPES).to.not.include(type);
      }
    });

    it('refuses them when an action is created or updated', async () => {
      const errors = await validateActionParameters({ type: 'deploy-sources' }, 'post-deploy');
      expect(errors.length).to.be.greaterThan(0);
    });

    it('refuses them as custom function ids', () => {
      expect(isBuiltInActionType('install-packages')).to.equal(true);
      const errors = validateCustomFunctionDefinition({ id: 'install-packages', label: 'x', runtime: 'node', script: 'x.js' } as any);
      expect(errors.length).to.be.greaterThan(0);
    });

    it('fails a deployment action that uses one of them', async () => {
      const cmd: PrePostCommand = { id: 'x', label: 'Deploy sources', type: 'deploy-sources', command: '', context: 'all' };
      const ctx = {
        checkOnly: false,
        deployWhen: 'post-deploy',
        orgBranchName: 'integration',
        currentPrNumber: 1,
        executionOrder: 1,
        targetBranchCandidates: ['integration'],
        hasGitProvider: false,
        pipelineContext: {} as any,
      } as SingleActionRunContext;
      const outcome = await runSingleDeploymentAction(cmd, ctx);
      expect(outcome).to.equal('definition-error');
      expect(cmd.result?.statusCode).to.equal('failed');
    });
  });
});
