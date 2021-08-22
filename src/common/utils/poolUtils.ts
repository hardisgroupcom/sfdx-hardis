import * as c from "chalk";
import * as fs from "fs-extra";
import * as os from 'os';
import * as path from "path";
import { getConfig } from "../../config";
import { SfdxError } from "@salesforce/core";
import { uxLog } from ".";
import axios from "axios";

let keyValueUrl = null ;
let poolStorageLocalFileName = null;

export async function getPoolConfig() {
  const config = await getConfig("branch");
  return config.poolConfig || null;
}

// Read scratch org pool remote storage
export async function getPoolStorage() {
  const poolConfig = await getPoolConfig();
  if (poolConfig == null ||
    poolConfig.storageService == null ||
    !["keyvalue.xyz", "localtest"].includes(poolConfig.storageService)) {
    throw new SfdxError(c.red('poolConfig.storageService must be set with one of the following values:\n- keyvalue.xyz\n- localtest"'));
  }
  // keyvalue.xyz
  else if (poolConfig.storageService === "keyvalue.xyz") {
    await getKeyValueXyzUrl();
    const response = await axios({
      method: "get",
      url: keyValueUrl,
      responseType: "json",
    });
    return response.data || {}
  }
  // local json file for tests
  else if (poolConfig.storageService === "localtest") {
    await getPoolStorageLocalFileName();
    if (fs.existsSync(poolStorageLocalFileName)) {
      return fs.readJsonSync(poolStorageLocalFileName);
    }
    return {}
  }
}

// Write scratch org pool remote storage
export async function setPoolStorage(poolStorage: any) {
  const poolConfig = await getPoolConfig();
  if (poolConfig.storageService === "keyvalue.xyz") {
    await getKeyValueXyzUrl();
    await axios({
      method: "post",
      url: keyValueUrl,
      responseType: "json",
      data: poolStorage
    });
  }
  else if (poolConfig.storageService === "localtest") {
    await getPoolStorageLocalFileName();
    await fs.writeFile(poolStorageLocalFileName, JSON.stringify(poolStorage, null, 2), "utf8");
  }
}

// Write scratch org pool remote storage
export async function addScratchOrgToPool(scratchOrg: any) {
  const poolStorage = await getPoolStorage();
  const scratchOrgs = poolStorage.scratchOrgs || [];
  scratchOrgs.push(scratchOrg);
  poolStorage.scratchOrgs = scratchOrgs;
  await setPoolStorage(poolStorage);
}

// Fetch a scratch org
export async function fetchScratchOrg() {
  const poolStorage = await getPoolStorage();
  const scratchOrgs: Array<any> = poolStorage.scratchOrgs;
  if (scratchOrgs.length > 0) {
    const scratchOrg = scratchOrgs.pop();
    // Remove and save
    poolStorage.scratchOrgs = scratchOrgs;
    await setPoolStorage(poolStorage);
    return scratchOrg;
  }
  return null;
}

// Build local storage file name
async function getPoolStorageLocalFileName(): Promise<string> {
  if (poolStorageLocalFileName == null) {
    const config = await getConfig("project");
    const projectName = config.projectName || 'default';
    poolStorageLocalFileName = path.join(os.homedir(), "poolStorage_" + projectName + ".json");
    uxLog(this, c.grey("Local test storage: " + poolStorageLocalFileName));
  }
  return poolStorageLocalFileName;
}

// Build keyvalue.xyz URL
async function getKeyValueXyzUrl(): Promise<string> {
  if (keyValueUrl == null) {
    const config = await getConfig("project");
    const projectName = config.projectName || 'default';
    const apiKey = config.keyValueXyzApiKey || process.env.KEY_VALUE_XYZ_API_KEY ;
    if (apiKey === null) {
      throw new SfdxError(c.red("You need to define an keyvalue.xyz apiKey in config.keyValueXyzApiKey or env var KEY_VALUE_XYZ_API_KEY"));
    }
    keyValueUrl = `https://api.keyvalue.xyz/${apiKey}/pool_${projectName}`;
    uxLog(this, c.grey("keyvalue.xyz url: "+keyValueUrl));
  }
  return keyValueUrl;
}