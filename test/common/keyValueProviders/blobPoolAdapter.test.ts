import { expect } from 'chai';
import { BlobPoolAdapter } from '../../../src/common/keyValueProviders/blobPoolAdapter.js';
import { KeyValueProviderInterface } from '../../../src/common/utils/keyValueUtils.js';

// The Salesforce and local test storages, reduced to the value they hold
class FakeBlobProvider implements KeyValueProviderInterface {
  name = 'fake';
  description = 'In memory';
  value: any = {};
  writes = 0;

  async userSetup() {
    return true;
  }

  async userAuthenticate() {
    return true;
  }

  async initialize() {
    return true;
  }

  async getValue() {
    return JSON.parse(JSON.stringify(this.value));
  }

  async setValue(_key: string | null, value: any) {
    this.value = value;
    this.writes++;
    return true;
  }

  async updateActiveScratchOrg() {
    return null;
  }
}

const org = (index: number) => ({
  scratchOrgAlias: `org${index}`,
  scratchOrgUsername: `user${index}@example.com`,
  scratchOrgSfdxAuthUrl: `force://secret-${index}`,
  authFileJson: { result: { instanceUrl: 'https://example.my.salesforce.com', expirationDate: '2099-01-01' } },
});

describe('BlobPoolAdapter', () => {
  it('keeps the order these storages always had: the last scratch org added is the next one taken', async () => {
    const provider = new FakeBlobProvider();
    const adapter = new BlobPoolAdapter(provider);
    await adapter.addOrg(org(1), 'last');
    await adapter.addOrg(org(2), 'last');
    // A scratch org put back after a failure waits behind the others
    await adapter.addOrg(org(3), 'first');
    expect(provider.value.scratchOrgs.map((scratchOrg: any) => scratchOrg.scratchOrgAlias)).to.deep.equal(['org2', 'org1', 'org3']);
    expect((await adapter.takeOrg()).scratchOrgAlias).to.equal('org2');
    expect((await adapter.listOrgs()).map((scratchOrg: any) => scratchOrg.scratchOrgAlias)).to.deep.equal(['org1', 'org3']);
  });

  it('answers null when the pool is empty, without writing', async () => {
    const provider = new FakeBlobProvider();
    expect(await new BlobPoolAdapter(provider).takeOrg()).to.equal(null);
    expect(provider.writes).to.equal(0);
  });

  it('removes scratch orgs by username and keeps the other properties of the value', async () => {
    const provider = new FakeBlobProvider();
    provider.value = { scratchOrgs: [org(1), org(2)], other: 'kept' };
    await new BlobPoolAdapter(provider).removeOrgs([org(1)]);
    expect(provider.value.scratchOrgs.map((scratchOrg: any) => scratchOrg.scratchOrgAlias)).to.deep.equal(['org2']);
    expect(provider.value.other).to.equal('kept');
  });

  it('reads a storage that answers something else than an object as an empty pool', async () => {
    const provider = new FakeBlobProvider();
    provider.getValue = async () => 'ERROR';
    expect(await new BlobPoolAdapter(provider).listOrgs()).to.deep.equal([]);
  });

  it('builds a summary without any credential', async () => {
    const provider = new FakeBlobProvider();
    provider.value = { scratchOrgs: [org(1)] };
    const summary = await new BlobPoolAdapter(provider).getSummary();
    expect(summary).to.include({ storageService: 'fake', available: 1, keyStatus: 'notNeeded', canTake: true, dashboardUrl: null });
    expect(summary.orgs[0]).to.include({ alias: 'org1', username: 'user1@example.com' });
    expect(JSON.stringify(summary)).to.not.include('secret');
  });
});
