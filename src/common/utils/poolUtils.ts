import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { getConfig } from "../../config";
import { createTempDir, execSfdxJson, isCI, uxLog } from ".";
import { KeyValueProviderInterface } from "./keyValueUtils";
import { KeyValueXyzProvider } from "../keyValueProviders/keyValueXyz";
import { KvdbIoProvider } from "../keyValueProviders/kvdbIo";
import { LocalTestProvider } from "../keyValueProviders/localtest";
import { SfdxError } from "@salesforce/core";
import { prompts } from "./prompts";

let keyValueProvider: KeyValueProviderInterface;

export async function getPoolConfig() {
  const config = await getConfig("branch");
  return config.poolConfig || null;
}

export async function hasPoolConfig() {
  const poolConfig = await getPoolConfig();
  return poolConfig !== null;
}

// Read scratch org pool remote storage
export async function getPoolStorage() {
  const providerInitialized = await initializeProvider();
  if (providerInitialized) {
    return keyValueProvider.getValue(null);
  }
  return null;
}

// Write scratch org pool remote storage
export async function setPoolStorage(value: any) {
  const providerInitialized = await initializeProvider();
  if (providerInitialized) {
    uxLog(this, "[pool] " + c.grey(`Updating poolstorage value...`));
    const valueSetRes = keyValueProvider.setValue(null, value);
    uxLog(this, "[pool] "+c.grey(`Updated poolstorage value`));
    return valueSetRes;
  }
  return null;
}

// Write scratch org pool remote storage
export async function addScratchOrgToPool(scratchOrg: any, options: { position: string } = { position: "last" }) {
  const poolStorage = await getPoolStorage();
  // Valid scratch orgs
  if (scratchOrg.status === 0) {
    const scratchOrgs = poolStorage.scratchOrgs || [];
    if (options.position === "first") {
      scratchOrgs.push(scratchOrg);
    } else {
      scratchOrgs.unshift(scratchOrg);
    }
    poolStorage.scratchOrgs = scratchOrgs;
    await setPoolStorage(poolStorage);
  } else {
    // Store scratch creation errors
    const scratchOrgErrors = poolStorage.scratchOrgErrors || [];
    scratchOrgErrors.push(scratchOrg);
    poolStorage.scratchOrgErrors = scratchOrgErrors;
    await setPoolStorage(poolStorage);
  }
}

// Fetch a scratch org
export async function fetchScratchOrg() {
  const poolStorage = await getPoolStorage();
  if (poolStorage === null) {
    uxLog(this,"[pool] "+ c.yellow("No valid scratch pool storage has been reachable. Consider fixing the scratch pool config and auth"));
    return null;
  }
  uxLog(this,"[pool] "+c.cyan("Trying to fetch a scratch org from scratch orgs pool to improve performances"));
  const scratchOrgs: Array<any> = poolStorage.scratchOrgs;
  if (scratchOrgs.length > 0) {
    const scratchOrg = scratchOrgs.shift();
    // Remove and save
    poolStorage.scratchOrgs = scratchOrgs;
    await setPoolStorage(poolStorage);
    // Authenticate to scratch org
    uxLog(this,"[pool] "+c.cyan("Authenticating to scratch org from pool..."));
    const authTempDir = await createTempDir();
    const tmpAuthFile = path.join(authTempDir, "authFile.json");
    await fs.writeFile(tmpAuthFile, JSON.stringify(scratchOrg.authFileJson), "utf8");
    const authCommand = `sfdx auth:sfdxurl:store -f ${tmpAuthFile} --setdefaultusername --setalias ${scratchOrg.scratchOrgAlias}`;
    const authRes = await execSfdxJson(authCommand, this, { fail: false, output: true });
    if (authRes.status !== 0) {
      uxLog(this,c.yellow(`[pool] Unable to authenticate to org ${scratchOrg.scratchOrgAlias}: ${scratchOrg.scratchOrgUsername}\n${c.grey(JSON.stringify(authRes))}`));
      return null ;
    }
    // Remove temp auth file
    await fs.unlink(tmpAuthFile);
    // Return scratch org
    return scratchOrg ;
  }
  uxLog(this, "[pool]" + c.yellow(`No scratch org available in scratch org pool. You may increase ${c.white("poolConfig.maxScratchsOrgsNumber")} or schedule call to ${c.white("sfdx hardis:scratch:pool:refresh")} more often in CI`));
  return null;
}

export async function listKeyValueProviders(): Promise<Array<KeyValueProviderInterface>> {
  return [KvdbIoProvider, KeyValueXyzProvider, LocalTestProvider].map((cls) => new cls());
}

async function initializeProvider() {
  if (keyValueProvider) {
    return true ;
  }
  const poolConfig = await getPoolConfig();
  if (poolConfig.storageService) {
    keyValueProvider = await instanciateProvider(poolConfig.storageService);
    try {
      await keyValueProvider.initialize();
      return true;
    } catch (e) {
      // in CI, we should always be able to initialize the provider
      if (isCI) {
        throw e;
      }
      uxLog(this, "[pool] "+c.grey("Provider initialization error: " + e.message));
      // If manual, let's ask the user if he/she has credentials to input
      const resp = await prompts({
        type: "confirm",
        message: "Scratch org pool credentials are missing, do you want to configure them ?",
      });
      if (resp.value === true) {
        await keyValueProvider.userAuthenticate();
        await keyValueProvider.initialize();
        return true;
      }
      return false;
    }
  }
}

export async function instanciateProvider(storageService: string) {
  const providerClasses = await listKeyValueProviders();
  const providerClassRes = providerClasses.filter((cls) => cls.name === storageService);
  if (providerClassRes.length === 0) {
    throw new SfdxError(c.red("Unable to find class for storage provider " + storageService));
  }
  return providerClassRes[0];
}
