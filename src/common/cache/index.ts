import c from 'chalk';
import fs from '../utils/fsUtils.js';
import * as os from 'os';
import * as path from 'path';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';

const cacheFileName = path.join(os.homedir(), '.sfdx', '.sfdx-hardis-cache.json');
let MEMORY_CACHE: any = null;

/**
 * The content of a cache file. A file that cannot be read as a JSON object (cut short by a process
 * killed while writing it, edited by hand, emptied) is reset to {} rather than stopping the command:
 * it is only a cache, everything in it can be computed again.
 */
export async function readCacheFile(fileName: string): Promise<Record<string, any>> {
  if (!fs.existsSync(fileName)) {
    return {};
  }
  try {
    const content = await fs.readJson(fileName);
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      return content;
    }
    throw new Error('the file does not hold a JSON object');
  } catch (e) {
    uxLog("warning", this, c.yellow(t('cacheFileUnreadableReset', { file: fileName, message: (e as Error).message })));
    try {
      await fs.writeJson(fileName, {});
    } catch {
      // Read-only home folder: the cache stays in memory for this command
    }
    return {};
  }
}

const readCache = async (): Promise<void> => {
  if (process.env?.NO_CACHE) {
    MEMORY_CACHE = {};
    return;
  }
  if (MEMORY_CACHE == null) {
    MEMORY_CACHE = await readCacheFile(cacheFileName);
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
