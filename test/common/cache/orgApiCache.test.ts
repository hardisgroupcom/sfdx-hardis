import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import { clearOrgApiCache, withOrgApiCache } from '../../../src/common/cache/orgApiCache.js';

// Fake connection of the given org
const connectionOf = (orgId?: string) => ({ getAuthInfoFields: () => ({ orgId }) }) as any;

describe('orgApiCache', () => {
  const previousEnv = { ...process.env };
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'org-api-cache-'));
    process.env.SFDX_HARDIS_ORG_API_CACHE_DIR = root;
    delete process.env.NO_CACHE;
    delete process.env.SFDX_HARDIS_ORG_API_CACHE_TTL_MINUTES;
    await clearOrgApiCache();
  });

  afterEach(async () => {
    process.env = { ...previousEnv };
    await fs.remove(root);
  });

  it('calls the API once, then serves the cached value', async () => {
    let calls = 0;
    const fetchValue = async () => ++calls;
    expect(await withOrgApiCache(connectionOf('00D1'), 'listMetadata:Flow', fetchValue)).to.deep.equal({
      value: 1,
      fromCache: false,
    });
    expect(await withOrgApiCache(connectionOf('00D1'), 'listMetadata:Flow', fetchValue)).to.deep.equal({
      value: 1,
      fromCache: true,
    });
    expect(calls).to.equal(1);
  });

  it('keeps the value on disk for the next CLI process', async () => {
    await withOrgApiCache(connectionOf('00D1'), 'listMetadata:Layout', async () => ['A']);
    const files = await fs.readdir(path.join(root, '00D1'));
    expect(files).to.have.length(1);
    expect(files[0]).to.match(/^listMetadata_Layout-[0-9a-f]{10}\.json$/);
  });

  it('scopes the cache on the org Id', async () => {
    await withOrgApiCache(connectionOf('00D1'), 'key', async () => 'org1');
    expect((await withOrgApiCache(connectionOf('00D2'), 'key', async () => 'org2')).value).to.equal('org2');
  });

  it('calls the API again on refresh, when expired, without org Id or with NO_CACHE', async () => {
    await withOrgApiCache(connectionOf('00D1'), 'key', async () => 'old');
    expect((await withOrgApiCache(connectionOf('00D1'), 'key', async () => 'new', { refresh: true })).value).to.equal(
      'new'
    );
    process.env.SFDX_HARDIS_ORG_API_CACHE_TTL_MINUTES = '0';
    expect((await withOrgApiCache(connectionOf('00D1'), 'key', async () => 'expired')).fromCache).to.equal(false);
    delete process.env.SFDX_HARDIS_ORG_API_CACHE_TTL_MINUTES;
    expect((await withOrgApiCache(connectionOf(undefined), 'key', async () => 'no org')).fromCache).to.equal(false);
    process.env.NO_CACHE = 'true';
    expect((await withOrgApiCache(connectionOf('00D1'), 'key', async () => 'no cache')).fromCache).to.equal(false);
  });
});
