import c from 'chalk';
import fs from './fsUtils.js';
import { dateHelper } from './dateHelper.js';
import * as os from 'os';
import * as path from 'path';
import { getConfig, setConfig } from '../../config/index.js';
import { createTempDir, execSfdxJson, getCurrentGitBranch, isCI, uxLog } from './index.js';
import { PoolRefreshInfo, PoolStorageInterface, PoolTakeContext } from './keyValueUtils.js';
import { LocalTestProvider } from '../keyValueProviders/localtest.js';
import { SfError } from '@salesforce/core';
import { prompts } from './prompts.js';
import { SalesforceProvider } from '../keyValueProviders/salesforce.js';
import { BlobPoolAdapter } from '../keyValueProviders/blobPoolAdapter.js';
import { GitProviderPoolStorage } from '../keyValueProviders/gitProviderPool.js';
import { GitProvider } from '../gitProvider/index.js';
import { PoolSummary } from './poolDashboardUtils.js';
import { getDevHubScratchLimits } from './poolDevHubUtils.js';
import { t } from './i18n.js';

let poolStorage: PoolStorageInterface;

export async function getPoolConfig() {
  const config = await getConfig('branch');
  return config.poolConfig || null;
}

export async function hasPoolConfig() {
  const poolConfig = await getPoolConfig();
  return poolConfig !== null;
}

// The scratch orgs that can be taken from the pool, with their credentials
export async function listPoolOrgs(options: any = {}): Promise<any[]> {
  const storage = await getInitializedStorage(options);
  return storage ? await storage.listOrgs() : [];
}

export async function removePoolOrgs(scratchOrgs: any[], options: any = {}): Promise<void> {
  const storage = await getInitializedStorage(options);
  if (storage && scratchOrgs.length > 0) {
    uxLog("other", this, '[pool] ' + c.grey(`Updating pool storage value...`));
    await storage.removeOrgs(scratchOrgs);
    uxLog("other", this, '[pool] ' + c.grey(`Updated pool storage value.`));
  }
}

// What can be shown of the pool, without any credential. Null when the storage is not reachable.
export async function getPoolSummary(options: any = {}): Promise<PoolSummary | null> {
  const storage = await getInitializedStorage(options);
  if (!storage) {
    return null;
  }
  const summary = await storage.getSummary();
  // The limits of the Dev Hub are read live when it is connected: the storage only knows the
  // ones of the last refresh
  const liveLimits = await getDevHubScratchLimits(options.devHubConn);
  if (liveLimits) {
    summary.devHubLimits = liveLimits;
  }
  return summary;
}

export async function recordPoolFailure(error: string, options: any = {}): Promise<void> {
  const storage = await getInitializedStorage(options);
  if (storage) {
    await storage.recordFailure(error, (await GitProvider.getJobUrl()) || '');
  }
}

// To call at the end of a pool refresh
export async function finalizePoolRefresh(options: any = {}): Promise<void> {
  const storage = await getInitializedStorage(options);
  if (storage) {
    const info: PoolRefreshInfo = {
      jobUrl: (await GitProvider.getJobUrl()) || '',
      devHubLimits: await getDevHubScratchLimits(options.devHubConn),
    };
    await storage.finalizeRefresh(info);
  }
}

// Update ActiveScratchOrgInfo
export async function updateActiveScratchOrg(scratchOrg: string, keyValues: any, options: any = {}) {
  const storage = await getInitializedStorage(options);
  if (storage) {
    return await storage.updateActiveScratchOrg(scratchOrg, keyValues);
  }
  return null;
}

let updatingPool = false;
export async function addScratchOrgToPool(scratchOrg: any, options: any = { position: 'last' }) {
  if (updatingPool === true) {
    uxLog("log", this, c.grey(t('alreadyUpdatingScratchOrgPoolTryAgain')));
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return await addScratchOrgToPool(scratchOrg, options);
  } else {
    updatingPool = true;
    try {
      return await executeAddScratchOrgToPool(scratchOrg, options);
    } finally {
      updatingPool = false;
    }
  }
}

// Fetch a scratch org
export async function fetchScratchOrg(options: any) {
  try {
    const scratchOrg = await tryFetchScratchOrg(options);
    return scratchOrg;
  } catch (e) {
    uxLog(
      "warning",
      this,
      c.yellow(
        `[pool] Unable to fetch scratch org from pool. That's sad because it's faster !\nError: ${(e as Error).message}`
      )
    );
    return null;
  }
}

export async function tryFetchScratchOrg(options: any) {
  const storage = await getInitializedStorage(options);
  if (!storage) {
    uxLog(
      "warning",
      this,
      '[pool] ' +
      c.yellow('No valid scratch pool storage has been reachable. Consider fixing the scratch pool config and auth')
    );
    return null;
  }
  uxLog("other", this, '[pool] ' + c.cyan(t('tryingToFetchScratchOrgFromThe')));
  const scratchOrg = await storage.takeOrg(await buildTakeContext());
  if (scratchOrg) {
    await updateActiveScratchOrg(scratchOrg, {
      Description: `Fetched by ${os.userInfo().username} on ${dateHelper().format('YYYYMMDD_hhmm')}`,
    });
    // Authenticate to scratch org
    uxLog("action", this, '[pool] ' + c.cyan(t('authenticatingToScratchOrgFromPool')));
    const authTempDir = await createTempDir();
    const tmpAuthFile = path.join(authTempDir, 'authFile.txt');
    const authFileContent =
      scratchOrg.scratchOrgSfdxAuthUrl || (scratchOrg.authFileJson ? JSON.stringify(scratchOrg.authFileJson) : null);
    if (authFileContent == null) {
      uxLog(
        "warning",
        this,
        c.yellow(
          `[pool] Unable to authenticate to org ${scratchOrg.scratchOrgAlias}: ${scratchOrg.scratchOrgUsername} (missing sfdxAuthUrl)`
        )
      );
      return null;
    }
    await fs.writeFile(tmpAuthFile, authFileContent, 'utf8');
    const authCommand = `sf org login sfdx-url --sfdx-url-file ${tmpAuthFile} --set-default --alias ${scratchOrg.scratchOrgAlias}`;
    const authRes = await execSfdxJson(authCommand, this, { fail: false, output: false });
    if (authRes.status !== 0) {
      uxLog(
        "warning",
        this,
        c.yellow(
          `[pool] Unable to authenticate to org ${scratchOrg.scratchOrgAlias}: ${scratchOrg.scratchOrgUsername
          }\n${c.grey(JSON.stringify(authRes))}`
        )
      );
      return null;
    }
    // Remove temp auth file
    await fs.unlink(tmpAuthFile);
    // Store sfdxAuthUrl for next step if we are in CI
    if (isCI) {
      await setConfig('user', { sfdxAuthUrl: authFileContent });
    }
    // Display org URL
    const openRes = await execSfdxJson(`sf org open --url-only --target-org ${scratchOrg.scratchOrgAlias}`, this, {
      fail: false,
      output: false,
    });
    uxLog("action", this, c.cyan(t('openScratchOrgWithUrl', { openRes: c.green(openRes?.result?.url) })));
    // Return scratch org
    await updateActiveScratchOrg(scratchOrg, {
      Description: `Authenticated by ${os.userInfo().username} on ${dateHelper().format('YYYYMMDD_hhmm')}`,
    });
    return scratchOrg;
  }
  uxLog(
    "warning",
    this,
    '[pool]' +
    c.yellow(
      `No scratch org available in scratch org pool. You may increase ${c.white(
        'poolConfig.maxScratchOrgsNumber'
      )} or schedule call to ${c.white('sf hardis:scratch:pool:refresh')} more often in CI`
    )
  );
  return null;
}

// The storages a pool can be configured with, the proposed one first
export async function listKeyValueProviders(): Promise<Array<PoolStorageInterface>> {
  return [new GitProviderPoolStorage(), new BlobPoolAdapter(new SalesforceProvider()), new BlobPoolAdapter(new LocalTestProvider())];
}

export async function instantiateProvider(storageService: string) {
  const providerClasses = await listKeyValueProviders();
  const providerClassRes = providerClasses.filter((cls) => cls.name === storageService);
  if (providerClassRes.length === 0) {
    throw new SfError(c.red('Unable to find class for storage provider ' + storageService));
  }
  return providerClassRes[0];
}

// Write scratch org pool remote storage
async function executeAddScratchOrgToPool(scratchOrg: any, options: any = { position: 'last' }) {
  // Valid scratch orgs
  if (scratchOrg.status === 0) {
    const storage = await getInitializedStorage(options);
    if (!storage) {
      return;
    }
    uxLog("other", this, '[pool] ' + c.grey(`Updating pool storage value...`));
    await storage.addOrg(scratchOrg, options.position === 'first' ? 'first' : 'last');
    uxLog("other", this, '[pool] ' + c.grey(`Updated pool storage value.`));
    await updateActiveScratchOrg(scratchOrg, {
      Description: `Added to pool by ${os.userInfo().username} on ${dateHelper().format('YYYYMMDD_hhmm')}`,
    });
  } else {
    uxLog("other", this, '[pool] ' + c.red(t('scratchOrgCreationError') + JSON.stringify(scratchOrg)));
  }
}

// Who is taking a scratch org, for the history of the pool
async function buildTakeContext(): Promise<PoolTakeContext> {
  let pullRequest = '';
  try {
    const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
    pullRequest = prInfo?.idStr ? `#${prInfo.idStr}` : '';
  } catch {
    pullRequest = '';
  }
  return {
    by: process.env.GITHUB_ACTOR || process.env.GITLAB_USER_LOGIN || process.env.BUILD_REQUESTEDFOR || os.userInfo().username,
    branch: (await getCurrentGitBranch()) || '',
    pullRequest,
    jobUrl: (await GitProvider.getJobUrl()) || '',
  };
}

// The storage of the pool, ready to use. Null when there is none, or when the user declined to authenticate.
async function getInitializedStorage(options: any): Promise<PoolStorageInterface | null> {
  const providerInitialized = await initializeProvider(options);
  return providerInitialized ? poolStorage : null;
}

async function initializeProvider(options: any) {
  if (poolStorage) {
    // A later caller can bring the Dev Hub connection an earlier one did not have
    await poolStorage.initialize(options);
    return true;
  }
  const poolConfig = await getPoolConfig();
  if (poolConfig?.storageService) {
    const storage = await instantiateProvider(poolConfig.storageService);
    try {
      await storage.initialize(options);
      poolStorage = storage;
      return true;
    } catch (e) {
      // in CI, we should always be able to initialize the provider. noPrompt: the caller handles the error itself
      if (isCI || options?.noPrompt === true) {
        throw e;
      }
      uxLog("other", this, '[pool] ' + c.grey(t('providerInitializationError') + (e as Error).message));
      // If manual, let's ask the user if he/she has credentials to input
      const resp = await prompts({
        type: 'confirm',
        message: t('scratchOrgPoolCredentialsAreMissingDo'),
        description: t('descConfigureScratchOrgPool'),
      });
      if (resp.value === true) {
        await storage.userAuthenticate(options);
        await storage.initialize(options);
        poolStorage = storage;
        return true;
      }
      return false;
    }
  }
  return false;
}
