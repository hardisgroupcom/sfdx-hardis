import { expect } from 'chai';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { buildAction, readActions, writeActions } from '../../../../../src/common/utils/actionUtils.js';

describe('hardis:project:action:list - unit logic', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sfdx-hardis-action-list-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.remove(tmpDir);
  });

  it('returns empty array when no actions defined', async () => {
    const actions = await readActions('project', 'pre-deploy');
    expect(actions).to.deep.equal([]);
  });

  it('returns correct JSON structure for actions', async () => {
    const testActions = [
      buildAction({ id: 'list-1', label: 'First Action', type: 'command', command: 'echo 1', context: 'all' }),
      buildAction({ id: 'list-2', label: 'Second Action', type: 'data', parameters: { sfdmuProject: 'TestData' }, context: 'process-deployment-only' }),
    ];
    await writeActions('project', 'pre-deploy', testActions);

    const result = await readActions('project', 'pre-deploy');
    expect(result).to.have.lengthOf(2);
    expect(result[0]).to.have.property('id', 'list-1');
    expect(result[0]).to.have.property('label', 'First Action');
    expect(result[0]).to.have.property('type', 'command');
    expect(result[1]).to.have.property('id', 'list-2');
    expect(result[1]).to.have.property('type', 'data');
  });

  it('reads from correct scope file for project', async () => {
    const projectActions = [buildAction({ id: 'p1', label: 'Project Action', type: 'command', command: 'echo proj' })];
    await writeActions('project', 'post-deploy', projectActions);

    const result = await readActions('project', 'post-deploy');
    expect(result).to.have.lengthOf(1);
    expect(result[0].label).to.equal('Project Action');
  });

  it('reads from correct scope file for branch', async () => {
    const branchActions = [buildAction({ id: 'b1', label: 'Branch Action', type: 'manual', parameters: { instructions: 'test' } })];
    await writeActions('branch', 'pre-deploy', branchActions, 'develop');

    const result = await readActions('branch', 'pre-deploy', 'develop');
    expect(result).to.have.lengthOf(1);
    expect(result[0].label).to.equal('Branch Action');
  });

  it('reads from correct scope file for PR', async () => {
    const prActions = [buildAction({ id: 'pr1', label: 'PR Action', type: 'apex', parameters: { apexScript: 'test.apex' } })];
    await writeActions('pr', 'post-deploy', prActions, undefined, '456');

    const result = await readActions('pr', 'post-deploy', undefined, '456');
    expect(result).to.have.lengthOf(1);
    expect(result[0].label).to.equal('PR Action');
  });
});
