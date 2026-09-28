import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { Connection } from '@salesforce/core';
import fs from '../utils/fsUtils.js';

// Cache of technical API calls (listMetadata, EntityDefinition...) scoped on the org Id.
// Each VS Code click starts a new CLI process, so the cache is kept on disk, one file per call:
// <home>/.sfdx/sfdx-hardis-cache/orgs/<orgId>/<key>.json, next to the global sfdx-hardis cache.
// Never use it for data the user asked to see fresh, such as dependencies or records.
// The expiry is long because callers check what could be outdated (a name missing from a cached list...),
// and a refreshed sandbox gets a new org Id. It mostly bounds the disk used by orgs that no longer exist.

const DEFAULT_TTL_DAYS = 30;
const MEMORY_CACHE = new Map<string, { cachedAt: number; value: unknown }>();
let expiredFilesPruned = false;

export function getOrgApiCacheRoot(): string {
  return (
    process.env.SFDX_HARDIS_ORG_API_CACHE_DIR || path.join(os.homedir(), '.sfdx', 'sfdx-hardis-cache', 'orgs')
  );
}

function getTtlMs(): number {
  const days = Number(process.env.SFDX_HARDIS_ORG_API_CACHE_TTL_DAYS ?? DEFAULT_TTL_DAYS);
  return (Number.isFinite(days) && days >= 0 ? days : DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000;
}

// Once per process: remove the expired files, and the folders of orgs left empty (deleted scratch orgs...)
async function pruneExpiredFiles(ttlMs: number): Promise<void> {
  if (expiredFilesPruned) {
    return;
  }
  expiredFilesPruned = true;
  const root = getOrgApiCacheRoot();
  try {
    for (const orgFolder of await fs.readdir(root)) {
      const orgPath = path.join(root, orgFolder);
      for (const file of await fs.readdir(orgPath)) {
        const filePath = path.join(orgPath, file);
        if (Date.now() - (await fs.stat(filePath)).mtimeMs > ttlMs) {
          await fs.remove(filePath);
        }
      }
      if ((await fs.readdir(orgPath)).length === 0) {
        await fs.remove(orgPath);
      }
    }
  } catch {
    // Pruning is best effort
  }
}

function getOrgId(conn: Connection): string | null {
  try {
    const orgId = conn.getAuthInfoFields()?.orgId;
    return orgId ? String(orgId) : null;
  } catch {
    return null;
  }
}

// Readable file name for the key, with a hash so that two keys never share a file
function cacheFile(orgId: string, key: string): string {
  const readable = key.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);
  return path.join(getOrgApiCacheRoot(), orgId, `${readable}-${hash}.json`);
}

export interface OrgApiCacheResult<T> {
  value: T;
  fromCache: boolean;
}

/**
 * Returns the cached result of fetchValue for this org and key, or calls it and caches the result.
 * Pass refresh: true to ignore the cached value (for example when it looks outdated).
 * No cache when NO_CACHE is set or when the org Id is unknown.
 */
export async function withOrgApiCache<T>(
  conn: Connection,
  key: string,
  fetchValue: () => Promise<T>,
  options: { refresh?: boolean } = {}
): Promise<OrgApiCacheResult<T>> {
  const orgId = getOrgId(conn);
  if (!orgId || process.env.NO_CACHE) {
    return { value: await fetchValue(), fromCache: false };
  }
  const file = cacheFile(orgId, key);
  const ttlMs = getTtlMs();
  if (!options.refresh && ttlMs > 0) {
    let entry = MEMORY_CACHE.get(file);
    if (!entry && fs.existsSync(file)) {
      try {
        entry = await fs.readJson(file);
      } catch {
        entry = undefined;
      }
    }
    if (entry && Date.now() - entry.cachedAt < ttlMs) {
      MEMORY_CACHE.set(file, entry);
      return { value: entry.value as T, fromCache: true };
    }
  }
  const value = await fetchValue();
  const entry = { cachedAt: Date.now(), value };
  MEMORY_CACHE.set(file, entry);
  try {
    await pruneExpiredFiles(ttlMs);
    await fs.ensureDir(path.dirname(file));
    await fs.writeJson(file, entry);
  } catch {
    // A cache that cannot be written only costs performance
  }
  return { value, fromCache: false };
}

export async function clearOrgApiCache(): Promise<void> {
  MEMORY_CACHE.clear();
  expiredFilesPruned = false;
  await fs.remove(getOrgApiCacheRoot());
}
