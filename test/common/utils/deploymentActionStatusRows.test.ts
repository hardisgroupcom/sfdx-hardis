import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { buildActionStatusRows } from '../../../src/common/utils/deploymentActionsLocalState.js';

/**
 * The status rows of a Pull Request: what hardis:project:action:list --with-status answers, and
 * what hardis:project:action:set-status answers after its write, so that a panel shows the
 * outcome without running the list command again.
 */
describe('Deployment action status rows', () => {
  const entry = (overrides: Record<string, any>): any => ({
    actionId: 'a1',
    actionLabel: 'Assign the permission set',
    orgBranch: 'integration',
    when: 'post-deploy',
    status: 'success',
    date: '2026-10-04T10:00:00.000Z',
    jobUrl: '',
    ...overrides,
  });

  it('gives one row per entry of the Pull Request comments, with the optional fields filled', () => {
    // A Pull Request number no local result exists for
    const rows = buildActionStatusRows('999999', [
      entry({ note: 'Closed by hand' }),
      entry({ orgBranch: 'uat', status: 'failed', stoppedActions: ['a2'] }),
    ]);
    expect(rows.map((row) => [row.orgBranch, row.status, row.local])).to.deep.equal([
      ['integration', 'success', false],
      ['uat', 'failed', false],
    ]);
    expect(rows[0].note).to.equal('Closed by hand');
    expect(rows[0].movedTo).to.equal(null);
    expect(rows[0].blockedBy).to.equal(null);
    expect(rows[0].stoppedActions).to.deep.equal([]);
    expect(rows[1].note).to.equal('');
    expect(rows[1].stoppedActions).to.deep.equal(['a2']);
  });

  it('set-status answers with those rows, and action:list builds its own with the same function', () => {
    const read = (file: string) => fs.readFileSync(path.join('src', 'commands', 'hardis', 'project', 'action', file), 'utf8');
    const setStatus = read('set-status.ts');
    expect(setStatus.split('statuses: { [String(prNumber)]: buildActionStatusRows(String(prNumber), getStateEntriesForPr(prNumber)) }').length).to.equal(3);
    expect(read('list.ts')).to.include('statuses[prId] = buildActionStatusRows(prId, fromComment);');
  });

  it('action:list never opens a command tab in VS Code', () => {
    const hook = fs.readFileSync(path.join('src', 'hooks', 'init', 'start-ws-client.ts'), 'utf8');
    const disabled = hook.slice(hook.indexOf('const DISABLE_WEBSOCKET_COMMANDS'), hook.indexOf(']);'));
    expect(disabled).to.include("'hardis:project:action:list'");
    const list = fs.readFileSync(path.join('src', 'commands', 'hardis', 'project', 'action', 'list.ts'), 'utf8');
    expect(list).to.include('public static disableWebsocket = true;');
  });
});
