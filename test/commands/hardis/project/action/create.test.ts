import { expect } from 'chai';
import fs from 'fs-extra';
import * as yaml from 'js-yaml';
import { readActions, writeActions } from '../../../../../src/common/utils/actionUtils.js';
import { buildAction } from '../../../../../src/common/utils/actionUtils.js';
import { randomUUID } from 'crypto';
import { setupTmpDir } from '../../../../common/utils/actionTestHelper.js';

describe('hardis:project:action:create - unit logic', () => {
  setupTmpDir('sfdx-hardis-action-create');

  it('creates a command action and appends to project config', async () => {
    const action = buildAction({
      id: randomUUID(),
      label: 'Disable triggers',
      type: 'command',
      command: 'sf apex run --file scripts/disable.apex',
      context: 'all',
      parameters: {},
    });

    const actions = await readActions('project', 'pre-deploy');
    actions.push(action);
    const configFile = await writeActions('project', 'pre-deploy', actions);

    const doc: any = yaml.load(fs.readFileSync(configFile, 'utf-8'));
    expect(doc.commandsPreDeploy).to.have.lengthOf(1);
    expect(doc.commandsPreDeploy[0].label).to.equal('Disable triggers');
    expect(doc.commandsPreDeploy[0].type).to.equal('command');
    expect(doc.commandsPreDeploy[0].command).to.include('disable.apex');
  });

  it('creates a data action with sfdmuProject parameter', async () => {
    const action = buildAction({
      id: randomUUID(),
      label: 'Import test data',
      type: 'data',
      parameters: { sfdmuProject: 'TestData' },
      context: 'process-deployment-only',
    });

    const actions = await readActions('project', 'post-deploy');
    actions.push(action);
    const configFile = await writeActions('project', 'post-deploy', actions);

    const doc: any = yaml.load(fs.readFileSync(configFile, 'utf-8'));
    expect(doc.commandsPostDeploy).to.have.lengthOf(1);
    expect(doc.commandsPostDeploy[0].type).to.equal('data');
    expect(doc.commandsPostDeploy[0].parameters.sfdmuProject).to.equal('TestData');
    expect(doc.commandsPostDeploy[0].context).to.equal('process-deployment-only');
  });

  it('creates a manual action with instructions', async () => {
    const action = buildAction({
      id: randomUUID(),
      label: 'Manual step',
      type: 'manual',
      parameters: { instructions: 'Please verify the layout manually' },
    });

    const actions = await readActions('project', 'pre-deploy');
    actions.push(action);
    await writeActions('project', 'pre-deploy', actions);

    const result = await readActions('project', 'pre-deploy');
    expect(result).to.have.lengthOf(1);
    expect(result[0].type).to.equal('manual');
    expect(result[0].parameters?.instructions).to.include('verify');
  });

  it('creates a schedule-batch action with all parameters', async () => {
    const action = buildAction({
      id: randomUUID(),
      label: 'Schedule nightly batch',
      type: 'schedule-batch',
      parameters: { className: 'NightlyBatch', cronExpression: '0 0 0 * * ?', jobName: 'NightlyBatch_Schedule' },
    });

    const actions = await readActions('project', 'post-deploy');
    actions.push(action);
    await writeActions('project', 'post-deploy', actions);

    const result = await readActions('project', 'post-deploy');
    expect(result[0].parameters?.className).to.equal('NightlyBatch');
    expect(result[0].parameters?.cronExpression).to.equal('0 0 0 * * ?');
    expect(result[0].parameters?.jobName).to.equal('NightlyBatch_Schedule');
  });

  it('appends to existing actions without disturbing them', async () => {
    const first = buildAction({ id: 'first-id', label: 'First', type: 'command', command: 'echo 1' });
    await writeActions('project', 'pre-deploy', [first]);

    const actions = await readActions('project', 'pre-deploy');
    const second = buildAction({ id: 'second-id', label: 'Second', type: 'command', command: 'echo 2' });
    actions.push(second);
    await writeActions('project', 'pre-deploy', actions);

    const result = await readActions('project', 'pre-deploy');
    expect(result).to.have.lengthOf(2);
    expect(result[0].id).to.equal('first-id');
    expect(result[1].id).to.equal('second-id');
  });

  it('generates a valid UUID for the id field', () => {
    const id = randomUUID();
    expect(id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('creates action at branch scope', async () => {
    const action = buildAction({
      id: randomUUID(),
      label: 'Branch action',
      type: 'apex',
      parameters: { apexScript: 'scripts/test.apex' },
    });

    const actions = await readActions('branch', 'pre-deploy', 'integration');
    actions.push(action);
    const configFile = await writeActions('branch', 'pre-deploy', actions, 'integration');

    expect(configFile).to.include('integration');
    const doc: any = yaml.load(fs.readFileSync(configFile, 'utf-8'));
    expect(doc.commandsPreDeploy).to.have.lengthOf(1);
  });

  it('creates action at PR scope', async () => {
    const action = buildAction({
      id: randomUUID(),
      label: 'PR action',
      type: 'publish-community',
      parameters: { communityName: 'CustomerPortal' },
    });

    const actions = await readActions('pr', 'post-deploy', undefined, '123');
    actions.push(action);
    const configFile = await writeActions('pr', 'post-deploy', actions, undefined, '123');

    expect(configFile).to.include('123');
    const doc: any = yaml.load(fs.readFileSync(configFile, 'utf-8'));
    expect(doc.commandsPostDeploy).to.have.lengthOf(1);
  });
});
