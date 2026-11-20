import { expect } from 'chai';
import {
  analyzePoolComments,
  buildPoolCommentBody,
  buildPoolDashboardBody,
  buildPoolSummary,
  parsePoolComment,
  PoolComment,
  PoolCommentData,
} from '../../../src/common/utils/poolDashboardUtils.js';

function entry(id: number, keyId = 'key1', alias = `org${id}`): PoolComment {
  return {
    id,
    createdDate: '2026-10-01T00:00:00Z',
    data: { v: 1, kind: 'entry', alias, username: `${alias}@example.com`, keyId, payload: 'encrypted', expirationDate: '2026-10-31' },
  };
}

function claim(id: number, entryId: number, by = 'job'): PoolComment {
  return { id, createdDate: '2026-10-02T00:00:00Z', data: { v: 1, kind: 'claim', entry: entryId, alias: `org${entryId}`, by, date: '2026-10-02T00:00:00Z' } };
}

describe('poolDashboardUtils', () => {
  describe('comment format', () => {
    const data: PoolCommentData = { v: 1, kind: 'entry', alias: 'PO-org', username: 'user@example.com', keyId: 'abcd1234', payload: 'a.b.c' };

    it('reads back a Markdown comment', () => {
      const body = buildPoolCommentBody(data, 'markdown');
      expect(parsePoolComment({ id: 12, body, createdDate: '2026-10-01' })).to.deep.equal({ id: 12, createdDate: '2026-10-01', data });
    });

    it('reads back an HTML comment', () => {
      const body = buildPoolCommentBody(data, 'html');
      expect(body).to.include('<pre>');
      expect(parsePoolComment({ id: 12, body, createdDate: '' })?.data).to.deep.equal(data);
    });

    it('reads a token that a provider wrapped on several lines', () => {
      const body = buildPoolCommentBody(data, 'markdown');
      const token = body.match(/\[sfdx-hardis-pool-data:[^\]]+\]/)![0];
      const wrapped = body.replace(token, token.slice(0, 40) + '\n' + token.slice(40, 80) + ' ' + token.slice(80));
      expect(parsePoolComment({ id: 1, body: wrapped, createdDate: '' })?.data).to.deep.equal(data);
    });

    it('ignores a comment written by a human, or with unknown data', () => {
      expect(parsePoolComment({ id: 1, body: 'Why is the pool empty ?', createdDate: '' })).to.equal(null);
      const unknown = `[sfdx-hardis-pool-data:${Buffer.from(JSON.stringify({ v: 2, kind: 'entry' })).toString('base64url')}]`;
      expect(parsePoolComment({ id: 1, body: unknown, createdDate: '' })).to.equal(null);
      expect(parsePoolComment({ id: 1, body: '[sfdx-hardis-pool-data:not_json]', createdDate: '' })).to.equal(null);
    });

    it('says what the comment is, for the human who reads the dashboard', () => {
      expect(buildPoolCommentBody(data, 'markdown').split('\n')[0]).to.include('PO-org');
    });
  });

  describe('analyzePoolComments', () => {
    it('lists the entries nobody claimed, oldest first', () => {
      const state = analyzePoolComments([entry(30), entry(10), entry(20), claim(40, 20)], 'key1');
      expect(state.available.map((comment) => comment.id)).to.deep.equal([10, 30]);
    });

    it('keeps only the entries of the current key', () => {
      const state = analyzePoolComments([entry(10, 'key1'), entry(20, 'key2')], 'key2');
      expect(state.available.map((comment) => comment.id)).to.deep.equal([20]);
      expect(analyzePoolComments([entry(10, 'key1'), entry(20, 'key2')], null).available).to.have.length(2);
    });

    it('makes the oldest claim of a taken scratch org its history, newest fetch first', () => {
      // Entries 10 and 20 are gone. Entry 30 is taken too: its comment waits for the next refresh.
      const state = analyzePoolComments([claim(41, 10, 'first'), claim(42, 10, 'late'), claim(50, 20, 'other'), entry(30), claim(60, 30, 'kept')], 'key1');
      expect(state.history.map((comment) => comment.data.by)).to.deep.equal(['kept', 'other', 'first']);
      expect(state.lostClaims.map((comment) => comment.id)).to.deep.equal([42]);
      expect(state.available).to.have.length(0);
    });

    it('sorts failures and refreshes newest first', () => {
      const failure = (id: number): PoolComment => ({ id, createdDate: '', data: { v: 1, kind: 'failure', error: `error ${id}` } });
      const refresh = (id: number): PoolComment => ({ id, createdDate: '', data: { v: 1, kind: 'state', date: `date ${id}` } });
      const state = analyzePoolComments([failure(1), refresh(2), failure(3), refresh(4)], null);
      expect(state.failures.map((comment) => comment.id)).to.deep.equal([3, 1]);
      expect(state.states.map((comment) => comment.id)).to.deep.equal([4, 2]);
    });
  });

  describe('buildPoolSummary', () => {
    const options = { storageService: 'gitProvider', dashboardUrl: 'https://example.com/issues/1', max: 5, now: new Date('2026-10-21T00:00:00Z') };

    it('counts the available scratch orgs and their days left', () => {
      const summary = buildPoolSummary(analyzePoolComments([entry(10), entry(20)], 'key1'), { ...options, keyId: 'key1' });
      expect(summary.available).to.equal(2);
      expect(summary.canTake).to.equal(true);
      expect(summary.keyStatus).to.equal('ok');
      expect(summary.orgs[0]).to.include({ alias: 'org10', username: 'org10@example.com', daysLeft: 10 });
    });

    it('still counts without the key, and says nothing can be taken', () => {
      const summary = buildPoolSummary(analyzePoolComments([entry(10), entry(20)], null), { ...options, keyId: null });
      expect(summary.available).to.equal(2);
      expect(summary.keyStatus).to.equal('missing');
      expect(summary.canTake).to.equal(false);
    });

    it('reports a key that is not the one of the pool', () => {
      const summary = buildPoolSummary(analyzePoolComments([entry(10, 'key1')], 'key2'), { ...options, keyId: 'key2' });
      expect(summary.keyStatus).to.equal('mismatch');
      expect(summary.available).to.equal(0);
      expect(summary.canTake).to.equal(false);
    });

    it('accepts an empty pool with any key', () => {
      expect(buildPoolSummary(analyzePoolComments([], 'key1'), { ...options, keyId: 'key1' }).keyStatus).to.equal('ok');
    });

    it('never holds an encrypted payload', () => {
      const summary = buildPoolSummary(analyzePoolComments([entry(10), claim(20, 5)], 'key1'), { ...options, keyId: 'key1' });
      expect(JSON.stringify(summary)).to.not.include('encrypted');
    });

    it('reads the last refresh and its Dev Hub limits', () => {
      const limits = { activeScratchOrgs: { used: 3, max: 40 }, dailyScratchOrgs: { used: 5, max: 80 } };
      const refresh: PoolComment = { id: 9, createdDate: '', data: { v: 1, kind: 'state', date: '2026-10-20T03:00:00Z', jobUrl: 'https://example.com/job/1', devHubLimits: limits } };
      const summary = buildPoolSummary(analyzePoolComments([refresh], 'key1'), { ...options, keyId: 'key1' });
      expect(summary.lastRefresh).to.deep.equal({ date: '2026-10-20T03:00:00Z', jobUrl: 'https://example.com/job/1' });
      expect(summary.devHubLimits).to.deep.equal(limits);
    });
  });

  describe('buildPoolDashboardBody', () => {
    const failure: PoolComment = { id: 5, createdDate: '', data: { v: 1, kind: 'failure', date: '2026-10-20T03:00:00Z', error: 'Limit <b>exceeded</b> | daily', jobUrl: 'https://example.com/job/2' } };
    const summary = buildPoolSummary(analyzePoolComments([entry(10), claim(41, 7, 'someone'), failure], 'key1'), {
      storageService: 'gitProvider',
      dashboardUrl: null,
      max: 5,
      keyId: 'key1',
    });

    it('renders Markdown tables, with pipes escaped', () => {
      const body = buildPoolDashboardBody(summary, 'markdown');
      expect(body).to.include('## Available scratch orgs');
      expect(body).to.include('| org10 | org10@example.com |');
      expect(body).to.include('someone');
      expect(body).to.include('Limit <b>exceeded</b> \\| daily');
      expect(body).to.include('[job](https://example.com/job/2)');
    });

    it('renders HTML for Azure DevOps, with the text escaped', () => {
      const body = buildPoolDashboardBody(summary, 'html');
      expect(body).to.include('<h3>Available scratch orgs</h3>');
      expect(body).to.include('<td>org10</td>');
      expect(body).to.include('Limit &lt;b&gt;exceeded&lt;/b&gt; | daily');
      expect(body).to.include('<a href="https://example.com/job/2">job</a>');
    });

    it('says when the pool is empty', () => {
      const empty = buildPoolSummary(analyzePoolComments([], null), { storageService: 'gitProvider', dashboardUrl: null, max: 5, keyId: null });
      expect(buildPoolDashboardBody(empty, 'markdown')).to.include('The pool is empty');
    });
  });
});
