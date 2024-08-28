import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

const cacheFileName = path.join(os.homedir(), '.sfdx', '.sfdx-hardis-cache.json');
let MEMORY_CACHE: any = null;

const readCache = async (): Promise<void> => {
  if (process.env?.NO_CACHE) {
    MEMORY_CACHE = {};
    return;
  }
  if (MEMORY_CACHE == null) {
    if (fs.existsSync(cacheFileName)) {
      MEMORY_CACHE = await fs.readJson(cacheFileName);
    } else {
      MEMORY_CACHE = {};
    }
  }
};

const storeCache = async (): Promise<void> => {
  if (process.env?.NO_CACHE) {
    return;
  }
  if (!fs.existsSync(cacheFileName)) {
    await fs.ensureDir(path.dirname(cacheFileName));
  }
  await fs.writeJson(cacheFileName, MEMORY_CACHE);
};

// Get cache property
export const getCache = async (key: string, defaultVal: any): Promise<any> => {
  await readCache();
  if (MEMORY_CACHE[key]) {
    return MEMORY_CACHE[key];
  }
  return defaultVal || null;
};

// Set cache property
export const setCache = async (key: string, val: any): Promise<void> => {
  await readCache();
  MEMORY_CACHE[key] = val;
  await storeCache();
};

// Clear cache property, or all cache if property is empty
export const clearCache = async (key: string | null = null): Promise<void> => {
  await readCache();
  if (key) {
    delete MEMORY_CACHE[key];
  } else {
    MEMORY_CACHE = {};
  }
  await storeCache();
};
