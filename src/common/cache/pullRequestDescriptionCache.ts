/*
Local cache of Pull Request descriptions, shared with vscode-sfdx-hardis.

Why it exists: Azure DevOps truncates the description of a Pull Request returned by its LIST API at
400 characters, so everything that reads a description out of a listing - the promotionPullRequests
declaration of a promotion branch first of all - has to read the Pull Request again, one API call
each. On a repository with hundreds of Pull Requests that is hundreds of round trips per job.

Why caching is safe here: the description of a Pull Request that is merged or abandoned is
finished. It can still be edited by hand, which is why an entry expires (see MAX_AGE_DAYS), but it
does not change on its own. A Pull Request that is still OPEN is never cached, in either direction:
its description is exactly what people are still editing.

THE ON-DISK CONTRACT IS SHARED WITH vscode-sfdx-hardis. Its implementation lives in
`src/utils/pullRequestDescriptionCache.ts` and must be changed with this one:

  ~/.sfdx/sfdx-hardis-pr-cache/<provider>__<sanitized repository key>.json

  The repository key is the normalized git remote URL of the working copy, which is the one
  identifier the CLI and the extension are guaranteed to agree on (see repositoryKeyFromRemoteUrl):

  {
    "version": 1,
    "provider": "azure",
    "repository": "dev.azure.com/acme/salesforce/_git/sfdx-project",
    "pullRequests": {
      "38": { "description": "...", "state": "merged", "cachedAt": "2026-09-08T01:02:03.000Z" }
    }
  }

`state` is the normalized terminal state, `merged` or `closed`. Anything else is not written.
Set NO_CACHE=true, or SFDX_HARDIS_NO_PR_CACHE=true, to bypass it entirely.
*/

import fs from '../utils/fsUtils.js';
import * as os from 'os';
import * as path from 'path';

export const PR_DESCRIPTION_CACHE_VERSION = 1;

// A merged Pull Request description can still be edited by hand, so an entry does not live forever
export const MAX_AGE_DAYS = 90;

// A repository file holds at most this many entries: beyond it the oldest are dropped. Keeps the
// file small enough to read on every job even on a repository with a long history.
export const MAX_ENTRIES_PER_REPOSITORY = 5000;

export interface CachedPullRequestDescription {
  description: string;
  state: 'merged' | 'closed';
  cachedAt: string;
}

interface PullRequestCacheFile {
  version: number;
  provider: string;
  repository: string;
  pullRequests: Record<string, CachedPullRequestDescription>;
}

// One in-memory copy per repository key, so a job that reads fifty descriptions reads the file once
const MEMORY_CACHE: Map<string, PullRequestCacheFile> = new Map();

export function isPullRequestDescriptionCacheDisabled(): boolean {
  return !!process.env?.NO_CACHE || !!process.env?.SFDX_HARDIS_NO_PR_CACHE;
}

/**
 * The terminal states, normalized across providers. A description is only cached, and a cached one
 * is only used, when the Pull Request is in one of them: an open Pull Request is being edited.
 *
 * Bitbucket can REOPEN a declined Pull Request, and Azure DevOps can reactivate an abandoned one,
 * which is why the caller passes the state it sees right now rather than trusting the cached one.
 */
export function normalizeTerminalState(state: string | number | null | undefined): 'merged' | 'closed' | null {
  const value = String(state ?? '').toLowerCase();
  if (['merged', 'completed', '3'].includes(value)) {
    return 'merged';
  }
  if (['closed', 'declined', 'abandoned', 'superseded', '2'].includes(value)) {
    return 'closed';
  }
  return null;
}

/**
 * The repository key both tools build, so a cache warmed by one is read by the other.
 *
 * It is the git remote URL of the working copy, normalized: the CLI and the extension look at the
 * same clone, so this is the one identifier they are guaranteed to agree on. Deriving it from CI
 * variables instead would not work - BUILD_REPOSITORY_ID is a GUID on an Azure agent and the
 * repository name when sfdx-hardis parses the remote itself.
 *
 * Credentials, the protocol, a trailing .git and the case are all dropped, so the same repository
 * cloned with a token in the URL and cloned without one share their cache.
 */
export function repositoryKeyFromRemoteUrl(remoteUrl: string): string {
  const url = String(remoteUrl || "").trim();
  if (url === "") {
    return "unknown";
  }
  return url
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^/@]*@/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function pullRequestCacheDir(): string {
  return path.join(os.homedir(), '.sfdx', 'sfdx-hardis-pr-cache');
}

// Keeps the file name readable and safe on every filesystem
export function sanitizeRepositoryKey(repositoryKey: string): string {
  return (repositoryKey || 'unknown')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'unknown';
}

export function pullRequestCacheFile(provider: string, repositoryKey: string): string {
  return path.join(pullRequestCacheDir(), `${sanitizeRepositoryKey(provider)}__${sanitizeRepositoryKey(repositoryKey)}.json`);
}

function isExpired(entry: CachedPullRequestDescription): boolean {
  const cachedAt = Date.parse(entry?.cachedAt || '');
  if (isNaN(cachedAt)) {
    return true;
  }
  return Date.now() - cachedAt > MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

async function readCacheFile(provider: string, repositoryKey: string): Promise<PullRequestCacheFile> {
  const memoryKey = `${provider}__${repositoryKey}`;
  const inMemory = MEMORY_CACHE.get(memoryKey);
  if (inMemory) {
    return inMemory;
  }
  const empty: PullRequestCacheFile = {
    version: PR_DESCRIPTION_CACHE_VERSION,
    provider,
    repository: repositoryKey,
    pullRequests: {},
  };
  try {
    const file = pullRequestCacheFile(provider, repositoryKey);
    if (fs.existsSync(file)) {
      const parsed = await fs.readJson(file);
      // A file written by a newer version is left alone rather than misread
      if (parsed?.version === PR_DESCRIPTION_CACHE_VERSION && parsed?.pullRequests) {
        empty.pullRequests = parsed.pullRequests;
      }
    }
  } catch {
    // An unreadable cache is not an error: it only means the next read costs an API call
  }
  MEMORY_CACHE.set(memoryKey, empty);
  return empty;
}

/**
 * The cached description of a Pull Request, or null when there is none to use.
 *
 * `currentState` is the state the caller sees right now: a Pull Request that has been reopened is
 * read again, whatever the cache holds.
 */
export async function getCachedPullRequestDescription(
  provider: string,
  repositoryKey: string,
  pullRequestId: number | string,
  currentState: string | number | null | undefined,
): Promise<string | null> {
  if (isPullRequestDescriptionCacheDisabled() || normalizeTerminalState(currentState) === null) {
    return null;
  }
  const cache = await readCacheFile(provider, repositoryKey);
  const entry = cache.pullRequests[String(pullRequestId)];
  if (!entry || isExpired(entry) || entry.state !== normalizeTerminalState(currentState)) {
    return null;
  }
  return entry.description ?? null;
}

/**
 * Remember the description of a Pull Request that reached a terminal state.
 *
 * The file is re-read and merged before being written, then written through a temporary file and
 * renamed, so a CLI job and the VS Code extension writing at the same time cannot lose each
 * other's entries or leave a half-written file behind.
 */
export async function setCachedPullRequestDescription(
  provider: string,
  repositoryKey: string,
  pullRequestId: number | string,
  currentState: string | number | null | undefined,
  description: string,
): Promise<void> {
  const state = normalizeTerminalState(currentState);
  if (isPullRequestDescriptionCacheDisabled() || state === null || typeof description !== 'string') {
    return;
  }
  const memoryKey = `${provider}__${repositoryKey}`;
  const cache = await readCacheFile(provider, repositoryKey);
  cache.pullRequests[String(pullRequestId)] = { description, state, cachedAt: new Date().toISOString() };
  const file = pullRequestCacheFile(provider, repositoryKey);
  try {
    await fs.ensureDir(path.dirname(file));
    // Merge with whatever another process wrote since this one loaded the file
    let onDisk: Record<string, CachedPullRequestDescription> = {};
    if (fs.existsSync(file)) {
      try {
        const parsed = await fs.readJson(file);
        if (parsed?.version === PR_DESCRIPTION_CACHE_VERSION && parsed?.pullRequests) {
          onDisk = parsed.pullRequests;
        }
      } catch {
        // Corrupted file: it is replaced by this write
      }
    }
    const merged = pruneEntries({ ...onDisk, ...cache.pullRequests });
    cache.pullRequests = merged;
    MEMORY_CACHE.set(memoryKey, cache);
    const payload: PullRequestCacheFile = {
      version: PR_DESCRIPTION_CACHE_VERSION,
      provider,
      repository: repositoryKey,
      pullRequests: merged,
    };
    const tempFile = `${file}.${process.pid}.tmp`;
    await fs.writeJson(tempFile, payload);
    await fs.move(tempFile, file, { overwrite: true });
  } catch {
    // The cache is an optimization: failing to write it must never fail a deployment
  }
}

// Drops the expired entries, then the oldest ones above the per-repository cap
export function pruneEntries(
  entries: Record<string, CachedPullRequestDescription>,
): Record<string, CachedPullRequestDescription> {
  const alive = Object.entries(entries).filter(([, entry]) => entry && !isExpired(entry));
  if (alive.length <= MAX_ENTRIES_PER_REPOSITORY) {
    return Object.fromEntries(alive);
  }
  const newestFirst = alive.sort(
    (a, b) => Date.parse(b[1].cachedAt || '') - Date.parse(a[1].cachedAt || ''),
  );
  return Object.fromEntries(newestFirst.slice(0, MAX_ENTRIES_PER_REPOSITORY));
}

// Testing seam: forget what was loaded so the next read goes back to the file
export function resetPullRequestDescriptionCacheMemory(): void {
  MEMORY_CACHE.clear();
}
