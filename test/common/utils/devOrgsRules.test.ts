import { expect } from 'chai';
import {
  analyzeDevOrgComments,
  applyDevOrgRegistration,
  branchWindowStart,
  buildBranchMerges,
  buildDevOrgCommentBody,
  buildDevOrgRemoval,
  buildDevOrgsDashboardBody,
  buildDevOrgsSummary,
  computeDevOrgBehind,
  DEV_ORGS_MAX_LOOKBACK_DAYS,
  DevOrgBranchData,
  DevOrgComment,
  DevOrgData,
  DevOrgIdentity,
  devOrgStartDate,
  isDevOrgExpired,
  isDevOrgMine,
  isDevOrgStale,
  parseDevOrgComment,
  parseDevOrgPerson,
  isSameDevOrgId,
} from '../../../src/common/utils/devOrgsRules.js';
import { parseDevOrgPersonList } from '../../../src/common/utils/devOrgsCommandUtils.js';

const NOW = new Date('2026-11-07T12:00:00.000Z');
const jane = { name: 'Jane Doe', email: 'jane@example.com' };
const john = { name: 'John Smith', email: 'john@example.com' };

function identity(overrides: Partial<DevOrgIdentity> = {}): DevOrgIdentity {
  return {
    orgId: '00D000000000001AAA',
    orgType: 'sandbox',
    sandboxName: 'dev1',
    alias: null,
    instanceUrl: 'https://acme--dev1.sandbox.my.salesforce.com',
    expirationDate: null,
    ...overrides,
  };
}

function orgData(overrides: Partial<DevOrgData> = {}): DevOrgData {
  return {
    ...applyDevOrgRegistration(null, { org: identity(), targetBranch: 'integration', currentUser: jane }, new Date('2026-11-01T00:00:00.000Z')).data,
    ...overrides,
  };
}

function branchData(overrides: Partial<DevOrgBranchData> = {}): DevOrgBranchData {
  return {
    v: 1,
    kind: 'branch',
    branch: 'integration',
    since: '2026-10-01T00:00:00.000Z',
    capped: false,
    computedAt: '2026-11-07T10:00:00.000Z',
    jobUrl: null,
    merges: [],
    ...overrides,
  };
}

function merge(number: number, mergedAt: string, overrides: any = {}) {
  return { number, title: `PR ${number}`, url: `https://example.com/pr/${number}`, mergedAt, sourceBranch: `feature/${number}`, vehicle: false, carried: null, ...overrides };
}

let nextId = 1;
function comment<T extends DevOrgData | DevOrgBranchData>(data: T): DevOrgComment<T> {
  return { id: nextId++, createdDate: NOW.toISOString(), data };
}

describe('devOrgsRules', () => {
  describe('org ids and person lists', () => {
    it('matches an 18-character org id with its 15-character form, never two other orgs', () => {
      expect(isSameDevOrgId('00D000000000001AAA', '00D000000000001')).to.equal(true);
      expect(isSameDevOrgId('00D000000000001', '00D000000000001AAA')).to.equal(true);
      expect(isSameDevOrgId('00D000000000001AAA', '00D000000000001AAA')).to.equal(true);
      expect(isSameDevOrgId('00D000000000001AAA', '00D000000000001BBB')).to.equal(false);
      expect(isSameDevOrgId('00D000000000001AAA', '00d000000000001')).to.equal(false);
      expect(isSameDevOrgId('00D000000000001AAA', '')).to.equal(false);
    });

    it('keeps a name holding a comma as one person', () => {
      expect(parseDevOrgPersonList('Doe, Jane <jane@example.com>, john@example.com; Smith, John <js@example.com>')).to.deep.equal([
        { name: 'Doe, Jane', email: 'jane@example.com' },
        { name: 'john', email: 'john@example.com' },
        { name: 'Smith, John', email: 'js@example.com' },
      ]);
      expect(parseDevOrgPersonList('Jane Doe <jane@example.com>\njohn@example.com')).to.have.length(2);
      expect(parseDevOrgPersonList('')).to.deep.equal([]);
      expect(() => parseDevOrgPersonList('jane@example.com, not a person')).to.throw();
    });
  });

  describe('comments', () => {
    it('reads back what it writes, in Markdown and in HTML', () => {
      const data = orgData();
      for (const format of ['markdown', 'html'] as const) {
        const body = buildDevOrgCommentBody(data, format);
        expect(body).to.contain('Development org dev1');
        expect(parseDevOrgComment({ id: 1, body, createdDate: '' })?.data).to.deep.equal(data);
      }
    });

    it('ignores a comment written by a human, or by the scratch org pool', () => {
      expect(parseDevOrgComment({ id: 1, body: 'Hello', createdDate: '' })).to.equal(null);
      expect(parseDevOrgComment({ id: 1, body: '[sfdx-hardis-pool-data:e30]', createdDate: '' })).to.equal(null);
    });
  });

  describe('analyzeDevOrgComments', () => {
    it('keeps the newest comment of an org and lists the older ones as obsolete', () => {
      const old = comment(orgData({ users: [john] }));
      const recent = comment(orgData({ users: [] }));
      const state = analyzeDevOrgComments([recent, old], NOW);
      expect(state.orgs.map((org) => org.id)).to.deep.equal([recent.id]);
      expect(state.obsolete.map((entry) => entry.id)).to.deep.equal([old.id]);
    });

    it('hides a removed org, and lists the removal after the comments it hides', () => {
      const entry = comment(orgData());
      const removal = comment(buildDevOrgRemoval(entry.data, jane, NOW));
      const state = analyzeDevOrgComments([entry, removal], NOW);
      expect(state.orgs).to.have.length(0);
      expect(state.obsolete.map((item) => item.id)).to.deep.equal([entry.id, removal.id]);
    });

    it('drops an expired scratch org', () => {
      const scratch = comment(orgData({ orgId: '00D000000000002AAA', orgType: 'scratch', expirationDate: '2026-11-01' }));
      const state = analyzeDevOrgComments([scratch], NOW);
      expect(state.orgs).to.have.length(0);
      expect(state.obsolete).to.have.length(1);
    });

    it('replaces a refreshed sandbox by its new org id', () => {
      const before = comment(orgData({ registeredAt: '2026-10-01T00:00:00.000Z' }));
      const refreshed = comment(orgData({ orgId: '00D000000000009AAA', registeredAt: '2026-11-05T00:00:00.000Z', sandboxName: 'DEV1' }));
      const state = analyzeDevOrgComments([before, refreshed], NOW);
      expect(state.orgs.map((org) => org.data.orgId)).to.deep.equal(['00D000000000009AAA']);
      expect(state.obsolete.map((item) => item.id)).to.deep.equal([before.id]);
    });

    it('keeps the newest merged Pull Requests list of a branch', () => {
      const old = comment(branchData());
      const recent = comment(branchData({ computedAt: '2026-11-07T11:00:00.000Z' }));
      const state = analyzeDevOrgComments([old, recent], NOW);
      expect(state.branches.get('integration')?.id).to.equal(recent.id);
      expect(state.obsolete.map((item) => item.id)).to.deep.equal([old.id]);
    });
  });

  describe('applyDevOrgRegistration', () => {
    it('makes the person registering a new org its owner', () => {
      const result = applyDevOrgRegistration(null, { org: identity(), targetBranch: 'integration', currentUser: jane, addCurrentUser: true, featureBranch: 'feature/a' }, NOW);
      expect(result.isNew).to.equal(true);
      expect(result.data.owner).to.deep.equal(jane);
      // The owner is not listed twice
      expect(result.data.users).to.deep.equal([]);
      expect(result.data.targetBranch).to.equal('integration');
      expect(result.data.featureBranches.map((branch) => branch.name)).to.deep.equal(['feature/a']);
    });

    it('keeps the registered target branch and says so when another one is used', () => {
      const result = applyDevOrgRegistration(orgData(), { org: identity(), targetBranch: 'uat', currentUser: john, addCurrentUser: true }, NOW);
      expect(result.data.targetBranch).to.equal('integration');
      expect(result.otherTargetBranch).to.equal('integration');
      expect(result.data.users).to.deep.equal([john]);
    });

    it('changes the target branch when asked to', () => {
      const result = applyDevOrgRegistration(orgData(), { org: identity(), targetBranch: 'uat', setTargetBranch: true }, NOW);
      expect(result.data.targetBranch).to.equal('uat');
      expect(result.otherTargetBranch).to.equal(null);
    });

    it('sets the owner, replaces, adds and removes users', () => {
      const result = applyDevOrgRegistration(
        orgData({ users: [john] }),
        { org: identity(), owner: john, users: [jane, john], addUsers: [{ name: 'Ann', email: 'ann@example.com' }], removeUsers: ['JANE@example.com'] },
        NOW
      );
      expect(result.data.owner).to.deep.equal(john);
      expect(result.data.users.map((user) => user.email)).to.deep.equal(['ann@example.com']);
    });

    it('writes nothing when only the activity changed less than a day ago', () => {
      const existing = orgData({ lastActivityAt: '2026-11-07T08:00:00.000Z' });
      const result = applyDevOrgRegistration(existing, { org: identity(), targetBranch: 'integration', currentUser: jane, addCurrentUser: true }, NOW);
      expect(result.changed).to.equal(false);
      expect(result.data).to.equal(existing);
    });

    it('writes the activity again after a day', () => {
      const result = applyDevOrgRegistration(orgData({ lastActivityAt: '2026-11-05T08:00:00.000Z' }), { org: identity(), currentUser: jane }, NOW);
      expect(result.changed).to.equal(true);
      expect(result.data.lastActivityAt).to.equal(NOW.toISOString());
    });

    it('records a backpromote', () => {
      const lastBackpromote = { date: '2026-11-07T09:00:00.000Z', parentBranch: 'integration', pullRequest: 12 };
      const result = applyDevOrgRegistration(orgData(), { org: identity(), lastBackpromote }, NOW);
      expect(result.changed).to.equal(true);
      expect(result.data.lastBackpromote).to.deep.equal(lastBackpromote);
    });
  });

  describe('behind', () => {
    it('starts at the last backpromote from the target branch, else at the registration', () => {
      const registered = orgData();
      expect(devOrgStartDate(registered)).to.equal(registered.registeredAt);
      const fromTarget = orgData({ lastBackpromote: { date: '2026-11-05T00:00:00.000Z', parentBranch: 'integration', pullRequest: 3 } });
      expect(devOrgStartDate(fromTarget)).to.equal('2026-11-05T00:00:00.000Z');
      const fromOther = orgData({ lastBackpromote: { date: '2026-11-05T00:00:00.000Z', parentBranch: 'uat', pullRequest: 3 } });
      expect(devOrgStartDate(fromOther)).to.equal(fromOther.registeredAt);
    });

    it('counts the Pull Requests merged after the start, a vehicle counting one', () => {
      const branch = branchData({
        merges: [
          merge(1, '2026-10-20T00:00:00.000Z'),
          merge(2, '2026-11-02T00:00:00.000Z'),
          merge(3, '2026-11-06T00:00:00.000Z', { vehicle: true, sourceBranch: 'promotion/uat/main/2026-11-06-1', carried: [{ number: 7, title: '', url: '' }, { number: 8, title: '', url: '' }] }),
        ],
      });
      const behind = computeDevOrgBehind(orgData(), branch, NOW)!;
      expect(behind.count).to.equal(2);
      expect(behind.pullRequests.map((pr) => pr.number)).to.deep.equal([3, 2]);
      expect(behind.oldestMergedAt).to.equal('2026-11-02T00:00:00.000Z');
      expect(behind.oldestDays).to.equal(5);
      expect(behind.cutOff).to.equal(false);
    });

    it('is unknown until the merges are listed from the start of the org', () => {
      expect(computeDevOrgBehind(orgData(), null, NOW)).to.equal(null);
      expect(computeDevOrgBehind(orgData(), branchData({ since: '2026-11-03T00:00:00.000Z' }), NOW)).to.equal(null);
    });

    it('says when the lookback limit cut the count', () => {
      const behind = computeDevOrgBehind(orgData(), branchData({ since: '2026-11-03T00:00:00.000Z', capped: true, merges: [merge(4, '2026-11-04T00:00:00.000Z')] }), NOW)!;
      expect(behind.count).to.equal(1);
      expect(behind.cutOff).to.equal(true);
    });

    it('lists a branch from the oldest start, within the lookback limit', () => {
      const recent = branchWindowStart([orgData()], NOW);
      expect(recent).to.deep.equal({ since: '2026-11-01T00:00:00.000Z', capped: false });
      const old = branchWindowStart([orgData({ registeredAt: '2025-01-01T00:00:00.000Z' })], NOW);
      expect(old.capped).to.equal(true);
      expect(Date.parse(old.since)).to.equal(NOW.getTime() - DEV_ORGS_MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    });

    it('keeps what a vehicle carries once it is known', () => {
      const previous = branchData({ merges: [merge(5, '2026-11-02T00:00:00.000Z', { vehicle: true, carried: [{ number: 1, title: 'US 1', url: 'u' }] })] });
      const merges = buildBranchMerges([merge(5, '2026-11-02T00:00:00.000Z', { vehicle: true, carried: null }), merge(6, '2026-09-01T00:00:00.000Z')], previous, '2026-10-01T00:00:00.000Z');
      expect(merges.map((entry) => entry.number)).to.deep.equal([5]);
      expect(merges[0].carried).to.deep.equal([{ number: 1, title: 'US 1', url: 'u' }]);
    });
  });

  describe('people and status', () => {
    it('reads "Name <email>" and a bare email', () => {
      expect(parseDevOrgPerson('Jane Doe <jane@example.com>')).to.deep.equal(jane);
      expect(parseDevOrgPerson('jane@example.com')).to.deep.equal({ name: 'jane', email: 'jane@example.com' });
      expect(parseDevOrgPerson('<jane.doe@example.com>')).to.deep.equal({ name: 'jane.doe', email: 'jane.doe@example.com' });
      expect(parseDevOrgPerson('Jane Doe')).to.equal(null);
    });

    it('knows the orgs of the current user, whatever the case of the email', () => {
      expect(isDevOrgMine(orgData(), { name: 'x', email: 'JANE@example.com' })).to.equal(true);
      expect(isDevOrgMine(orgData({ users: [john] }), john)).to.equal(true);
      expect(isDevOrgMine(orgData(), john)).to.equal(false);
      expect(isDevOrgMine(orgData(), null)).to.equal(false);
    });

    it('marks an org stale after the configured days, and a scratch org expired after its day', () => {
      expect(isDevOrgStale({ lastActivityAt: '2026-10-01T00:00:00.000Z' }, 30, NOW)).to.equal(true);
      expect(isDevOrgStale({ lastActivityAt: '2026-10-20T00:00:00.000Z' }, 30, NOW)).to.equal(false);
      expect(isDevOrgExpired({ orgType: 'scratch', expirationDate: '2026-11-07' }, NOW)).to.equal(false);
      expect(isDevOrgExpired({ orgType: 'scratch', expirationDate: '2026-11-05' }, NOW)).to.equal(true);
      expect(isDevOrgExpired({ orgType: 'sandbox', expirationDate: '2026-11-05' }, NOW)).to.equal(false);
    });
  });

  describe('buildDevOrgsDashboardBody', () => {
    it('renders one table per target branch, with what each org misses', () => {
      const state = analyzeDevOrgComments(
        [
          comment(orgData({ users: [john] })),
          comment(branchData({ merges: [merge(9, '2026-11-06T00:00:00.000Z', { vehicle: true, carried: [{ number: 1, title: '', url: '' }, { number: 2, title: '', url: '' }] })] })),
          comment(orgData({ orgId: '00D000000000003AAA', sandboxName: 'dev3', name: 'dev3', targetBranch: 'uat' })),
        ],
        NOW
      );
      const summary = buildDevOrgsSummary(state, { enabled: true, dashboardUrl: null, currentUser: john, staleDays: 30 }, NOW);
      expect(summary.orgs.map((org) => [org.name, org.isMine])).to.deep.equal([
        ['dev1', true],
        ['dev3', false],
      ]);
      const body = buildDevOrgsDashboardBody(summary, 'markdown');
      expect(body).to.contain('## Target branch integration');
      expect(body).to.contain('## Target branch uat');
      expect(body).to.contain('1 (1 carrying 2 Pull Requests)');
      expect(body).to.contain('Not computed yet');
      expect(body).to.contain('Do not edit this text');
      const html = buildDevOrgsDashboardBody(summary, 'html');
      expect(html).to.contain('<h3>Target branch integration</h3>');
      expect(html).not.to.contain('## ');
    });
  });
});
