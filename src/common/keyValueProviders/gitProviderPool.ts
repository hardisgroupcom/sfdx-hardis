import { SfError } from '@salesforce/core';
import c from 'chalk';
import { getConfig } from '../../config/index.js';
import { GitProvider } from '../gitProvider/index.js';
import { DashboardRef, GitProviderRoot } from '../gitProvider/gitProviderRoot.js';
import { uxLog } from '../utils/index.js';
import { WebSocketClient } from '../websocketClient.js';
import { t } from '../utils/i18n.js';
import { PoolRefreshInfo, PoolStorageInterface, PoolTakeContext } from '../utils/keyValueUtils.js';
import {
  decryptPoolPayload,
  encryptPoolPayload,
  generatePoolEncryptionKey,
  getPoolEncryptionKey,
  getPoolKeyId,
  POOL_ENCRYPTION_KEY_ENV_VAR,
} from '../utils/poolCryptoUtils.js';
import {
  analyzePoolComments,
  buildPoolCommentBody,
  buildPoolDashboardBody,
  buildPoolSummary,
  parsePoolComment,
  POOL_DASHBOARD_TITLE,
  POOL_FAILURES_SIZE,
  POOL_HISTORY_SIZE,
  PoolComment,
  PoolCommentData,
  PoolState,
  PoolSummary,
} from '../utils/poolDashboardUtils.js';
import { deleteScratchOrgFromDevHub, getScratchOrgId, updateActiveScratchOrgRecord } from '../utils/poolDevHubUtils.js';

// How many times a job tries another scratch org when the one it wanted was taken by another job
const MAX_TAKE_ATTEMPTS = 5;
// A claim this old is settled: the job that posted it has finished deciding whether it won
const SETTLED_CLAIM_MS = 5 * 60 * 1000;
const MAX_FAILURE_LENGTH = 500;

// Pool stored in a "Scratch Orgs Pool Dashboard" of the git provider: an issue (GitHub, GitLab), a
// work item (Azure DevOps) or a dedicated Pull Request (Bitbucket). One comment per scratch org,
// its credentials encrypted, and the body of the dashboard rebuilt from the comments.
export class GitProviderPoolStorage implements PoolStorageInterface {
  name = 'gitProvider';
  description = 'Use a "Scratch Orgs Pool Dashboard" of your git provider (issue, work item or Pull Request). Scratch org credentials are encrypted.';

  private gitProvider: GitProviderRoot | null;
  private dashboard: DashboardRef | null = null;
  private devHubConn: any = null;
  // Pool size chosen during the setup, before it is written in the configuration
  private maxScratchOrgsOverride: number | null = null;

  // gitProvider: only given by tests. The provider of the repository is detected otherwise.
  constructor(gitProvider: GitProviderRoot | null = null) {
    this.gitProvider = gitProvider;
  }

  async initialize(options: any = {}) {
    this.devHubConn = options?.devHubConn || this.devHubConn;
    if (!this.gitProvider) {
      const gitProvider = await GitProvider.getInstance();
      if (!gitProvider || !gitProvider.supportsDashboard()) {
        throw new SfError(t('poolGitProviderTokenMissing'));
      }
      this.gitProvider = gitProvider;
    }
    return true;
  }

  // Creates the dashboard, and the encryption key when the environment has none
  async userSetup(options: any = {}) {
    await this.initialize(options);
    this.maxScratchOrgsOverride = options.maxScratchOrgsNumber || null;
    if (!getPoolEncryptionKey()) {
      const key = generatePoolEncryptionKey();
      process.env[POOL_ENCRYPTION_KEY_ENV_VAR] = key;
      // <copy> shows the key with a copy button in the VS Code UI. The line stays out of the log file.
      const displayedKey = WebSocketClient.isAliveWithLwcUI() ? `<copy>${key}</copy>` : key;
      uxLog("action", this, c.cyan(t('poolEncryptionKeyGenerated', { variable: POOL_ENCRYPTION_KEY_ENV_VAR, key: c.green(displayedKey) })), { sensitive: true });
    }
    const dashboard = await this.getDashboard(true);
    await this.refreshDashboardBody();
    uxLog("success", this, c.green(t('poolDashboardCreated', { url: dashboard?.url })));
    return true;
  }

  // Nothing to log in to: tells whether the workstation has what it takes to use the pool
  async userAuthenticate(options: any = {}) {
    await this.initialize(options);
    const summary = await this.getSummary();
    if (summary.keyStatus === 'missing') {
      uxLog("warning", this, c.yellow(t('poolEncryptionKeyMissing', { variable: POOL_ENCRYPTION_KEY_ENV_VAR })));
      uxLog("action", this, c.cyan(t('poolEncryptionKeyWhereToSet', { variable: POOL_ENCRYPTION_KEY_ENV_VAR })));
      return false;
    }
    if (summary.keyStatus === 'mismatch') {
      uxLog("warning", this, c.yellow(t('poolEncryptionKeyMismatch', { variable: POOL_ENCRYPTION_KEY_ENV_VAR })));
      return false;
    }
    uxLog("success", this, c.green(t('poolLocalAuthOk')));
    return true;
  }

  async listOrgs() {
    const key = this.requireKey();
    const pool = await this.loadPool(false);
    if (!pool) {
      return [];
    }
    const scratchOrgs: any[] = [];
    for (const entry of pool.state.available) {
      const scratchOrg = this.decryptEntry(entry, key);
      if (scratchOrg) {
        scratchOrgs.push(scratchOrg);
      }
    }
    return scratchOrgs;
  }

  // A comment is always added last: the oldest scratch org is the next one taken
  async addOrg(scratchOrg: any) {
    const key = this.requireKey();
    const dashboard = await this.getDashboard(true);
    const data: PoolCommentData = {
      v: 1,
      kind: 'entry',
      alias: scratchOrg.scratchOrgAlias || '',
      username: scratchOrg.scratchOrgUsername || '',
      orgId: getScratchOrgId(scratchOrg),
      instanceUrl: scratchOrg.authFileJson?.result?.instanceUrl || '',
      createdDate: new Date().toISOString(),
      expirationDate: scratchOrg.authFileJson?.result?.expirationDate || '',
      keyId: getPoolKeyId(key),
      payload: encryptPoolPayload(scratchOrg, key),
    };
    await this.provider().createDashboardComment(dashboard!, this.commentBody(data));
    await this.refreshDashboardBody();
  }

  async takeOrg(context: PoolTakeContext) {
    const key = getPoolEncryptionKey();
    if (!key) {
      uxLog("warning", this, c.yellow('[pool] ' + t('poolEncryptionKeyMissing', { variable: POOL_ENCRYPTION_KEY_ENV_VAR })));
      return null;
    }
    for (let attempt = 0; attempt < MAX_TAKE_ATTEMPTS; attempt++) {
      const pool = await this.loadPool(false);
      if (!pool) {
        return null;
      }
      const candidate = pool.state.available.find((entry) => this.decryptEntry(entry, key) !== null);
      if (!candidate) {
        return null;
      }
      if (await this.claim(pool.dashboard, candidate, context)) {
        await this.refreshDashboardBody();
        return this.decryptEntry(candidate, key);
      }
      uxLog("log", this, c.grey('[pool] ' + t('poolOrgClaimedByAnotherJob', { alias: candidate.data.alias })));
      // Jobs that started together do not retry together
      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1500));
    }
    return null;
  }

  async removeOrgs(scratchOrgs: any[]) {
    const pool = await this.loadPool(false);
    if (!pool) {
      return;
    }
    const usernames = new Set(scratchOrgs.map((scratchOrg) => scratchOrg.scratchOrgUsername));
    for (const entry of pool.state.entries.filter((candidate) => usernames.has(candidate.data.username))) {
      await this.deleteEntry(pool, entry);
    }
    await this.refreshDashboardBody();
  }

  async recordFailure(error: string, jobUrl: string) {
    const dashboard = await this.getDashboard(true);
    const data: PoolCommentData = {
      v: 1,
      kind: 'failure',
      date: new Date().toISOString(),
      jobUrl,
      error: error.replace(/\s+/g, ' ').trim().slice(0, MAX_FAILURE_LENGTH),
    };
    await this.provider().createDashboardComment(dashboard!, this.commentBody(data));
  }

  async finalizeRefresh(info: PoolRefreshInfo) {
    const key = this.requireKey();
    await this.getDashboard(true);
    let pool = (await this.loadPool(false))!;
    // Entries of another key cannot be read anymore: their scratch orgs are deleted from the Dev Hub
    const otherKeyEntries = pool.state.entries.filter((entry) => entry.data.keyId !== getPoolKeyId(key));
    for (const entry of otherKeyEntries) {
      // An entry with a claim is a scratch org somebody took: only its comment is removed
      const taken = pool.state.claimsByEntry.has(entry.id);
      await this.provider().deleteDashboardComment(pool.dashboard, entry.id);
      if (!taken) {
        await this.tryDeleteScratchOrg(entry);
      }
    }
    if (otherKeyEntries.length > 0) {
      uxLog("warning", this, c.yellow('[pool] ' + t('poolEntriesDroppedKeyRotation', { count: otherKeyEntries.length })));
    }
    // Entries of scratch orgs already taken, that the job which took them could not delete itself.
    // A claim of the last minutes is left alone: its job may still be reading the comments.
    for (const entry of pool.state.entries) {
      const claims = pool.state.claimsByEntry.get(entry.id) || [];
      if (claims.length > 0 && Date.now() - Date.parse(claims[0].createdDate || claims[0].data.date || '') > SETTLED_CLAIM_MS) {
        await this.provider().deleteDashboardComment(pool.dashboard, entry.id);
      }
    }
    // Only the last fetches, the last failures and the last refresh are kept
    pool = (await this.loadPool(false))!;
    const outdated = [
      ...pool.state.history.slice(POOL_HISTORY_SIZE),
      ...pool.state.lostClaims.filter((claim) => Date.now() - Date.parse(claim.createdDate || claim.data.date || '') > SETTLED_CLAIM_MS),
      ...pool.state.failures.slice(POOL_FAILURES_SIZE),
      ...pool.state.states,
    ];
    for (const comment of outdated) {
      await this.provider().deleteDashboardComment(pool.dashboard, comment.id);
    }
    const stateData: PoolCommentData = { v: 1, kind: 'state', date: new Date().toISOString(), jobUrl: info.jobUrl, devHubLimits: info.devHubLimits };
    await this.provider().createDashboardComment(pool.dashboard, this.commentBody(stateData));
    if (await this.provider().isDashboardWornOut(pool.dashboard)) {
      await this.replaceDashboard();
    }
    await this.refreshDashboardBody();
    uxLog("log", this, c.grey('[pool] ' + t('poolDashboardUpdated', { url: this.dashboard?.url })));
  }

  async getSummary(): Promise<PoolSummary> {
    const key = getPoolEncryptionKey();
    const keyId = key ? getPoolKeyId(key) : null;
    const pool = await this.loadPool(false);
    const emptyState = analyzePoolComments([], keyId);
    return buildPoolSummary(pool?.state || emptyState, {
      storageService: this.name,
      dashboardUrl: pool?.dashboard.url || null,
      max: await this.getMaxScratchOrgs(),
      keyId,
    });
  }

  async updateActiveScratchOrg(scratchOrg: any, keyValues: any) {
    return updateActiveScratchOrgRecord(this.devHubConn, scratchOrg, keyValues);
  }

  // True when this job is the one that gets the scratch org of the entry
  private async claim(dashboard: DashboardRef, entry: PoolComment, context: PoolTakeContext): Promise<boolean> {
    const claimData: PoolCommentData = {
      v: 1,
      kind: 'claim',
      entry: entry.id,
      alias: entry.data.alias,
      by: context.by,
      branch: context.branch,
      pullRequest: context.pullRequest,
      jobUrl: context.jobUrl,
      date: new Date().toISOString(),
    };
    // Every job posts a claim then reads the comments back: the oldest claim of an entry wins, and
    // it stays on the dashboard as the proof the scratch org is taken. A job only ever has to
    // write its own comments: a developer is often not allowed to delete the comment the CI
    // account created, so removing the entry is a cleanup the next pool refresh finishes.
    const claimId = await this.provider().createDashboardComment(dashboard, this.commentBody(claimData));
    const comments = await this.listPoolComments(dashboard);
    const claims = analyzePoolComments(comments, null).claimsByEntry.get(entry.id) || [];
    if (claims[0]?.id === claimId) {
      try {
        await this.provider().deleteDashboardComment(dashboard, entry.id);
      } catch (e) {
        uxLog("log", this, c.grey('[pool] ' + t('poolEntryLeftForRefresh', { alias: entry.data.alias, message: (e as Error).message })));
      }
      return true;
    }
    await this.provider().deleteDashboardComment(dashboard, claimId);
    return false;
  }

  private async deleteEntry(pool: LoadedPool, entry: PoolComment): Promise<void> {
    await this.provider().deleteDashboardComment(pool.dashboard, entry.id);
    for (const claim of pool.state.claimsByEntry.get(entry.id) || []) {
      await this.provider().deleteDashboardComment(pool.dashboard, claim.id);
    }
  }

  private async tryDeleteScratchOrg(entry: PoolComment): Promise<void> {
    try {
      await deleteScratchOrgFromDevHub(this.devHubConn, entry.data.orgId);
    } catch (e) {
      uxLog("warning", this, c.yellow('[pool] ' + t('poolScratchOrgNotDeleted', { alias: entry.data.alias, message: (e as Error).message })));
    }
  }

  // Closes the dashboard and opens a new one holding the same comments
  private async replaceDashboard(): Promise<void> {
    const oldDashboard = this.dashboard!;
    const comments = await this.listPoolComments(oldDashboard);
    uxLog("log", this, c.grey('[pool] ' + t('poolDashboardRollover')));
    await this.provider().closeDashboard(oldDashboard);
    // Created without looking for it first: the listing of a provider can still return the
    // dashboard that was closed a moment ago
    const newDashboard = await this.createEmptyDashboard();
    this.dashboard = newDashboard;
    // Entries first: a claim names the comment id of its entry, and the copies get new ids
    const newEntryIds = new Map<number, number>();
    for (const comment of comments.filter((candidate) => candidate.data.kind === 'entry')) {
      newEntryIds.set(comment.id, await this.provider().createDashboardComment(newDashboard, this.commentBody(comment.data)));
    }
    for (const comment of comments.filter((candidate) => candidate.data.kind !== 'entry')) {
      const data = { ...comment.data };
      if (data.kind === 'claim' && newEntryIds.has(Number(data.entry))) {
        data.entry = newEntryIds.get(Number(data.entry));
      }
      await this.provider().createDashboardComment(newDashboard, this.commentBody(data));
    }
  }

  // Never fails the caller: the body is a display, the comments are the pool
  private async refreshDashboardBody(): Promise<void> {
    try {
      const dashboard = await this.getDashboard(false);
      if (!dashboard) {
        return;
      }
      const body = buildPoolDashboardBody(await this.getSummary(), this.provider().getDashboardFormat());
      await this.provider().updateDashboardBody(dashboard, this.dashboardTitle(), body);
    } catch (e) {
      uxLog("log", this, c.grey('[pool] ' + t('poolDashboardNotUpdated', { message: (e as Error).message })));
    }
  }

  private async loadPool(create: boolean): Promise<LoadedPool | null> {
    const dashboard = await this.getDashboard(create);
    if (!dashboard) {
      return null;
    }
    const key = getPoolEncryptionKey();
    const comments = await this.listPoolComments(dashboard);
    return { dashboard, state: analyzePoolComments(comments, key ? getPoolKeyId(key) : null) };
  }

  private async listPoolComments(dashboard: DashboardRef): Promise<PoolComment[]> {
    const comments = await this.provider().listDashboardComments(dashboard);
    return comments.map((comment) => parsePoolComment(comment)).filter((comment): comment is PoolComment => comment !== null);
  }

  private async getDashboard(create: boolean): Promise<DashboardRef | null> {
    if (this.dashboard) {
      return this.dashboard;
    }
    await this.initialize();
    this.dashboard = await this.provider().findDashboard(this.dashboardTitle());
    if (!this.dashboard && create) {
      this.dashboard = await this.createEmptyDashboard();
    }
    return this.dashboard;
  }

  private async createEmptyDashboard(): Promise<DashboardRef> {
    const emptySummary = buildPoolSummary(analyzePoolComments([], null), {
      storageService: this.name,
      dashboardUrl: null,
      max: await this.getMaxScratchOrgs(),
      keyId: null,
    });
    return this.provider().createDashboard(this.dashboardTitle(), buildPoolDashboardBody(emptySummary, this.provider().getDashboardFormat()));
  }

  private async getMaxScratchOrgs(): Promise<number> {
    if (this.maxScratchOrgsOverride) {
      return this.maxScratchOrgsOverride;
    }
    const config = await getConfig('branch');
    return config.poolConfig?.maxScratchOrgsNumber || 5;
  }

  private decryptEntry(entry: PoolComment, key: string): any | null {
    try {
      return decryptPoolPayload(entry.data.payload || '', key);
    } catch {
      return null;
    }
  }

  private dashboardTitle(): string {
    return this.provider().getDashboardTitle(POOL_DASHBOARD_TITLE);
  }

  private commentBody(data: PoolCommentData): string {
    return buildPoolCommentBody(data, this.provider().getDashboardFormat());
  }

  private requireKey(): string {
    const key = getPoolEncryptionKey();
    if (!key) {
      throw new SfError(t('poolEncryptionKeyMissing', { variable: POOL_ENCRYPTION_KEY_ENV_VAR }));
    }
    return key;
  }

  private provider(): GitProviderRoot {
    if (!this.gitProvider) {
      throw new SfError(t('poolGitProviderTokenMissing'));
    }
    return this.gitProvider;
  }
}

interface LoadedPool {
  dashboard: DashboardRef;
  state: PoolState;
}
