import { expect } from 'chai';
import { buildAction, findActionById, readActions, writeActions } from '../../../../../src/common/utils/actionUtils.js';
import { setupTmpDir } from '../../../../common/utils/actionTestHelper.js';

describe('hardis:project:action:update - unit logic', () => {
  setupTmpDir('sfdx-hardis-action-update');

  it('updates label of an existing action', async () => {
    const action = buildAction({ id: 'upd-1', label: 'Original', type: 'command', command: 'echo hello' });
    await writeActions('project', 'pre-deploy', [action]);

    const actions = await readActions('project', 'pre-deploy');
    const { action: found, index } = findActionById(actions, 'upd-1');
    found.label = 'Updated Label';
    actions[index] = found;
    await writeActions('project', 'pre-deploy', actions);

    const result = await readActions('project', 'pre-deploy');
    expect(result[0].label).to.equal('Updated Label');
    expect(result[0].command).to.equal('echo hello');
  });

  it('updates type and type-specific parameters', async () => {
    const action = buildAction({ id: 'upd-2', label: 'Was Command', type: 'command', command: 'echo old' });
    await writeActions('project', 'pre-deploy', [action]);

    const actions = await readActions('project', 'pre-deploy');
    const { action: found, index } = findActionById(actions, 'upd-2');
    found.type = 'manual';
    found.command = '';
    found.parameters = { instructions: 'Check manually' };
    actions[index] = found;
    await writeActions('project', 'pre-deploy', actions);

    const result = await readActions('project', 'pre-deploy');
    expect(result[0].type).to.equal('manual');
    expect(result[0].parameters?.instructions).to.equal('Check manually');
  });

  it('throws when action-id is not found', async () => {
    const action = buildAction({ id: 'upd-3', label: 'Exists', type: 'command', command: 'echo x' });
    await writeActions('project', 'pre-deploy', [action]);

    const actions = await readActions('project', 'pre-deploy');
    expect(() => findActionById(actions, 'nonexistent')).to.throw();
  });

  it('updates only provided fields, leaves others untouched', async () => {
    const action = buildAction({
      id: 'upd-4',
      label: 'Full Action',
      type: 'command',
      command: 'echo hello',
      context: 'all',
      skipIfError: true,
      allowFailure: true,
      runOnlyOnceByOrg: false,
    });
    await writeActions('project', 'post-deploy', [action]);

    const actions = await readActions('project', 'post-deploy');
    const { action: found, index } = findActionById(actions, 'upd-4');
    found.context = 'process-deployment-only';
    actions[index] = found;
    await writeActions('project', 'post-deploy', actions);

    const result = await readActions('project', 'post-deploy');
    expect(result[0].context).to.equal('process-deployment-only');
    expect(result[0].label).to.equal('Full Action');
    expect(result[0].skipIfError).to.equal(true);
    expect(result[0].allowFailure).to.equal(true);
  });
});
