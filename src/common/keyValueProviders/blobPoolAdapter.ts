import { getConfig } from '../../config/index.js';
import { KeyValueProviderInterface, PoolStorageInterface } from '../utils/keyValueUtils.js';
import { daysUntil, PoolSummary } from '../utils/poolDashboardUtils.js';

// Pool storage on top of a provider that reads and writes the whole pool as one value: the
// Salesforce Dev Hub record and the local test file. Behavior is the one these storages always had.
export class BlobPoolAdapter implements PoolStorageInterface {
  name: string;
  description: string;

  constructor(private provider: KeyValueProviderInterface) {
    this.name = provider.name;
    this.description = provider.description;
  }

  async userSetup(options?: any) {
    return this.provider.userSetup(options);
  }

  async userAuthenticate(options?: any) {
    return this.provider.userAuthenticate(options);
  }

  async initialize(options?: any) {
    return this.provider.initialize(options);
  }

  async listOrgs() {
    return (await this.readPool()).scratchOrgs || [];
  }

  // 'last' puts the scratch org at the front, where takeOrg reads: a new scratch org is the next
  // one taken, and one put back after a failure ('first') waits behind the others
  async addOrg(scratchOrg: any, position: 'first' | 'last') {
    const pool = await this.readPool();
    const scratchOrgs = pool.scratchOrgs || [];
    if (position === 'first') {
      scratchOrgs.push(scratchOrg);
    } else {
      scratchOrgs.unshift(scratchOrg);
    }
    pool.scratchOrgs = scratchOrgs;
    await this.provider.setValue(null, pool);
  }

  async takeOrg() {
    const pool = await this.readPool();
    const scratchOrgs: any[] = pool.scratchOrgs || [];
    if (scratchOrgs.length === 0) {
      return null;
    }
    const scratchOrg = scratchOrgs.shift();
    pool.scratchOrgs = scratchOrgs;
    await this.provider.setValue(null, pool);
    return scratchOrg;
  }

  async removeOrgs(scratchOrgsToRemove: any[]) {
    const usernames = new Set(scratchOrgsToRemove.map((scratchOrg) => scratchOrg.scratchOrgUsername));
    const pool = await this.readPool();
    pool.scratchOrgs = (pool.scratchOrgs || []).filter((scratchOrg: any) => !usernames.has(scratchOrg.scratchOrgUsername));
    await this.provider.setValue(null, pool);
  }

  // This storage keeps no history
  async recordFailure() {
    return;
  }

  async prepareRefresh() {
    return;
  }

  async finalizeRefresh() {
    return;
  }

  async getSummary(): Promise<PoolSummary> {
    const config = await getConfig('branch');
    const scratchOrgs = await this.listOrgs();
    return {
      storageService: this.name,
      dashboardUrl: null,
      available: scratchOrgs.length,
      max: config.poolConfig?.maxScratchOrgsNumber || 5,
      canTake: true,
      keyStatus: 'notNeeded',
      orgs: scratchOrgs.map((scratchOrg: any) => ({
        alias: scratchOrg.scratchOrgAlias || '',
        username: scratchOrg.scratchOrgUsername || '',
        instanceUrl: scratchOrg.authFileJson?.result?.instanceUrl || '',
        createdDate: '',
        expirationDate: scratchOrg.authFileJson?.result?.expirationDate || '',
        daysLeft: daysUntil(scratchOrg.authFileJson?.result?.expirationDate),
      })),
      history: [],
      failures: [],
      lastRefresh: null,
      devHubLimits: null,
    };
  }

  async updateActiveScratchOrg(scratchOrg: any, keyValues: any) {
    return this.provider.updateActiveScratchOrg(scratchOrg, keyValues);
  }

  // The Salesforce storage answers "ERROR" when it has no connection
  private async readPool(): Promise<any> {
    const pool = await this.provider.getValue(null);
    return pool && typeof pool === 'object' ? pool : {};
  }
}
