import c from 'chalk';
import fs from 'fs-extra';
import moment from 'moment';
import * as os from 'os';
import * as path from 'path';
import { getConfig, setConfig } from '../../config/index.js';
import { createTempDir, execSfdxJson, isCI, uxLog } from './index.js';
import { KeyValueProviderInterface } from './keyValueUtils.js';
import { LocalTestProvider } from '../keyValueProviders/localtest.js';
import { SfError } from '@salesforce/core';
import { prompts } from './prompts.js';
import { SalesforceProvider } from '../keyValueProviders/salesforce.js';

let keyValueProvider: KeyValueProviderInterface;

export async function getPoolConfig() {
  const config = await getConfig('branch');
  return config.poolConfig || null;
}

export async function hasPoolConfig() {
  const poolConfig = await getPoolConfig();
  return poolConfig !== null;
}

// Read scratch org pool remote storage
export async function getPoolStorage(options: any = {}) {
  const providerInitialized = await initializeProvider(options);
  if (providerInitialized) {
    return await keyValueProvider.getValue(null);
  }
  return null;
}

// Write scratch org pool remote storage
export async function setPoolStorage(value: any, options: any = {}) {
  const providerInitialized = await initializeProvider(options);
  if (providerInitialized) {
    uxLog(this, '[pool] ' + c.grey(`Updating poolstorage value...`));
    const valueSetRes = await keyValueProvider.setValue(null, value);
    uxLog(this, '[pool] ' + c.grey(`Updated poolstorage value`));
    return valueSetRes;
  }
  return null;
}

// Update ActiveScratchOrgInfo
export async function updateActiveScratchOrg(scratchOrg: string, keyValues: any, options: any = {}) {
  const providerInitialized = await initializeProvider(options);
  if (providerInitialized) {
    return await keyValueProvider.updateActiveScratchOrg(scratchOrg, keyValues);
  }
  return null;
}

let updatingPool = false;
export async function addScratchOrgToPool(scratchOrg: any, options: any = { position: 'last' }) {
  if (updatingPool === true) {
    uxLog(this, c.grey('Already updating scratch org pool: try again in 2000 ms'));
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return await addScratchOrgToPool(scratchOrg, options);
  } else {
    updatingPool = true;
    const res = await executeAddScratchOrgToPool(scratchOrg, options);
    updatingPool = false;
    return res;
  }
}

// Write scratch org pool remote storage
async function executeAddScratchOrgToPool(scratchOrg: any, options: any = { position: 'last' }) {
  const poolStorage = await getPoolStorage(options);
  // Valid scratch orgs
  if (scratchOrg.status === 0) {
    const scratchOrgs = poolStorage.scratchOrgs || [];
    if (options.position === 'first') {
      scratchOrgs.push(scratchOrg);
    } else {
      scratchOrgs.unshift(scratchOrg);
    }
    poolStorage.scratchOrgs = scratchOrgs;
    await setPoolStorage(poolStorage, options);
    await updateActiveScratchOrg(scratchOrg, {
      Description: `Added to pool by ${os.userInfo().username} on ${moment().format('YYYYMMDD_hhmm')}`,
    });
  } else {
    // Store scratch creation errors
    /*
    const scratchOrgErrors = poolStorage.scratchOrgErrors || [];
    scratchOrgErrors.push(scratchOrg);
    poolStorage.scratchOrgErrors = scratchOrgErrors;
    await setPoolStorage(poolStorage, options);
    */
    uxLog(this, '[pool] ' + c.red('Scratch org creation error: \n' + JSON.stringify(scratchOrg)));
  }
}

// Fetch a scratch org
export async function fetchScratchOrg(options: any) {
  try {
    const scratchOrg = await tryFetchScratchOrg(options);
    return scratchOrg;
  } catch (e) {
    uxLog(
      this,
      c.yellow(
        `[pool] Unable to fetch scratch org from pool. That's sad because it's faster !\nError: ${(e as Error).message}`
      )
    );
    return null;
  }
}

export async function tryFetchScratchOrg(options: any) {
  const poolStorage = await getPoolStorage(options);
  if (poolStorage === null) {
    uxLog(
      this,
      '[pool] ' +
      c.yellow('No valid scratch pool storage has been reachable. Consider fixing the scratch pool config and auth')
    );
    return null;
  }
  uxLog(this, '[pool] ' + c.cyan('Trying to fetch a scratch org from scratch orgs pool to improve performances'));
  const scratchOrgs: Array<any> = poolStorage.scratchOrgs || [];
  if (scratchOrgs.length > 0) {
    const scratchOrg = scratchOrgs.shift();
    await updateActiveScratchOrg(scratchOrg, {
      Description: `Fetched by ${os.userInfo().username} on ${moment().format('YYYYMMDD_hhmm')}`,
    });
    // Remove and save
    poolStorage.scratchOrgs = scratchOrgs;
    await setPoolStorage(poolStorage, options);
    // Authenticate to scratch org
    uxLog(this, '[pool] ' + c.cyan('Authenticating to scratch org from pool...'));
    const authTempDir = await createTempDir();
    const tmpAuthFile = path.join(authTempDir, 'authFile.txt');
    const authFileContent =
      scratchOrg.scratchOrgSfdxAuthUrl || (scratchOrg.authFileJson ? JSON.stringify(scratchOrg.authFileJson) : null);
    if (authFileContent == null) {
      uxLog(
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
    uxLog(this, c.cyan(`Open scratch org with url: ${c.green(openRes?.result?.url)}`));
    // Return scratch org
    await updateActiveScratchOrg(scratchOrg, {
      Description: `Authenticated by ${os.userInfo().username} on ${moment().format('YYYYMMDD_hhmm')}`,
    });
    return scratchOrg;
  }
  uxLog(
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

export async function listKeyValueProviders(): Promise<Array<KeyValueProviderInterface>> {
  return [SalesforceProvider, LocalTestProvider].map((cls) => new cls());
}

async function initializeProvider(options: any) {
  if (keyValueProvider) {
    return true;
  }
  const poolConfig = await getPoolConfig();
  if (poolConfig.storageService) {
    keyValueProvider = await instantiateProvider(poolConfig.storageService);
    try {
      await keyValueProvider.initialize(options);
      return true;
    } catch (e) {
      // in CI, we should always be able to initialize the provider
      if (isCI) {
        throw e;
      }
      uxLog(this, '[pool] ' + c.grey('Provider initialization error: ' + (e as Error).message));
      // If manual, let's ask the user if he/she has credentials to input
      const resp = await prompts({
        type: 'confirm',
        message: 'Scratch org pool credentials are missing, do you want to configure them ?',
      });
      if (resp.value === true) {
        await keyValueProvider.userAuthenticate(options);
        await keyValueProvider.initialize(options);
        return true;
      }
      return false;
    }
  }
}

export async function instantiateProvider(storageService: string) {
  const providerClasses = await listKeyValueProviders();
  const providerClassRes = providerClasses.filter((cls) => cls.name === storageService);
  if (providerClassRes.length === 0) {
    throw new SfError(c.red('Unable to find class for storage provider ' + storageService));
  }
  return providerClassRes[0];
}
