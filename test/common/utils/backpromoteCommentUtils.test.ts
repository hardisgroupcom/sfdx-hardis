/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import {
  BACKPROMOTES_MARKER,
  BackpromoteActionRow,
  BackpromoteSandboxRow,
  emptyBackpromotesState,
  findActionRow,
  findSandboxRow,
  parseBackpromotesComment,
  renderBackpromotesComment,
  upsertActionRow,
  upsertSandboxRow,
} from '../../../src/common/utils/backpromoteCommentUtils.js';

const sandboxRow: BackpromoteSandboxRow = {
  sandboxName: 'dev1',
  orgId: '00D5j000000ABCDEAA',
  date: '2026-09-12T10:15:00.000Z',
  user: 'Sam Lee',
  parentBranch: 'integration',
  status: 'partial',
  leftOut: [
    { key: 'Layout:Case-Case Layout', reason: 'keptOrg' },
    { key: 'ApexClass:Legacy', reason: 'conflictPending', commit: 'abc1234' },
  ],
  version: '6.30.0',
};

const actionRow: BackpromoteActionRow = {
  actionId: 'load-discounts',
  label: 'Load discount | thresholds',
  phase: 'post',
  sandboxName: 'dev1',
  orgId: '00D5j000000ABCDEAA',
  date: '2026-09-12T10:16:00.000Z',
  status: 'success',
  user: 'Sam Lee',
};

describe('Backpromotes comment', () => {
  it('renders a readable comment with the marker and reads its rows back exactly', () => {
    const state = upsertActionRow(upsertSandboxRow(emptyBackpromotesState(), sandboxRow), actionRow);
    const body = renderBackpromotesComment(state);
    expect(body.startsWith(BACKPROMOTES_MARKER)).to.be.true;
    expect(body).to.contain('| dev1 <sub>00D5j000000ABCDEAA</sub> | 2026-09-12 10:15 | Sam Lee | integration | :warning: partial |');
    expect(body).to.contain('Layout:Case-Case Layout (org version kept)<br/>ApexClass:Legacy (conflict pending)');
    expect(body).to.contain('| Load discount &#124; thresholds <sub>load-discounts</sub> | post-deploy | dev1 <sub>00D5j000000ABCDEAA</sub> |');
    // The hidden data block must not end the HTML comment early
    const dataLine = body.split('\n')[1];
    expect(dataLine.indexOf('-->')).to.equal(dataLine.length - 3);
    const parsed = parseBackpromotesComment(body);
    expect(parsed.sandboxRows).to.deep.equal([sandboxRow]);
    expect(parsed.actionRows).to.deep.equal([actionRow]);
  });

  it('keeps one row per sandbox and org id, and one per action, sandbox and org id', () => {
    let state = upsertSandboxRow(emptyBackpromotesState(), sandboxRow);
    state = upsertSandboxRow(state, { ...sandboxRow, orgId: '00Dold', status: 'complete', leftOut: [] });
    state = upsertSandboxRow(state, { ...sandboxRow, date: '2026-09-13T08:00:00.000Z', status: 'complete', leftOut: [] });
    expect(state.sandboxRows).to.have.length(2);
    expect(findSandboxRow(state, 'dev1', '00D5j000000ABCDEAA')?.status).to.equal('complete');
    expect(findSandboxRow(state, 'dev1', '00Dold')?.status).to.equal('complete');
    expect(findSandboxRow(state, 'dev2', '00D5j000000ABCDEAA')).to.be.null;
    state = upsertActionRow(state, actionRow);
    state = upsertActionRow(state, { ...actionRow, status: 'failed', date: '2026-09-13T08:01:00.000Z' });
    state = upsertActionRow(state, { ...actionRow, sandboxName: 'dev2' });
    expect(state.actionRows).to.have.length(2);
    expect(findActionRow(state, 'load-discounts', 'dev1', '00D5j000000ABCDEAA')?.status).to.equal('failed');
  });

  it('reads nothing from a comment without data, or with a broken data block', () => {
    expect(parseBackpromotesComment(null)).to.deep.equal({ sandboxRows: [], actionRows: [] });
    expect(parseBackpromotesComment(`${BACKPROMOTES_MARKER}\n## Backpromotes\n`)).to.deep.equal({ sandboxRows: [], actionRows: [] });
    expect(parseBackpromotesComment(`${BACKPROMOTES_MARKER}\n<!-- sfdx-hardis backpromotes-data {not json -->`)).to.deep.equal({ sandboxRows: [], actionRows: [] });
  });

  it('renders an empty state without a table', () => {
    const body = renderBackpromotesComment(emptyBackpromotesState());
    expect(body).to.contain('No sandbox received this Pull Request yet.');
    expect(body).to.not.contain('| Sandbox |');
    expect(body).to.not.contain('Deployment actions run by backpromotes');
  });
});
