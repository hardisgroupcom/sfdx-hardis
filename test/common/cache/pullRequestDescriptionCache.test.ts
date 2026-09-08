import { expect } from 'chai';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import {
  MAX_ENTRIES_PER_REPOSITORY,
  PR_DESCRIPTION_CACHE_VERSION,
  getCachedPullRequestDescription,
  isPullRequestDescriptionCacheDisabled,
  normalizeTerminalState,
  pruneEntries,
  pullRequestCacheFile,
  repositoryKeyFromRemoteUrl,
  resetPullRequestDescriptionCacheMemory,
  sanitizeRepositoryKey,
  setCachedPullRequestDescription,
  type CachedPullRequestDescription,
} from '../../../src/common/cache/pullRequestDescriptionCache.js';

// The on-disk contract of this cache is shared with vscode-sfdx-hardis: a change here has to be
// mirrored in its src/utils/pullRequestDescriptionCache.ts.
describe('Pull Request description cache', () => {
  const REPO = 'https://dev.azure.com/acme/ Salesforce/11111111-2222-3333-4444-555555555555';
  const cacheFile = () => pullRequestCacheFile('azure', REPO);

  beforeEach(async () => {
    resetPullRequestDescriptionCacheMemory();
    delete process.env.NO_CACHE;
    delete process.env.SFDX_HARDIS_NO_PR_CACHE;
    await fs.remove(cacheFile());
  });

  after(async () => {
    resetPullRequestDescriptionCacheMemory();
    await fs.remove(cacheFile());
  });

  // The CLI computes this from `git config remote.origin.url`, the extension from
  // repoInfo.remoteUrl: both look at the same clone, so both must land on the same string. These
  // expectations are duplicated verbatim in the extension suite, which is what keeps the two
  // implementations of the shared contract honest.
  describe('repositoryKeyFromRemoteUrl()', () => {
    it('drops the protocol, the credentials, the .git suffix and the case', () => {
      const expected = 'dev.azure.com/acme/salesforce/_git/sfdx-project';
      for (const remote of [
        'https://dev.azure.com/acme/Salesforce/_git/sfdx-project',
        'https://user@dev.azure.com/acme/Salesforce/_git/sfdx-project',
        'https://anything:a-token@dev.azure.com/acme/Salesforce/_git/sfdx-project.git',
        'HTTPS://DEV.AZURE.COM/Acme/Salesforce/_git/SFDX-Project/',
      ]) {
        expect(repositoryKeyFromRemoteUrl(remote), remote).to.equal(expected);
      }
    });

    it('gives two repositories two different keys', () => {
      expect(repositoryKeyFromRemoteUrl('https://dev.azure.com/acme/p/_git/repo-a')).to.not.equal(
        repositoryKeyFromRemoteUrl('https://dev.azure.com/acme/p/_git/repo-b'),
      );
    });

    it('falls back to a constant when there is no remote', () => {
      expect(repositoryKeyFromRemoteUrl('')).to.equal('unknown');
    });
  });

  describe('normalizeTerminalState()', () => {
    it('recognizes the merged state of the four providers', () => {
      for (const state of ['merged', 'MERGED', 'completed', 3]) {
        expect(normalizeTerminalState(state), `state ${state}`).to.equal('merged');
      }
    });

    it('recognizes the closed state of the four providers', () => {
      for (const state of ['closed', 'DECLINED', 'abandoned', 'SUPERSEDED']) {
        expect(normalizeTerminalState(state), `state ${state}`).to.equal('closed');
      }
    });

    // The whole point: a description that is still being written must never be cached
    it('refuses every non terminal state', () => {
      for (const state of ['open', 'active', 'OPEN', '', null, undefined, 'unknown']) {
        expect(normalizeTerminalState(state), `state ${state}`).to.equal(null);
      }
    });
  });

  it('stores nothing for an open Pull Request, and reads nothing back', async () => {
    await setCachedPullRequestDescription('azure', REPO, 42, 'active', 'still being written');
    expect(fs.existsSync(cacheFile())).to.equal(false);
    expect(await getCachedPullRequestDescription('azure', REPO, 42, 'active')).to.equal(null);
  });

  it('round-trips the description of a merged Pull Request', async () => {
    const description = 'Promotion branch\n\n```yaml\npromotionPullRequests: [12, 34]\n```';
    await setCachedPullRequestDescription('azure', REPO, 38, 'completed', description);

    resetPullRequestDescriptionCacheMemory();
    expect(await getCachedPullRequestDescription('azure', REPO, 38, 'completed')).to.equal(description);
  });

  it('writes the shared on-disk contract', async () => {
    await setCachedPullRequestDescription('azure', REPO, 38, 'completed', 'body');
    const written = await fs.readJson(cacheFile());

    expect(written.version).to.equal(PR_DESCRIPTION_CACHE_VERSION);
    expect(written.provider).to.equal('azure');
    expect(written.repository).to.equal(REPO);
    expect(written.pullRequests['38'].description).to.equal('body');
    expect(written.pullRequests['38'].state).to.equal('merged');
    expect(written.pullRequests['38'].cachedAt).to.be.a('string');
  });

  // Bitbucket reopens a declined Pull Request, Azure reactivates an abandoned one: what the caller
  // sees now wins over what was cached then
  it('ignores a cached entry when the Pull Request is open again', async () => {
    await setCachedPullRequestDescription('azure', REPO, 15, 'abandoned', 'the declined body');
    expect(await getCachedPullRequestDescription('azure', REPO, 15, 'active')).to.equal(null);
  });

  it('ignores a cached entry whose state no longer matches', async () => {
    await setCachedPullRequestDescription('azure', REPO, 15, 'abandoned', 'the declined body');
    // Abandoned then merged: the description could have moved in between
    expect(await getCachedPullRequestDescription('azure', REPO, 15, 'completed')).to.equal(null);
  });

  it('ignores an entry older than the maximum age', async () => {
    await setCachedPullRequestDescription('azure', REPO, 7, 'completed', 'old body');
    const written = await fs.readJson(cacheFile());
    written.pullRequests['7'].cachedAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    await fs.writeJson(cacheFile(), written);

    resetPullRequestDescriptionCacheMemory();
    expect(await getCachedPullRequestDescription('azure', REPO, 7, 'completed')).to.equal(null);
  });

  it('keeps the entries another process wrote while this one held the file', async () => {
    await setCachedPullRequestDescription('azure', REPO, 1, 'completed', 'from this process');
    // Another process appends its own entry behind our back
    const onDisk = await fs.readJson(cacheFile());
    onDisk.pullRequests['2'] = { description: 'from the other one', state: 'merged', cachedAt: new Date().toISOString() };
    await fs.writeJson(cacheFile(), onDisk);

    await setCachedPullRequestDescription('azure', REPO, 3, 'completed', 'from this process again');

    const merged = await fs.readJson(cacheFile());
    expect(Object.keys(merged.pullRequests).sort()).to.deep.equal(['1', '2', '3']);
    expect(merged.pullRequests['2'].description).to.equal('from the other one');
  });

  it('leaves a file written by a newer version alone', async () => {
    await fs.ensureDir(path.dirname(cacheFile()));
    await fs.writeJson(cacheFile(), {
      version: PR_DESCRIPTION_CACHE_VERSION + 1,
      provider: 'azure',
      repository: REPO,
      pullRequests: { '9': { description: 'from the future', state: 'merged', cachedAt: new Date().toISOString() } },
    });

    resetPullRequestDescriptionCacheMemory();
    expect(await getCachedPullRequestDescription('azure', REPO, 9, 'completed')).to.equal(null);
  });

  it('survives a corrupted cache file', async () => {
    await fs.ensureDir(path.dirname(cacheFile()));
    await fs.writeFile(cacheFile(), 'not json at all');

    resetPullRequestDescriptionCacheMemory();
    expect(await getCachedPullRequestDescription('azure', REPO, 9, 'completed')).to.equal(null);
    // and a write repairs it rather than throwing
    await setCachedPullRequestDescription('azure', REPO, 9, 'completed', 'body');
    expect((await fs.readJson(cacheFile())).pullRequests['9'].description).to.equal('body');
  });

  it('is bypassed by NO_CACHE and by SFDX_HARDIS_NO_PR_CACHE', async () => {
    for (const variable of ['NO_CACHE', 'SFDX_HARDIS_NO_PR_CACHE']) {
      resetPullRequestDescriptionCacheMemory();
      await fs.remove(cacheFile());
      process.env[variable] = 'true';
      expect(isPullRequestDescriptionCacheDisabled()).to.equal(true);
      await setCachedPullRequestDescription('azure', REPO, 5, 'completed', 'body');
      expect(fs.existsSync(cacheFile()), `${variable} still wrote the file`).to.equal(false);
      expect(await getCachedPullRequestDescription('azure', REPO, 5, 'completed')).to.equal(null);
      delete process.env[variable];
    }
  });

  describe('the cache file path', () => {
    it('lives outside any repository, so it is never committed by accident', () => {
      expect(pullRequestCacheFile('azure', REPO).startsWith(path.join(os.homedir(), '.sfdx'))).to.equal(true);
    });

    it('gives two repositories two different files', () => {
      expect(pullRequestCacheFile('azure', 'org/project/repo-a')).to.not.equal(
        pullRequestCacheFile('azure', 'org/project/repo-b'),
      );
    });

    it('sanitizes a key into a safe file name', () => {
      expect(sanitizeRepositoryKey('https://dev.azure.com/acme/ My Project/guid')).to.equal(
        'https_dev.azure.com_acme_My_Project_guid',
      );
      expect(sanitizeRepositoryKey('')).to.equal('unknown');
    });
  });

  describe('pruneEntries()', () => {
    const entry = (daysAgo: number): CachedPullRequestDescription => ({
      description: 'x',
      state: 'merged',
      cachedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    });

    it('drops the expired entries', () => {
      const pruned = pruneEntries({ fresh: entry(1), old: entry(200) });
      expect(Object.keys(pruned)).to.deep.equal(['fresh']);
    });

    it('caps a repository and keeps the most recent entries', () => {
      const entries: Record<string, CachedPullRequestDescription> = {};
      for (let i = 0; i < MAX_ENTRIES_PER_REPOSITORY + 10; i++) {
        entries[String(i)] = entry(i % 30);
      }
      const pruned = pruneEntries(entries);
      expect(Object.keys(pruned).length).to.equal(MAX_ENTRIES_PER_REPOSITORY);
    });

    it('leaves a cache under the cap untouched', () => {
      const entries = { a: entry(1), b: entry(2) };
      expect(Object.keys(pruneEntries(entries)).sort()).to.deep.equal(['a', 'b']);
    });
  });
});
