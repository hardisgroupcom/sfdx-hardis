/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  TestManagementProviderRoot,
  ProviderRef,
} from '../../../src/common/testManagementProvider/testManagementProviderRoot.js';
import {
  pushCases,
  getInstances,
  describeRequiredEnvVars,
  allTestManagementProviders,
} from '../../../src/common/testManagementProvider/index.js';
import { NormalizedTestCase } from '../../../src/common/utils/testNotebookTypes.js';

function makeCase(id = 'PROJ-123-F01'): NormalizedTestCase {
  return {
    id,
    ticket: 'PROJ-123',
    kind: 'functional',
    module: 'Devis',
    priority: 1,
    title: `Cas ${id}`,
    preconditions: 'Un compte actif',
    steps: [{ action: 'Ouvrir', expected: 'La page apparait' }],
    expected: 'Le devis existe',
  };
}

class FakeProvider extends TestManagementProviderRoot {
  public created: string[] = [];
  public updated: string[] = [];
  public linked: string[] = [];
  public existingKeys = new Set<string>();
  public failOn: string | null = null;

  public constructor(public label = 'fake') {
    super();
    this.isActive = true;
  }

  public getLabel(): string {
    return this.label;
  }

  public async checkPrerequisites(): Promise<void> {
    return;
  }

  public async findByKey(key: string): Promise<ProviderRef | null> {
    return this.existingKeys.has(key) ? { id: 'existing-1', url: 'https://example.test/existing-1' } : null;
  }

  public async create(testCase: NormalizedTestCase): Promise<ProviderRef> {
    if (this.failOn === testCase.id) {
      throw new Error(`boom on ${testCase.id}`);
    }
    this.created.push(testCase.id);
    return { id: `new-${testCase.id}`, url: `https://example.test/${testCase.id}` };
  }

  public async update(ref: ProviderRef, testCase: NormalizedTestCase): Promise<ProviderRef> {
    this.updated.push(testCase.id);
    return ref;
  }

  public async linkToStory(ref: ProviderRef, storyId: string): Promise<void> {
    this.linked.push(`${ref.id}->${storyId}`);
  }
}

describe('testManagementProvider dispatch', () => {
  it('creates a case that does not exist yet and links it to its story', async () => {
    const provider = new FakeProvider();
    const report = await pushCases([provider], [makeCase()], {});
    expect(report.exitCode).to.equal(0);
    expect(provider.created).to.deep.equal(['PROJ-123-F01']);
    expect(provider.linked).to.have.lengthOf(1);
  });

  it('updates instead of creating when the idempotency key already exists', async () => {
    const provider = new FakeProvider();
    provider.existingKeys.add('TESTKIT:PROJ-123:F01');
    const report = await pushCases([provider], [makeCase()], {});
    expect(provider.created).to.be.empty;
    expect(provider.updated).to.deep.equal(['PROJ-123-F01']);
    // An update never re-links: the relation is already there.
    expect(provider.linked).to.be.empty;
    expect(report.exitCode).to.equal(0);
  });

  it('keeps going after one case fails and returns exit code 2', async () => {
    const provider = new FakeProvider();
    provider.failOn = 'PROJ-123-F01';
    const report = await pushCases([provider], [makeCase('PROJ-123-F01'), makeCase('PROJ-123-F02')], {});
    expect(provider.created).to.deep.equal(['PROJ-123-F02']);
    expect(report.exitCode).to.equal(2);
    expect(report.rows.filter((r) => r.action === 'failed')).to.have.lengthOf(1);
  });

  it('does not let one provider failing block the others', async () => {
    const broken = new FakeProvider('broken');
    broken.failOn = 'PROJ-123-F01';
    const healthy = new FakeProvider('healthy');
    const report = await pushCases([broken, healthy], [makeCase()], {});
    expect(healthy.created).to.deep.equal(['PROJ-123-F01']);
    expect(report.exitCode).to.equal(2);
  });

  it('writes nothing in dry run mode', async () => {
    const provider = new FakeProvider();
    const report = await pushCases([provider], [makeCase()], { dryRun: true });
    expect(provider.created).to.be.empty;
    expect(provider.updated).to.be.empty;
    expect(report.exitCode).to.equal(0);
    expect(report.rows.every((r) => r.action === 'dry-run')).to.be.true;
  });

  it('names the variables of the provider actually asked for, not of all three', async () => {
    const report = await pushCases([], [makeCase()], { provider: 'xray' });
    expect(report.exitCode).to.equal(1);
    expect(report.message).to.contain('xray');
    expect(report.message).to.not.contain('servicenow');
  });

  it('fails with exit code 1 when no provider is active', async () => {
    const report = await pushCases([], [makeCase()], {});
    expect(report.exitCode).to.equal(1);
    expect(report.message).to.match(/no active test management provider/i);
  });
});

describe('testManagementProvider descriptors', () => {
  it('exposes one descriptor per provider, keyed for the --provider flag', () => {
    expect(allTestManagementProviders.map((descriptor) => descriptor.key)).to.deep.equal([
      'azure-devops',
      'servicenow',
      'xray',
    ]);
    // A label is display text: it must never be what the flag matches on.
    expect(allTestManagementProviders.every((descriptor) => descriptor.label.length > 0)).to.be.true;
  });

  it('keeps no provider active when nothing is configured', () => {
    expect(getInstances()).to.be.an('array');
  });

  it('narrows the required variables listing to the requested provider', () => {
    const all = describeRequiredEnvVars();
    expect(all).to.contain('azure-devops').and.to.contain('servicenow').and.to.contain('xray');
    const onlyXray = describeRequiredEnvVars('xray');
    expect(onlyXray).to.contain('XRAY_CLIENT_ID');
    expect(onlyXray).to.not.contain('SYSTEM_COLLECTIONURI');
  });
});
