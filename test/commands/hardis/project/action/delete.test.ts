import { expect } from 'chai';
import { buildAction, findActionById, readActions, writeActions } from '../../../../../src/common/utils/actionUtils.js';
import { setupTmpDir } from '../../../../common/utils/actionTestHelper.js';

describe('hardis:project:action:delete - unit logic', () => {
  setupTmpDir('sfdx-hardis-action-delete');

  it('deletes action by ID', async () => {
    const actions = [
      buildAction({ id: 'del-1', label: 'First', type: 'command', command: 'echo 1' }),
      buildAction({ id: 'del-2', label: 'Second', type: 'command', command: 'echo 2' }),
      buildAction({ id: 'del-3', label: 'Third', type: 'command', command: 'echo 3' }),
    ];
    await writeActions('project', 'pre-deploy', actions);

    const current = await readActions('project', 'pre-deploy');
    const { index } = findActionById(current, 'del-2');
    current.splice(index, 1);
    await writeActions('project', 'pre-deploy', current);

    const result = await readActions('project', 'pre-deploy');
    expect(result).to.have.lengthOf(2);
    expect(result.find(a => a.id === 'del-2')).to.equal(undefined);
  });

  it('preserves other actions in the list', async () => {
    const actions = [
      buildAction({ id: 'keep-1', label: 'Keep', type: 'command', command: 'echo keep' }),
      buildAction({ id: 'remove-1', label: 'Remove', type: 'manual', parameters: { instructions: 'test' } }),
    ];
    await writeActions('project', 'post-deploy', actions);

    const current = await readActions('project', 'post-deploy');
    const { index } = findActionById(current, 'remove-1');
    current.splice(index, 1);
    await writeActions('project', 'post-deploy', current);

    const result = await readActions('project', 'post-deploy');
    expect(result).to.have.lengthOf(1);
    expect(result[0].id).to.equal('keep-1');
    expect(result[0].label).to.equal('Keep');
  });

  it('throws when action-id is not found', async () => {
    const actions = [buildAction({ id: 'exists', label: 'Exists', type: 'command', command: 'echo x' })];
    await writeActions('project', 'pre-deploy', actions);

    const current = await readActions('project', 'pre-deploy');
    expect(() => findActionById(current, 'does-not-exist')).to.throw();
  });
});
