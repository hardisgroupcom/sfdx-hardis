import { SfError } from '@salesforce/core';
import c from 'chalk';
import { getConfig } from '../../config/index.js';
import { GitProvider } from '../gitProvider/index.js';
import { DashboardRef, GitProviderRoot } from '../gitProvider/gitProviderRoot.js';
import { isCI, uxLog } from '../utils/index.js';
import { WebSocketClient } from '../websocketClient.js';
import { t } from '../utils/i18n.js';
import { PoolRefreshInfo, PoolStorageInterface, PoolTakeContext } from '../utils/keyValueUtils.js';
import {
  decryptPoolPayload,
  encryptPoolPayload,
  generatePoolEncryptionKey,
  getPoolEncryptionKey,
  getPoolKeyId,
  getPreviousPoolEncryptionKey,
  isPoolDataSignedBy,
  POOL_ENCRYPTION_KEY_ENV_VAR,
  POOL_PREVIOUS_ENCRYPTION_KEY_ENV_VAR,
  signPoolData,
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
const CLAIM_CONFIRMATION_DELAY_MS = 1500;

// Pool stored in a "Scratch Orgs Pool Dashboard" of the git provider: an issue (GitHub, GitLab), a
// work item (Azure DevOps) or a dedicated Pull Request (Bitbucket). One comment per scratch org,
// its credentials encrypted, and the body of the dashboard rebuilt from the comments.
export class GitProviderPoolStorage implements PoolStorageInterface {
  name = 'gitProvider';
  description = 'Use a "Scratch Orgs Pool Dashboard" of your git provider (issue, work item or Pull Request). Scratch org credentials are encrypted.';

  private gitProvider: GitProviderRoot | null;
  private dashboard: DashboardRef | null = null;
  private devHubConn: any = null;
  // Entries of a previous key are only removed by a CI job: on a workstation, a mistyped key
  // would otherwise delete every scratch org of the pool
  private dropsOtherKeyEntries: boolean = isCI;
  // Pause between the two readings that confirm a claim
  private claimConfirmationDelayMs = CLAIM_CONFIRMATION_DELAY_MS;
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

  // Entries of another key cannot be read anymore. A CI job removes them before it counts what
  // the pool misses. A workstation never does, and does not refill a pool it cannot read: a
  // mistyped key would otherwise empty the pool, or double it.
  async prepareRefresh() {
    const key = this.requireKey();
    await this.getDashboard(true);
    const pool = (await this.loadPool(false))!;
    const otherKeyEntries = pool.state.entries.filter((entry) => entry.data.keyId !== getPoolKeyId(key));
    if (this.dropsOtherKeyEntries) {
      await this.deleteUnsignedComments(pool.dashboard, key);
    }
    if (otherKeyEntries.length === 0) {
      return;
    }
    if (!this.dropsOtherKeyEntries) {
      throw new SfError(t('poolOtherKeyEntriesKept', { count: otherKeyEntries.length, variable: POOL_ENCRYPTION_KEY_ENV_VAR }));
    }
    const previousKey = getPreviousPoolEncryptionKey();
    let unverified = 0;
    for (const entry of otherKeyEntries) {
      // An entry with a claim is a scratch org somebody took: only its comment is removed.
      // An entry the previous key did not sign can be forged, with the id of any scratch org of
      // the Dev Hub: its comment is removed, nothing is deleted on its word.
      const taken = pool.state.claimsByEntry.has(entry.id);
      const verified = previousKey !== null && isPoolDataSignedBy(entry.data, previousKey);
      await this.provider().deleteDashboardComment(pool.dashboard, entry.id);
      if (!taken && verified) {
        await this.tryDeleteScratchOrg(entry);
      } else if (!taken) {
        unverified++;
      }
    }
    uxLog("warning", this, c.yellow('[pool] ' + t('poolEntriesDroppedKeyRotation', { count: otherKeyEntries.length })));
    if (unverified > 0) {
      uxLog("warning", this, c.yellow('[pool] ' + t('poolPreviousKeyNeeded', { count: unverified, variable: POOL_PREVIOUS_ENCRYPTION_KEY_ENV_VAR })));
    }
  }

  async finalizeRefresh(info: PoolRefreshInfo) {
    this.requireKey();
    await this.getDashboard(true);
    let pool = (await this.loadPool(false))!;
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
    // Read twice: a listing served a moment too early can miss the older claim of another job,
    // and both jobs would believe they won. The second reading, after a pause, sees it.
    let won = await this.isOldestClaim(dashboard, entry.id, claimId);
    if (won) {
      await new Promise((resolve) => setTimeout(resolve, this.claimConfirmationDelayMs));
      won = await this.isOldestClaim(dashboard, entry.id, claimId);
    }
    if (won) {
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

  private async isOldestClaim(dashboard: DashboardRef, entryId: number, claimId: number): Promise<boolean> {
    const claims = analyzePoolComments(await this.listPoolComments(dashboard), null).claimsByEntry.get(entryId) || [];
    return claims[0]?.id === claimId;
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

  // Opens a new dashboard holding the same comments, and closes the old one
  private async replaceDashboard(): Promise<void> {
    const oldDashboard = this.dashboard!;
    uxLog("log", this, c.grey('[pool] ' + t('poolDashboardRollover')));
    const copied = new Set<number>();
    const newEntryIds = new Map<number, number>();
    // Entries first: a claim names the comment id of its entry, and the copies get new ids
    const copyComments = async (target: DashboardRef) => {
      const comments = (await this.listPoolComments(oldDashboard)).filter((comment) => !copied.has(comment.id));
      for (const comment of [...comments.filter((candidate) => candidate.data.kind === 'entry'), ...comments.filter((candidate) => candidate.data.kind !== 'entry')]) {
        const data = { ...comment.data };
        if (data.kind === 'claim' && newEntryIds.has(Number(data.entry))) {
          data.entry = newEntryIds.get(Number(data.entry));
        }
        const newId = await this.provider().createDashboardComment(target, this.commentBody(data));
        if (data.kind === 'entry') {
          newEntryIds.set(comment.id, newId);
        }
        copied.add(comment.id);
      }
    };
    if (!this.provider().allowsTwoOpenDashboards()) {
      // The old one must be closed first. The new one is created without looking for it: the
      // listing of a provider can still return the dashboard that was closed a moment ago.
      const comments = await this.listPoolComments(oldDashboard);
      await this.provider().closeDashboard(oldDashboard);
      const newDashboard = await this.createEmptyDashboard();
      this.dashboard = newDashboard;
      for (const comment of [...comments.filter((candidate) => candidate.data.kind === 'entry'), ...comments.filter((candidate) => candidate.data.kind !== 'entry')]) {
        const data = { ...comment.data };
        if (data.kind === 'claim' && newEntryIds.has(Number(data.entry))) {
          data.entry = newEntryIds.get(Number(data.entry));
        }
        const newId = await this.provider().createDashboardComment(newDashboard, this.commentBody(data));
        if (data.kind === 'entry') {
          newEntryIds.set(comment.id, newId);
        }
      }
      return;
    }
    // The old dashboard stays the one every job finds until the copy is complete: a copy that
    // fails loses nothing, and the next refresh tries again
    const newDashboard = await this.createEmptyDashboard();
    try {
      await copyComments(newDashboard);
      await this.provider().closeDashboard(oldDashboard);
      // What jobs wrote on the old dashboard during the copy: a claim missed here would give its
      // scratch org a second time
      await copyComments(newDashboard);
    } catch (e) {
      await this.provider().closeDashboard(newDashboard).catch(() => undefined);
      throw e;
    }
    this.dashboard = newDashboard;
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

  // With the key, only the comments it signed are the pool: anyone who can comment on the
  // dashboard can write one that looks like a claim or an entry. The entries of another key are
  // kept apart, for the key rotation. Without the key nothing can be checked, and nothing is
  // acted upon either: the comments are only counted.
  private async listPoolComments(dashboard: DashboardRef): Promise<PoolComment[]> {
    const comments = (await this.provider().listDashboardComments(dashboard))
      .map((comment) => parsePoolComment(comment))
      .filter((comment): comment is PoolComment => comment !== null);
    const key = getPoolEncryptionKey();
    if (!key) {
      return comments;
    }
    const keyId = getPoolKeyId(key);
    return comments.filter((comment) => this.isSigned(comment, key) || (comment.data.kind === 'entry' && comment.data.keyId !== keyId));
  }

  // Signed with the key of the pool, or with the previous one during a key rotation
  private isSigned(comment: PoolComment, key: string): boolean {
    const previousKey = getPreviousPoolEncryptionKey();
    return isPoolDataSignedBy(comment.data, key) || (previousKey !== null && isPoolDataSignedBy(comment.data, previousKey));
  }

  // Comments that look like the pool and that no known key signed: what a previous key left
  // (claims, failures, refreshes), or forgeries. Removed by CI jobs only, like the entries.
  private async deleteUnsignedComments(dashboard: DashboardRef, key: string): Promise<void> {
    const comments = (await this.provider().listDashboardComments(dashboard))
      .map((comment) => parsePoolComment(comment))
      .filter((comment): comment is PoolComment => comment !== null);
    for (const comment of comments.filter((candidate) => candidate.data.kind !== 'entry' && !this.isSigned(candidate, key))) {
      // A comment of another account can be refused: it is ignored by every reader anyway
      await this.provider().deleteDashboardComment(dashboard, comment.id).catch(() => false);
    }
  }

  private async getDashboard(create: boolean): Promise<DashboardRef | null> {
    if (this.dashboard) {
      return this.dashboard;
    }
    await this.initialize();
    this.dashboard = await this.provider().findDashboard(this.dashboardTitle());
    if (!this.dashboard && create) {
      const created = await this.createEmptyDashboard();
      // Another job can have created it at the same moment: everybody keeps the oldest one
      const found = await this.provider().findDashboard(this.dashboardTitle()).catch(() => null);
      if (found && found.id < created.id) {
        await this.provider().closeDashboard(created).catch(() => undefined);
        this.dashboard = found;
      } else {
        this.dashboard = created;
      }
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

  // Every comment is written by a holder of the key, and signed with it
  private commentBody(data: PoolCommentData): string {
    const key = this.requireKey();
    const unsigned = { ...data };
    delete unsigned.mac;
    return buildPoolCommentBody({ ...unsigned, mac: signPoolData(unsigned, key) }, this.provider().getDashboardFormat());
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
