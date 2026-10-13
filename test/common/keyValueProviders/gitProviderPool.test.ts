import { expect } from 'chai';
import { GitProviderPoolStorage } from '../../../src/common/keyValueProviders/gitProviderPool.js';
import { DashboardComment, DashboardFormat, DashboardRef } from '../../../src/common/gitProvider/gitProviderRoot.js';
import { POOL_ENCRYPTION_KEY_ENV_VAR } from '../../../src/common/utils/poolCryptoUtils.js';
import { buildPoolCommentBody, parsePoolComment } from '../../../src/common/utils/poolDashboardUtils.js';

// A git provider kept in memory, with the two behaviors measured on the real ones: a delete that
// answers true to everybody (GitHub, GitLab, Bitbucket) or to the first caller only (Azure DevOps)
class FakeDashboardProvider {
  public dashboards: Array<{ ref: DashboardRef; title: string; body: string; closed: boolean; comments: DashboardComment[] }> = [];
  public wornOut = false;
  // Ids of the comments this client is not allowed to delete (written by another account)
  public undeletable = new Set<number>();
  private nextCommentId = 100;

  constructor(private atomicDelete: boolean, private format: DashboardFormat = 'markdown') { }

  supportsDashboard() {
    return true;
  }

  getDashboardTitle(title: string) {
    return title;
  }

  getDashboardFormat() {
    return this.format;
  }

  async findDashboard(title: string) {
    await this.networkDelay();
    return this.dashboards.find((dashboard) => dashboard.title === title && !dashboard.closed)?.ref || null;
  }

  async createDashboard(title: string, body: string) {
    const ref = { id: this.dashboards.length + 1, url: `https://example.com/dashboard/${this.dashboards.length + 1}` };
    this.dashboards.push({ ref, title, body, closed: false, comments: [] });
    return ref;
  }

  async updateDashboardBody(ref: DashboardRef, _title: string, body: string) {
    this.get(ref).body = body;
  }

  async listDashboardComments(ref: DashboardRef) {
    await this.networkDelay();
    return this.get(ref).comments.map((comment) => ({ ...comment }));
  }

  async createDashboardComment(ref: DashboardRef, body: string) {
    await this.networkDelay();
    const id = this.nextCommentId++;
    this.get(ref).comments.push({ id, body, createdDate: new Date().toISOString() });
    return id;
  }

  async deleteDashboardComment(ref: DashboardRef, commentId: number) {
    if (this.undeletable.has(commentId)) {
      throw new Error('403 Forbidden');
    }
    // The comment is looked up before the delay: simultaneous callers all find it
    const found = this.get(ref).comments.some((comment) => comment.id === commentId);
    await this.networkDelay();
    const stillThere = this.get(ref).comments.some((comment) => comment.id === commentId);
    this.get(ref).comments = this.get(ref).comments.filter((comment) => comment.id !== commentId);
    return this.atomicDelete ? stillThere : found;
  }

  async isDashboardWornOut() {
    return this.wornOut;
  }

  async closeDashboard(ref: DashboardRef) {
    this.get(ref).closed = true;
    this.wornOut = false;
  }

  current() {
    return this.dashboards.find((dashboard) => !dashboard.closed)!;
  }

  private get(ref: DashboardRef) {
    return this.dashboards.find((dashboard) => dashboard.ref.id === ref.id)!;
  }

  private async networkDelay() {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
  }
}

function fakeScratchOrg(index: number) {
  return {
    status: 0,
    scratchOrgAlias: `PO-org-${index}`,
    scratchOrgUsername: `user${index}@example.com`,
    scratchOrgSfdxAuthUrl: `force://PlatformCLI::secret-token-${index}@example.my.salesforce.com`,
    scratchOrgInfo: { orgId: `00D00000000000${index}AAA` },
    authFileJson: { result: { instanceUrl: 'https://example.my.salesforce.com', expirationDate: '2099-01-01' } },
  };
}

const takeContext = (index: number) => ({ by: `job-${index}`, branch: 'feature/x', pullRequest: '#1', jobUrl: `https://example.com/job/${index}` });

function newStorage(provider: FakeDashboardProvider, devHubConn: any = null) {
  const storage = new GitProviderPoolStorage(provider as any);
  (storage as any).devHubConn = devHubConn;
  return storage;
}

describe('GitProviderPoolStorage', function () {
  this.timeout(30000);
  let previousKey: string | undefined;

  beforeEach(() => {
    previousKey = process.env[POOL_ENCRYPTION_KEY_ENV_VAR];
    process.env[POOL_ENCRYPTION_KEY_ENV_VAR] = 'unit-test-key';
  });

  afterEach(() => {
    if (previousKey === undefined) {
      delete process.env[POOL_ENCRYPTION_KEY_ENV_VAR];
    } else {
      process.env[POOL_ENCRYPTION_KEY_ENV_VAR] = previousKey;
    }
  });

  for (const atomicDelete of [false, true]) {
    describe(atomicDelete ? 'provider with an atomic comment delete' : 'provider where every simultaneous delete succeeds', () => {
      it('never gives the same scratch org to two simultaneous jobs', async () => {
        const provider = new FakeDashboardProvider(atomicDelete);
        const writer = newStorage(provider);
        for (let index = 0; index < 4; index++) {
          await writer.addOrg(fakeScratchOrg(index));
        }
        const taken = await Promise.all(Array.from({ length: 9 }, (_, index) => newStorage(provider).takeOrg(takeContext(index))));
        const aliases = taken.filter((scratchOrg) => scratchOrg !== null).map((scratchOrg) => scratchOrg.scratchOrgAlias);
        expect(aliases).to.have.length(4);
        expect(new Set(aliases).size).to.equal(4);
        const summary = await writer.getSummary();
        expect(summary.available).to.equal(0);
        expect(summary.history).to.have.length(4);
      });

      it('gives the oldest scratch org first, with its credentials', async () => {
        const provider = new FakeDashboardProvider(atomicDelete);
        const storage = newStorage(provider);
        await storage.addOrg(fakeScratchOrg(1));
        await storage.addOrg(fakeScratchOrg(2));
        const scratchOrg = await storage.takeOrg(takeContext(1));
        expect(scratchOrg.scratchOrgAlias).to.equal('PO-org-1');
        expect(scratchOrg.scratchOrgSfdxAuthUrl).to.include('secret-token-1');
        expect((await storage.getSummary()).history[0]).to.include({ alias: 'PO-org-1', by: 'job-1', branch: 'feature/x' });
      });
    });
  }

  it('stores no credential in clear text, in the comments or in the body', async () => {
    const provider = new FakeDashboardProvider(false);
    const storage = newStorage(provider);
    await storage.addOrg(fakeScratchOrg(1));
    const dashboard = provider.current();
    expect(JSON.stringify(dashboard)).to.not.include('secret-token');
    const decoded = dashboard.comments.map((comment) => JSON.stringify(parsePoolComment(comment)?.data)).join('');
    expect(decoded).to.not.include('secret-token');
    expect(decoded).to.include('user1@example.com');
    expect(dashboard.body).to.include('PO-org-1');
    expect(JSON.stringify(await storage.getSummary())).to.not.include('secret-token');
  });

  it('writes HTML on a provider whose dashboard is HTML', async () => {
    const provider = new FakeDashboardProvider(true, 'html');
    const storage = newStorage(provider);
    await storage.addOrg(fakeScratchOrg(1));
    expect(provider.current().body).to.include('<table>');
    expect(provider.current().comments[0].body).to.include('<pre>');
    expect((await storage.takeOrg(takeContext(1))).scratchOrgAlias).to.equal('PO-org-1');
  });

  it('counts without the key, and takes or adds nothing', async () => {
    const provider = new FakeDashboardProvider(false);
    const storage = newStorage(provider);
    await storage.addOrg(fakeScratchOrg(1));
    delete process.env[POOL_ENCRYPTION_KEY_ENV_VAR];
    const summary = await storage.getSummary();
    expect(summary.available).to.equal(1);
    expect(summary.keyStatus).to.equal('missing');
    expect(await storage.takeOrg(takeContext(1))).to.equal(null);
    let error: Error | null = null;
    try {
      await storage.addOrg(fakeScratchOrg(2));
    } catch (e) {
      error = e as Error;
    }
    expect(error).to.not.equal(null);
    expect((await storage.getSummary()).available).to.equal(1);
  });

  it('answers an empty summary when the dashboard does not exist, without creating it', async () => {
    const provider = new FakeDashboardProvider(false);
    const summary = await newStorage(provider).getSummary();
    expect(summary.available).to.equal(0);
    expect(summary.dashboardUrl).to.equal(null);
    expect(provider.dashboards).to.have.length(0);
    expect(await newStorage(provider).takeOrg(takeContext(1))).to.equal(null);
  });

  it('drops the entries of a previous key at the next refresh, and deletes their scratch orgs', async () => {
    const provider = new FakeDashboardProvider(false);
    const deleted: string[] = [];
    const devHubConn = {
      sobject: () => ({
        findOne: async (conditions: any) => ({ Id: 'ASO_' + conditions.ScratchOrg }),
        destroy: async (id: string) => deleted.push(id),
      }),
    };
    const storage = newStorage(provider, devHubConn);
    await storage.addOrg(fakeScratchOrg(1));
    process.env[POOL_ENCRYPTION_KEY_ENV_VAR] = 'rotated-key';
    expect((await storage.getSummary()).keyStatus).to.equal('mismatch');
    expect(await storage.takeOrg(takeContext(1))).to.equal(null);
    await storage.finalizeRefresh({ jobUrl: 'https://example.com/job/9', devHubLimits: null });
    const summary = await storage.getSummary();
    expect(summary.available).to.equal(0);
    expect(summary.keyStatus).to.equal('ok');
    expect(summary.lastRefresh?.jobUrl).to.equal('https://example.com/job/9');
    expect(deleted).to.deep.equal(['ASO_00D000000000001']);
  });

  it('takes a scratch org without deleting the comment of another account, and never gives it twice', async () => {
    const provider = new FakeDashboardProvider(false);
    const storage = newStorage(provider);
    await storage.addOrg(fakeScratchOrg(1));
    await storage.addOrg(fakeScratchOrg(2));
    // The entries were written by the CI account: this developer can only delete their own comments
    for (const comment of provider.current().comments) {
      provider.undeletable.add(comment.id);
    }
    const taken = await Promise.all(Array.from({ length: 5 }, (_, index) => newStorage(provider).takeOrg(takeContext(index))));
    const aliases = taken.filter((scratchOrg) => scratchOrg !== null).map((scratchOrg) => scratchOrg.scratchOrgAlias);
    expect(aliases.sort()).to.deep.equal(['PO-org-1', 'PO-org-2']);
    const summary = await storage.getSummary();
    expect(summary.available).to.equal(0);
    expect(summary.history).to.have.length(2);
    expect(await newStorage(provider).takeOrg(takeContext(9))).to.equal(null);
  });

  it('removes at the next refresh the entry of a taken scratch org, and keeps its fetch in the history', async () => {
    const provider = new FakeDashboardProvider(false);
    const storage = newStorage(provider);
    await storage.addOrg(fakeScratchOrg(1));
    const dashboard = provider.current();
    const entryId = dashboard.comments[0].id;
    const oldClaim = buildPoolCommentBody({ v: 1, kind: 'claim', entry: entryId, alias: 'PO-org-1', by: 'developer', date: '2020-01-01T00:00:00Z' }, 'markdown');
    dashboard.comments.push({ id: 999, body: oldClaim, createdDate: '2020-01-01T00:00:00Z' });
    await storage.finalizeRefresh({ jobUrl: '', devHubLimits: null });
    expect(provider.current().comments.some((comment) => comment.id === entryId)).to.equal(false);
    const summary = await storage.getSummary();
    expect(summary.available).to.equal(0);
    expect(summary.history.map((fetch) => fetch.by)).to.deep.equal(['developer']);
  });

  it('leaves alone the entry of a claim of the last minutes: its job may still be reading the comments', async () => {
    const provider = new FakeDashboardProvider(false);
    const storage = newStorage(provider);
    await storage.addOrg(fakeScratchOrg(1));
    const dashboard = provider.current();
    const entryId = dashboard.comments[0].id;
    const claim = buildPoolCommentBody({ v: 1, kind: 'claim', entry: entryId, alias: 'PO-org-1', by: 'running-job', date: new Date().toISOString() }, 'markdown');
    dashboard.comments.push({ id: 999, body: claim, createdDate: new Date().toISOString() });
    await storage.finalizeRefresh({ jobUrl: '', devHubLimits: null });
    expect(provider.current().comments.some((comment) => comment.id === entryId)).to.equal(true);
    expect((await storage.getSummary()).available).to.equal(0);
  });

  it('removes scratch orgs, records failures, and keeps only the last refresh', async () => {
    const provider = new FakeDashboardProvider(false);
    const storage = newStorage(provider);
    await storage.addOrg(fakeScratchOrg(1));
    await storage.addOrg(fakeScratchOrg(2));
    await storage.removeOrgs([fakeScratchOrg(1)]);
    expect((await storage.listOrgs()).map((scratchOrg) => scratchOrg.scratchOrgAlias)).to.deep.equal(['PO-org-2']);
    await storage.recordFailure('Daily   limit\nexceeded ' + 'x'.repeat(1000), 'https://example.com/job/3');
    await storage.finalizeRefresh({ jobUrl: 'first', devHubLimits: null });
    await storage.finalizeRefresh({ jobUrl: 'second', devHubLimits: { activeScratchOrgs: { used: 1, max: 40 }, dailyScratchOrgs: { used: 2, max: 80 } } });
    const summary = await storage.getSummary();
    expect(summary.failures).to.have.length(1);
    expect(summary.failures[0].error.startsWith('Daily limit exceeded')).to.equal(true);
    expect(summary.failures[0].error.length).to.equal(500);
    expect(summary.lastRefresh?.jobUrl).to.equal('second');
    expect(summary.devHubLimits?.dailyScratchOrgs.max).to.equal(80);
    const states = provider.current().comments.filter((comment) => parsePoolComment(comment)?.data.kind === 'state');
    expect(states).to.have.length(1);
  });

  it('replaces a worn out dashboard by a new one holding the same pool', async () => {
    const provider = new FakeDashboardProvider(false);
    const storage = newStorage(provider);
    await storage.addOrg(fakeScratchOrg(1));
    await storage.addOrg(fakeScratchOrg(2));
    await storage.takeOrg(takeContext(1));
    provider.wornOut = true;
    await storage.finalizeRefresh({ jobUrl: '', devHubLimits: null });
    expect(provider.dashboards).to.have.length(2);
    expect(provider.dashboards[0].closed).to.equal(true);
    const summary = await newStorage(provider).getSummary();
    expect(summary.dashboardUrl).to.equal('https://example.com/dashboard/2');
    expect(summary.available).to.equal(1);
    expect(summary.history).to.have.length(1);
    expect((await newStorage(provider).takeOrg(takeContext(2))).scratchOrgAlias).to.equal('PO-org-2');
  });
});
