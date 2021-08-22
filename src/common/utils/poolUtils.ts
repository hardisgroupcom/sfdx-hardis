import * as c from "chalk";
import * as fs from "fs-extra";
import * as os from 'os';
import * as path from "path";
import { getConfig } from "../../config";
import { SfdxError } from "@salesforce/core";
import { uxLog } from ".";
import axios from "axios";

let keyValueUrl = null;
let keyValueSecret = null;
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
    !["kvdb.io", "keyvalue.xyz", "localtest"].includes(poolConfig.storageService)) {
    throw new SfdxError(c.red('poolConfig.storageService must be set with one of the following values:\n- keyvalue.xyz\n- localtest"'));
  }
  // kvdb.io
  else if (poolConfig.storageService === 'kvdb.io') {
    await getKvdbIoUrl();
    const response = await axios({
      method: "get",
      url: keyValueUrl,
      responseType: "json",
      headers: {
        "Authorization": "Bearer " + keyValueSecret
      }
    });
    return response.data
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
  // kvdb.io
  if (poolConfig.storageService === "kvdb.io") {
    await getKvdbIoUrl();
    await axios({
      method: "post",
      url: keyValueUrl,
      responseType: "json",
      data: JSON.stringify(poolStorage),
      headers: {
        "Authorization": "Bearer " + keyValueSecret
      }
    });
  }
  // keyvalue.xyz
  else if (poolConfig.storageService === "keyvalue.xyz") {
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
  if (scratchOrg.result) {
    const scratchOrgs = poolStorage.scratchOrgs || [];
    scratchOrgs.push(scratchOrg.result);
    poolStorage.scratchOrgs = scratchOrgs;
    await setPoolStorage(poolStorage);
  }
  else {
    const scratchOrgErrors = poolStorage.scratchOrgErrors || [];
    scratchOrgErrors.push(scratchOrg);
    poolStorage.scratchOrgErrors = scratchOrgErrors;
    await setPoolStorage(poolStorage);
  }
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
    const config = await getConfig("user");
    const projectName = config.projectName || 'default';
    const apiKey = config.keyValueXyzApiKey || process.env.KEY_VALUE_XYZ_API_KEY;
    if (apiKey === null) {
      throw new SfdxError(c.red("You need to define a keyvalue.xyz apiKey in config.keyValueXyzApiKey or env var KEY_VALUE_XYZ_API_KEY"));
    }
    keyValueUrl = `https://api.keyvalue.xyz/${apiKey}/pool_${projectName}`;
    uxLog(this, c.grey("keyvalue.xyz url: " + keyValueUrl));
  }
  return keyValueUrl;
}

// Build keyvalue.xyz URL
async function getKvdbIoUrl(): Promise<string> {
  if (keyValueUrl == null) {
    const config = await getConfig("user");
    const projectName = config.projectName || 'default';
    const kvdbIoBucketId = config.kvdbIoBucketId || process.env.KVDB_IO_BUCKET_ID;
    const kvdbIoSecretKey = config.kvdbIoSecretKey || process.env.KVDB_IO_SECRET_KEY;
    if (kvdbIoBucketId === null) {
      throw new SfdxError(c.red("You need to define an keyvalue.xyz apiKey in config.kvdbIoBucketId or env var KVDB_IO_BUCKET_ID"));
    }
    keyValueUrl = `https://kvdb.io/${kvdbIoBucketId}/pool_${projectName}`;
    keyValueSecret = kvdbIoSecretKey;
    uxLog(this, c.grey("kvdb.io url: " + keyValueUrl));
  }
  return keyValueUrl;
}