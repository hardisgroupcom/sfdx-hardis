import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import { clearOrgApiCache } from '../../../src/common/cache/orgApiCache.js';
import { isFolderType, listOrgMetadata } from '../../../src/common/utils/metadataListingUtils.js';

// Fake connection of an org with an Id (so the cache applies), answering listMetadata from a map of type -> components
function fakeConnection(listings: Record<string, unknown>, queries: any[] = []) {
  return {
    getApiVersion: () => '65.0',
    getAuthInfoFields: () => ({ orgId: '00D000000000009' }),
    metadata: {
      list: async (query: any[]) => {
        queries.push(query[0]);
        const key = query[0].folder ? `${query[0].type}:${query[0].folder}` : query[0].type;
        if (!(key in listings)) {
          throw new Error('INVALID_TYPE');
        }
        return listings[key];
      },
    },
  } as any;
}

describe('metadataListingUtils', () => {
  const previousEnv = { ...process.env };
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'metadata-listing-'));
    process.env.SFDX_HARDIS_ORG_API_CACHE_DIR = root;
    delete process.env.NO_CACHE;
    await clearOrgApiCache();
  });

  afterEach(async () => {
    process.env = { ...previousEnv };
    await clearOrgApiCache();
    await fs.remove(root);
  });

  it('knows the folder types', () => {
    expect(isFolderType('Report')).to.equal(true);
    expect(isFolderType('EmailTemplate')).to.equal(true);
    expect(isFolderType('ApexClass')).to.equal(false);
  });

  it('lists the components of a type, sorted by name', async () => {
    const connection = fakeConnection({
      ApexClass: [
        { fullName: 'Zeta', id: '01p000000000002AAA' },
        { fullName: 'Alpha', id: '01p000000000001AAA' },
      ],
    });
    const listing = await listOrgMetadata(connection, { type: 'ApexClass' });
    expect(listing).to.deep.include({ type: 'ApexClass', folder: null, kind: 'components', listable: true });
    expect(listing.items.map((item) => item.fullName)).to.deep.equal(['Alpha', 'Zeta']);
  });

  it('lists the folders of a folder type, then the content of one folder', async () => {
    const queries: any[] = [];
    const connection = fakeConnection(
      {
        ReportFolder: [{ fullName: 'SalesReports', id: '00l000000000001AAA' }],
        'Report:SalesReports': [{ fullName: 'SalesReports/Pipeline', id: '00O000000000001AAA' }],
      },
      queries
    );
    const folders = await listOrgMetadata(connection, { type: 'Report' });
    expect(folders.kind).to.equal('folders');
    expect(folders.items.map((item) => item.fullName)).to.deep.equal(['SalesReports']);
    const content = await listOrgMetadata(connection, { type: 'Report', folder: 'SalesReports' });
    expect(content).to.deep.include({ kind: 'components', folder: 'SalesReports' });
    expect(content.items.map((item) => item.fullName)).to.deep.equal(['SalesReports/Pipeline']);
    expect(queries).to.deep.equal([{ type: 'ReportFolder' }, { type: 'Report', folder: 'SalesReports' }]);
  });

  it('answers not listable instead of failing for a type the Metadata API cannot list', async () => {
    const listing = await listOrgMetadata(fakeConnection({}), { type: 'CronTrigger' });
    expect(listing).to.deep.include({ listable: false, items: [] });
  });

  it('serves the cached listing, and lists the org again with refresh', async () => {
    const queries: any[] = [];
    const connection = fakeConnection({ Layout: [{ fullName: 'Account-Account Layout', id: '00h000000000001AAA' }] }, queries);
    await listOrgMetadata(connection, { type: 'Layout' });
    expect((await listOrgMetadata(connection, { type: 'Layout' })).fromCache).to.equal(true);
    expect((await listOrgMetadata(connection, { type: 'Layout', refresh: true })).fromCache).to.equal(false);
    expect(queries).to.have.length(2);
  });
});
