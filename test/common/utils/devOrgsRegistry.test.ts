import { expect } from 'chai';
import { DevOrgsRegistry } from '../../../src/common/utils/devOrgsRegistry.js';
import { DEV_ORGS_DASHBOARD_TITLE, DevOrgIdentity, parseDevOrgComment } from '../../../src/common/utils/devOrgsRules.js';
import { FakeDashboardProvider } from '../helpers/fakeDashboardProvider.js';

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

function mergedPr(number: number, mergedDate: string, overrides: any = {}) {
  return {
    idNumber: number,
    idStr: String(number),
    targetBranch: 'integration',
    sourceBranch: `feature/${number}`,
    title: `US ${number}`,
    description: '',
    authorName: 'jane',
    webUrl: `https://example.com/pr/${number}`,
    mergedDate,
    customBehaviors: {},
    providerInfo: {},
    ...overrides,
  };
}

function orgComments(provider: FakeDashboardProvider) {
  return provider
    .current()
    .comments.map((comment) => parseDevOrgComment(comment))
    .filter((comment) => comment?.data.kind === 'org');
}

function newRegistry(provider: FakeDashboardProvider) {
  return new DevOrgsRegistry(provider as any);
}

describe('DevOrgsRegistry', function () {
  this.timeout(30000);

  it('creates the dashboard at the first registration, with one comment for the org', async () => {
    const provider = new FakeDashboardProvider(false);
    const registry = newRegistry(provider);
    expect(await registry.load(false)).to.equal(null);
    const result = await registry.register({ org: identity(), targetBranch: 'integration', currentUser: jane, addCurrentUser: true, featureBranch: 'feature/a' });
    expect(result.isNew).to.equal(true);
    expect(provider.dashboards).to.have.length(1);
    expect(provider.current().title).to.equal(DEV_ORGS_DASHBOARD_TITLE);
    expect(orgComments(provider)).to.have.length(1);
    expect(provider.current().body).to.contain('## Target branch integration');
    expect(provider.current().body).to.contain('dev1');
  });

  it('writes nothing when the registration changes nothing', async () => {
    const provider = new FakeDashboardProvider(false);
    const registry = newRegistry(provider);
    await registry.register({ org: identity(), targetBranch: 'integration', currentUser: jane, addCurrentUser: true });
    const before = provider.current().comments.map((comment) => comment.id);
    const result = await newRegistry(provider).register({ org: identity(), targetBranch: 'integration', currentUser: jane, addCurrentUser: true });
    expect(result.changed).to.equal(false);
    expect(provider.current().comments.map((comment) => comment.id)).to.deep.equal(before);
  });

  it('replaces the comment of an org, and keeps working when the old one cannot be deleted', async () => {
    const provider = new FakeDashboardProvider(false);
    await newRegistry(provider).register({ org: identity(), targetBranch: 'integration', currentUser: jane, addCurrentUser: true });
    // Written by another account
    provider.protectedComments.add(provider.current().comments[0].id);
    const result = await newRegistry(provider).register({ org: identity(), targetBranch: 'uat', currentUser: john, addCurrentUser: true });
    expect(result.otherTargetBranch).to.equal('integration');
    expect(orgComments(provider)).to.have.length(2);
    const summary = await newRegistry(provider).summary({ currentUser: john, staleDays: 30 });
    expect(summary.orgs).to.have.length(1);
    expect(summary.orgs[0].users).to.deep.equal([john]);
    expect(summary.orgs[0].targetBranch).to.equal('integration');
    expect(summary.orgs[0].isMine).to.equal(true);
    // A cleanup with the rights deletes the leftover
    provider.protectedComments.clear();
    await newRegistry(provider).register({ org: identity(), targetBranch: 'integration', owner: john }, { fullCleanup: true });
    expect(orgComments(provider)).to.have.length(1);
  });

  it('replaces a refreshed sandbox by its new org id', async () => {
    const provider = new FakeDashboardProvider(false);
    await newRegistry(provider).register({ org: identity(), targetBranch: 'integration', currentUser: jane });
    const result = await newRegistry(provider).register({ org: identity({ orgId: '00D000000000009AAA' }), targetBranch: 'uat', currentUser: john });
    expect(result.isNew).to.equal(true);
    expect(result.data.owner).to.deep.equal(john);
    const summary = await newRegistry(provider).summary({ currentUser: null, staleDays: 30 });
    expect(summary.orgs.map((org) => [org.orgId, org.targetBranch])).to.deep.equal([['00D000000000009AAA', 'uat']]);
    expect(orgComments(provider)).to.have.length(1);
  });

  it('removes an org, and hides it behind a removal comment when its comment cannot be deleted', async () => {
    const provider = new FakeDashboardProvider(false);
    await newRegistry(provider).register({ org: identity(), targetBranch: 'integration', currentUser: jane });
    expect(await newRegistry(provider).remove('00D000000000001AAA', jane)).to.not.equal(null);
    expect(orgComments(provider)).to.have.length(0);
    expect(await newRegistry(provider).remove('00D000000000001AAA', jane)).to.equal(null);

    await newRegistry(provider).register({ org: identity(), targetBranch: 'integration', currentUser: jane });
    provider.protectedComments.add(provider.current().comments.find((comment) => parseDevOrgComment(comment)?.data.kind === 'org')!.id);
    await newRegistry(provider).remove('00D000000000001AAA', jane);
    expect(orgComments(provider)).to.have.length(2);
    expect((await newRegistry(provider).summary({ currentUser: null, staleDays: 30 })).orgs).to.have.length(0);
  });

  it('lists the merged Pull Requests of the target branches, and counts what each org misses', async () => {
    const provider = new FakeDashboardProvider(false);
    const registry = newRegistry(provider);
    await registry.register({ org: identity(), targetBranch: 'integration', currentUser: jane });
    // The registration already listed its branch once: count the listings of refreshBranches only
    provider.listPullRequestsCalls = [];
    const registeredAt = Date.now();
    provider.mergedPullRequests = [
      mergedPr(1, new Date(registeredAt - 60 * 60 * 1000).toISOString()),
      mergedPr(2, new Date(registeredAt + 60 * 1000).toISOString()),
      mergedPr(3, new Date(registeredAt + 2 * 60 * 1000).toISOString(), {
        sourceBranch: 'promotion/uat/integration/2026-11-07-1',
        description: '```yaml\npromotionPullRequests: [7, 8]\n```',
      }),
      mergedPr(4, new Date(registeredAt + 3 * 60 * 1000).toISOString(), { targetBranch: 'uat' }),
    ];
    // Merged after the registration: the listing is answered as if it ran later
    const warnings = await registry.refreshBranches({ jobUrl: 'https://example.com/job/1' });
    expect(warnings).to.deep.equal([]);
    expect(provider.listPullRequestsCalls).to.have.length(1);
    expect(provider.listPullRequestsCalls[0]).to.include({ status: 'merged', targetBranch: 'integration', minDateOn: 'merged' });
    const summary = await registry.summary({ currentUser: jane, staleDays: 30 });
    const behind = summary.orgs[0].behind!;
    expect(behind.count).to.equal(2);
    expect(behind.pullRequests.map((pr) => [pr.number, pr.vehicle])).to.deep.equal([
      [3, true],
      [2, false],
    ]);
    expect(behind.pullRequests[0].carried!.map((pr) => pr.number)).to.deep.equal([7, 8]);
    expect(summary.branches.map((branch) => [branch.name, branch.jobUrl])).to.deep.equal([['integration', 'https://example.com/job/1']]);
    expect(provider.current().body).to.contain('2 (1 carrying 2 Pull Requests)');

    // A second listing replaces the first one, and what the deployment job knew of a vehicle wins
    await newRegistry(provider).refreshBranches({ jobUrl: null, carried: { number: 3, pullRequests: [{ number: 9, title: 'US 9', url: 'u' }] } });
    const branchComments = provider.current().comments.filter((comment) => parseDevOrgComment(comment)?.data.kind === 'branch');
    expect(branchComments).to.have.length(1);
    const again = await newRegistry(provider).summary({ currentUser: jane, staleDays: 30 });
    expect(again.orgs[0].behind!.pullRequests[0].carried).to.deep.equal([{ number: 9, title: 'US 9', url: 'u' }]);
  });

  it('lists the branch of a registration at once, so a new or moved org is counted', async () => {
    const provider = new FakeDashboardProvider(false);
    await newRegistry(provider).register({ org: identity(), targetBranch: 'integration', currentUser: jane });
    expect(provider.listPullRequestsCalls.map((call) => call.targetBranch)).to.deep.equal(['integration']);
    const first = await newRegistry(provider).summary({ currentUser: jane, staleDays: 30 });
    expect(first.orgs[0].behind?.count).to.equal(0);

    // A registration that changes nothing on a counted branch lists nothing
    await newRegistry(provider).register({ org: identity(), targetBranch: 'integration', currentUser: jane, users: [john] });
    expect(provider.listPullRequestsCalls).to.have.length(1);

    // Moved to uat by a release manager: uat is listed now, not at the next merge into it
    await newRegistry(provider).register({ org: identity(), targetBranch: 'uat', setTargetBranch: true, currentUser: jane });
    expect(provider.listPullRequestsCalls.map((call) => call.targetBranch)).to.deep.equal(['integration', 'uat']);
    const moved = await newRegistry(provider).summary({ currentUser: jane, staleDays: 30 });
    expect(moved.orgs[0].targetBranch).to.equal('uat');
    expect(moved.orgs[0].behind?.count).to.equal(0);
  });

  it('finds an org by the 15-character form of its id', async () => {
    const provider = new FakeDashboardProvider(false);
    await newRegistry(provider).register({ org: identity(), targetBranch: 'integration', currentUser: jane });
    expect(await newRegistry(provider).remove('00D000000000001', jane)).to.not.equal(null);
    expect(orgComments(provider)).to.have.length(0);
  });

  it('moves to a new dashboard when the old one is worn out, without the obsolete comments', async () => {
    const provider = new FakeDashboardProvider(false);
    await newRegistry(provider).register({ org: identity(), targetBranch: 'integration', currentUser: jane });
    provider.protectedComments.add(provider.current().comments[0].id);
    provider.wornOut = true;
    await newRegistry(provider).register({ org: identity(), targetBranch: 'integration', owner: john, currentUser: john });
    expect(provider.dashboards.filter((dashboard) => !dashboard.closed)).to.have.length(1);
    expect(provider.dashboards[0].closed).to.equal(true);
    const copied = orgComments(provider);
    expect(copied).to.have.length(1);
    expect((copied[0]!.data as any).owner).to.deep.equal(john);
  });
});
