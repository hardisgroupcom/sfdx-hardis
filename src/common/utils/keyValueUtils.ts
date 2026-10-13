import { PoolDevHubLimits, PoolSummary } from './poolDashboardUtils.js';

// Storage that reads and writes the whole pool as one value (a record of the Dev Hub, a local file)
export interface KeyValueProviderInterface {
  name: string;
  description: string;
  userSetup(options?: any): Promise<boolean>;
  userAuthenticate(options?: any): Promise<boolean>;
  initialize(options?: any): Promise<boolean>;
  getValue(key: string | null): Promise<any>;
  setValue(key: string | null, value: any): Promise<boolean>;
  updateActiveScratchOrg(scratchOrg: any, keyValues: any);
}

// Who takes a scratch org from the pool, kept in the history of the pool
export interface PoolTakeContext {
  by: string;
  branch: string;
  pullRequest: string;
  jobUrl: string;
}

export interface PoolRefreshInfo {
  jobUrl: string;
  devHubLimits: PoolDevHubLimits | null;
}

// Storage of a scratch org pool, one scratch org at a time
export interface PoolStorageInterface {
  name: string;
  description: string;
  userSetup(options?: any): Promise<boolean>;
  userAuthenticate(options?: any): Promise<boolean>;
  initialize(options?: any): Promise<boolean>;
  // The scratch orgs that can be taken, with their credentials, the next one to be taken first
  listOrgs(): Promise<any[]>;
  addOrg(scratchOrg: any, position: 'first' | 'last'): Promise<void>;
  // Removes a scratch org from the pool and returns it. Null when the pool has none to give.
  takeOrg(context: PoolTakeContext): Promise<any | null>;
  removeOrgs(scratchOrgs: any[]): Promise<void>;
  recordFailure(error: string, jobUrl: string): Promise<void>;
  // Called at the start of a pool refresh, before the scratch orgs of the pool are counted.
  // Throws when the pool must not be refreshed from here.
  prepareRefresh(): Promise<void>;
  // Called at the end of a pool refresh: cleans what the storage has to clean and records the refresh
  finalizeRefresh(info: PoolRefreshInfo): Promise<void>;
  // What can be shown of the pool, without any credential
  getSummary(): Promise<PoolSummary>;
  updateActiveScratchOrg(scratchOrg: any, keyValues: any);
}
