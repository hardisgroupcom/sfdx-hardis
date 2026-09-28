import { expect } from 'chai';
import fs from '../../../../../src/common/utils/fsUtils.js';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  CustomFunctionDefinition,
  findActionsUsingCustomFunction,
  readCustomFunctionsFromProjectFile,
  validateCustomFunctionDefinition,
  writeCustomFunctionsToProjectFile,
} from '../../../../../src/common/utils/customFunctionUtils.js';
import {
  buildAction,
  readActions,
  validateActionParameters,
  writeActions,
} from '../../../../../src/common/utils/actionUtils.js';
import { setupTmpDir } from '../../../../common/utils/actionTestHelper.js';

/**
 * Unit coverage of the logic behind hardis:project:function:* and of the interaction between a
 * custom function and the deployment actions using it.
 */
describe('hardis:project:function - unit logic', () => {
  setupTmpDir('sfdx-hardis-function-commands');

  async function declareFunction(definition: Partial<CustomFunctionDefinition> = {}): Promise<CustomFunctionDefinition> {
    const script = path.join('scripts', 'functions', 'fn.js');
    await fs.ensureDir(path.dirname(script));
    await fs.writeFile(script, 'console.log("{}");');
    const full: CustomFunctionDefinition = {
      id: 'notifySlack',
      label: 'Notify Slack',
      runtime: 'node',
      script,
      ...definition,
    };
    const existing = await readCustomFunctionsFromProjectFile();
    existing.push(full);
    await writeCustomFunctionsToProjectFile(existing);
    return full;
  }

  describe('create', () => {
    it('appends a function to the project catalog', async () => {
      await declareFunction();
      await declareFunction({ id: 'findAccount', label: 'Find account' });
      const functions = await readCustomFunctionsFromProjectFile();
      expect(functions.map((fn) => fn.id)).to.deep.equal(['notifySlack', 'findAccount']);
    });

    it('rejects a second function with the same id', async () => {
      const first = await declareFunction();
      const errors = validateCustomFunctionDefinition(first, await readCustomFunctionsFromProjectFile());
      expect(errors.join(' ')).to.match(/notifySlack/);
    });
  });

  describe('update', () => {
    it('replaces the definition in place, keeping the order', async () => {
      await declareFunction();
      await declareFunction({ id: 'findAccount', label: 'Find account' });
      const functions = await readCustomFunctionsFromProjectFile();
      functions[0].label = 'Notify the release channel';
      await writeCustomFunctionsToProjectFile(functions);
      const updated = await readCustomFunctionsFromProjectFile();
      expect(updated[0].label).to.equal('Notify the release channel');
      expect(updated.map((fn) => fn.id)).to.deep.equal(['notifySlack', 'findAccount']);
    });

    it('does not report a function as a duplicate of itself', async () => {
      const definition = await declareFunction();
      const functions = await readCustomFunctionsFromProjectFile();
      const others = functions.filter((fn) => fn.id !== definition.id);
      expect(validateCustomFunctionDefinition({ ...definition, label: 'New label' }, others)).to.deep.equal([]);
    });
  });

  describe('delete', () => {
    it('removes the function and reports the actions still using it', async () => {
      await declareFunction();
      await writeActions('project', 'post-deploy', [
        buildAction({ id: 'a1', label: 'Notify', type: 'notifySlack' }),
      ]);

      const usages = await findActionsUsingCustomFunction('notifySlack');
      expect(usages).to.have.length(1);
      expect(usages[0].actionId).to.equal('a1');

      await writeCustomFunctionsToProjectFile([]);
      expect(await readCustomFunctionsFromProjectFile()).to.deep.equal([]);
    });

    it('leaves the script file on disk', async () => {
      const definition = await declareFunction();
      await writeCustomFunctionsToProjectFile([]);
      expect(fs.existsSync(definition.script)).to.equal(true);
    });
  });

  describe('action validation against a function contract', () => {
    it('accepts an action providing every required input', async () => {
      await declareFunction({ inputs: [{ name: 'channel', type: 'string', required: true }] });
      const action = buildAction({ id: 'a1', label: 'Notify', type: 'notifySlack', parameters: { channel: '#rel' } });
      expect(await validateActionParameters(action, 'post-deploy')).to.deep.equal([]);
    });

    it('rejects an action missing a required input', async () => {
      await declareFunction({ inputs: [{ name: 'channel', type: 'string', required: true }] });
      const action = buildAction({ id: 'a1', label: 'Notify', type: 'notifySlack' });
      const errors = await validateActionParameters(action, 'post-deploy');
      expect(errors.join(' ')).to.match(/channel/);
    });

    it('rejects a value outside a select input options', async () => {
      await declareFunction({
        inputs: [{ name: 'severity', type: 'select', options: ['info', 'critical'] }],
      });
      const action = buildAction({ id: 'a1', label: 'Notify', type: 'notifySlack', parameters: { severity: 'nope' } });
      const errors = await validateActionParameters(action, 'post-deploy');
      expect(errors.join(' ')).to.match(/nope/);
    });

    it('accepts a reference as a value, since it is only known at run time', async () => {
      await declareFunction({
        inputs: [{ name: 'severity', type: 'select', options: ['info', 'critical'] }],
      });
      const action = buildAction({
        id: 'a1', label: 'Notify', type: 'notifySlack',
        parameters: { severity: '${{ actions.other.outputs.level }}' },
      });
      expect(await validateActionParameters(action, 'post-deploy')).to.deep.equal([]);
    });

    it('rejects a non-numeric value on a number input', async () => {
      await declareFunction({ inputs: [{ name: 'retries', type: 'number' }] });
      const action = buildAction({ id: 'a1', label: 'Notify', type: 'notifySlack', parameters: { retries: 'many' } });
      const errors = await validateActionParameters(action, 'post-deploy');
      expect(errors.join(' ')).to.match(/retries/);
    });

    it('rejects parameters the function does not declare', async () => {
      await declareFunction({ inputs: [{ name: 'channel', type: 'string' }] });
      const action = buildAction({
        id: 'a1', label: 'Notify', type: 'notifySlack', parameters: { channel: '#a', typo: 'x' },
      });
      const errors = await validateActionParameters(action, 'post-deploy');
      expect(errors.join(' ')).to.match(/typo/);
    });

    it('rejects an action in the phase the function excludes', async () => {
      await declareFunction({ when: 'post-deploy' });
      const action = buildAction({ id: 'a1', label: 'Notify', type: 'notifySlack' });
      const errors = await validateActionParameters(action, 'pre-deploy');
      expect(errors.join(' ')).to.match(/post-deploy/);
    });

    it('rejects an action in a context the function does not allow', async () => {
      await declareFunction({ allowedContexts: ['process-deployment-only'] });
      const action = buildAction({
        id: 'a1', label: 'Notify', type: 'notifySlack', context: 'check-deployment-only',
      });
      const errors = await validateActionParameters(action, 'post-deploy');
      expect(errors.join(' ')).to.match(/check-deployment-only/);
    });

    it('rejects an action whose type is neither built-in nor a declared function', async () => {
      const action = buildAction({ id: 'a1', label: 'X', type: 'notAThing' });
      const errors = await validateActionParameters(action, 'post-deploy');
      expect(errors.join(' ')).to.match(/notAThing/);
    });
  });

  describe('action:update --new-when', () => {
    it('moves an action to the other phase instead of leaving it in both', async () => {
      const action = buildAction({ id: 'mv-1', label: 'Move me', type: 'command', command: 'echo x' });
      await writeActions('project', 'pre-deploy', [action]);

      // Same sequence as the command: remove from the source list, append to the target one
      const sourceActions = await readActions('project', 'pre-deploy');
      sourceActions.splice(0, 1);
      await writeActions('project', 'pre-deploy', sourceActions);
      const targetActions = await readActions('project', 'post-deploy');
      action.when = 'post-deploy';
      targetActions.push(action);
      await writeActions('project', 'post-deploy', targetActions);

      expect(await readActions('project', 'pre-deploy')).to.have.length(0);
      const moved = await readActions('project', 'post-deploy');
      expect(moved).to.have.length(1);
      expect(moved[0].id).to.equal('mv-1');
    });

    it('keeps the other actions of both phases untouched', async () => {
      await writeActions('project', 'pre-deploy', [
        buildAction({ id: 'stay-1', label: 'Stay', type: 'command', command: 'echo a' }),
        buildAction({ id: 'mv-1', label: 'Move', type: 'command', command: 'echo b' }),
      ]);
      await writeActions('project', 'post-deploy', [
        buildAction({ id: 'post-1', label: 'Post', type: 'command', command: 'echo c' }),
      ]);

      const sourceActions = await readActions('project', 'pre-deploy');
      const [moved] = sourceActions.splice(1, 1);
      await writeActions('project', 'pre-deploy', sourceActions);
      const targetActions = await readActions('project', 'post-deploy');
      targetActions.push(moved);
      await writeActions('project', 'post-deploy', targetActions);

      expect((await readActions('project', 'pre-deploy')).map((a) => a.id)).to.deep.equal(['stay-1']);
      expect((await readActions('project', 'post-deploy')).map((a) => a.id)).to.deep.equal(['post-1', 'mv-1']);
    });
  });

  describe('project config file', () => {
    it('keeps customFunctions and the actions side by side', async () => {
      await declareFunction();
      await writeActions('project', 'post-deploy', [
        buildAction({ id: 'a1', label: 'Notify', type: 'notifySlack' }),
      ]);
      const doc: any = yaml.load(fs.readFileSync(path.join('config', '.sfdx-hardis.yml'), 'utf-8'));
      expect(doc.customFunctions).to.have.length(1);
      expect(doc.commandsPostDeploy).to.have.length(1);
    });
  });
});
