/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
// Enter the gitProvider import cycle through its barrel first (see promotionBranchUtils.test.ts)
import '../../../src/common/gitProvider/index.js';
import { GitProvider } from '../../../src/common/gitProvider/index.js';
import {
  BACKPROMOTES_MARKER,
  BackpromoteCommentStore,
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

describe('BackpromoteCommentStore', () => {
  const originalGetInstance = GitProvider.getInstance;
  afterEach(() => {
    GitProvider.getInstance = originalGetInstance;
  });

  it('reads a comment once for parallel readers, and tries again after a dropped connection', async () => {
    const calls: number[] = [];
    let dropOnce = true;
    GitProvider.getInstance = (async () => ({
      getPullRequestCommentByMarker: async (_marker: string, prNumber: number) => {
        calls.push(prNumber);
        if (dropOnce) {
          dropOnce = false;
          throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        return renderBackpromotesComment(upsertSandboxRow(emptyBackpromotesState(), sandboxRow));
      },
    })) as unknown as typeof GitProvider.getInstance;
    const store = new BackpromoteCommentStore(null);
    const [first, second, third] = await Promise.all([store.read(42), store.read(42), store.read(43)]);
    expect(first.sandboxRows).to.deep.equal([sandboxRow]);
    expect(second).to.equal(first);
    expect(third.sandboxRows).to.deep.equal([sandboxRow]);
    // 42 twice (the dropped read and its retry), 43 once: the parallel reader of 42 shared the read
    expect(calls.sort()).to.deep.equal([42, 42, 43]);
    // The memory serves the next read
    await store.read(42);
    expect(calls.length).to.equal(3);
  });
});

describe('Backpromotes comment', () => {
  it('renders a readable comment with the marker and reads its rows back exactly', () => {
    const state = upsertActionRow(upsertSandboxRow(emptyBackpromotesState(), sandboxRow), actionRow);
    const body = renderBackpromotesComment(state);
    // The navigation block comes first, like on the other sfdx-hardis comments, then the marker
    const lines = body.split('\n');
    expect(lines[0].startsWith('<!-- sfdx-hardis nav-start -->')).to.be.true;
    expect(lines[2]).to.equal(BACKPROMOTES_MARKER);
    expect(body).to.contain('| dev1 | integration | Sep 12, 10:15 UTC | Sam Lee | ⚠️ partial |');
    // Org ids and action ids stay in the hidden data, out of the visible text
    expect(lines.filter((line) => !line.startsWith('<!--')).join('\n')).to.not.contain('00D5j000000ABCDEAA');
    expect(body).to.not.contain(':warning:');
    expect(body).to.contain('Layout:Case-Case Layout (org version kept)<br/>ApexClass:Legacy (conflict pending)');
    expect(body).to.contain('#### Deployment actions in dev1');
    expect(body).to.contain('| Load discount &#124; thresholds | after |');
    // The hidden data block must not end the HTML comment early
    const dataLine = lines[3];
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

  it('says the actions were tried in a developer org when no backpromote happened there', () => {
    const body = renderBackpromotesComment({
      sandboxRows: [],
      actionRows: [
        { actionId: 'a1', label: 'Action one', phase: 'post', sandboxName: 'dev1', orgId: '00D000000000001', date: '2026-10-08T10:00:00.000Z', status: 'success', user: 'someone' },
        { actionId: 'a2', label: 'Action two', phase: 'post', sandboxName: 'dev1', orgId: '00D000000000001', date: '2026-10-08T10:00:00.000Z', status: 'pending', user: 'someone' },
      ],
    } as any);

    expect(body).to.contain('**Deployment actions tried in 1 developer org, not backpromoted there yet · 👋 1 to do by hand**');
    expect(body).to.not.contain('No sandbox received');
  });

  it('renders an empty state without a table', () => {
    const body = renderBackpromotesComment(emptyBackpromotesState());
    expect(body).to.contain('### ⤵️ Backpromotes');
    expect(body).to.contain('**No sandbox received this Pull Request yet**');
    expect(body).to.not.contain('pr-banner');
    expect(body).to.not.contain('| Sandbox |');
    expect(body).to.not.contain('#### Deployment actions in');
  });

  it('shows the org by its label, and by its key when a row written before the label has none', () => {
    const labelled = upsertSandboxRow(emptyBackpromotesState(), { ...sandboxRow, sandboxName: '00d5j000000abcdeaa', orgId: '00D5j000000ABCDEAA', orgLabel: 'power-ability-1234-dev-ed' });
    const body = renderBackpromotesComment(labelled);
    expect(body).to.contain('| power-ability-1234-dev-ed |');
    // The key only lives in the hidden data block
    expect(body.split('\n').filter((line) => !line.startsWith('<!--')).join('\n')).to.not.contain('00d5j000000abcdeaa');
    expect(parseBackpromotesComment(body).sandboxRows[0].orgLabel).to.equal('power-ability-1234-dev-ed');
    const legacy = renderBackpromotesComment(upsertSandboxRow(emptyBackpromotesState(), sandboxRow));
    expect(legacy).to.contain('| dev1 |');
  });

  // Two developer orgs of one person can share a label: the org id tells them apart
  it('adds the org id only when two orgs share a label', () => {
    const state = upsertActionRow(
      upsertSandboxRow(upsertSandboxRow(emptyBackpromotesState(), { ...sandboxRow, orgLabel: 'dev1' }), { ...sandboxRow, orgId: '00D5j000000ZZZZEAA', orgLabel: 'dev1', date: '2026-09-13T10:15:00.000Z' }),
      { ...actionRow, orgId: '00D5j000000ZZZZEAA', orgLabel: 'dev1' }
    );
    const body = renderBackpromotesComment(state);
    expect(body).to.contain('| dev1 (00D5j000000ABCDEAA) |');
    expect(body).to.contain('| dev1 (00D5j000000ZZZZEAA) |');
    expect(body).to.contain('#### Deployment actions in dev1 (00D5j000000ZZZZEAA)');
  });

  // The navigation is completed by GitProvider.refreshPullRequestNavigation once the comment exists:
  // a later write must keep what it put there
  it('keeps the navigation line of the comment it rewrites', () => {
    const navLine = '[🔍 Validation](https://x/1) | **⤵️ Backpromotes**';
    const body = renderBackpromotesComment(upsertSandboxRow(emptyBackpromotesState(), sandboxRow), navLine);
    expect(body.startsWith(`<!-- sfdx-hardis nav-start -->\n${navLine}\n<!-- sfdx-hardis nav-end -->\n\n<!-- sfdx-hardis backpromotes -->`)).to.be.true;
    expect(parseBackpromotesComment(body).sandboxRows).to.have.length(1);
  });
});
