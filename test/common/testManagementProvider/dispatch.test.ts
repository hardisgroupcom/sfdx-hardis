/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { TestManagementProviderRoot, ProviderRef } from '../../../src/common/testManagementProvider/testManagementProviderRoot.js';
import {
  pushCases,
  selectTestManagementProvider,
  buildTestManagementProviders,
  describeRequiredSettings,
  allTestManagementProviders,
  TEST_MANAGEMENT_PROVIDER_KEYS,
} from '../../../src/common/testManagementProvider/index.js';
import { AzureDevopsTestProvider } from '../../../src/common/testManagementProvider/azureDevopsTestProvider.js';
import { XrayTestProvider } from '../../../src/common/testManagementProvider/xrayTestProvider.js';
import { NormalizedTestCase } from '../../../src/common/utils/testNotebookUtils.js';

function makeCase(id = 'PROJ-123-F01'): NormalizedTestCase {
  return {
    id,
    ticket: 'PROJ-123',
    kind: 'functional',
    module: 'Quotes',
    priority: 1,
    title: `Case ${id}`,
    preconditions: 'An active account',
    steps: [{ action: 'Open the page', expected: 'The page is displayed' }],
    expected: 'The quote exists',
  };
}

class FakeProvider extends TestManagementProviderRoot {
  public calls: string[] = [];
  public created: string[] = [];
  public updated: string[] = [];
  public linked: string[] = [];
  public existingKeys = new Set<string>();
  public failOn: string | null = null;
  public failFindOn: string | null = null;
  public failLinkOn: string | null = null;
  public failProbe = false;
  public failPrepare = false;

  public constructor(public label = 'Fake', active = true) {
    super();
    this.isActive = active;
  }

  public getLabel(): string {
    return this.label;
  }

  public getRequiredEnvVars(): string[] {
    return ['FAKE_URL', 'FAKE_TOKEN'];
  }

  public async checkPrerequisites(): Promise<void> {
    this.calls.push('checkPrerequisites');
    if (this.failProbe) {
      throw new Error(`${this.label} is unreachable`);
    }
  }

  public async prepare(cases: NormalizedTestCase[]): Promise<void> {
    this.calls.push(`prepare:${cases.length}`);
    if (this.failPrepare) {
      throw new Error('carrier PROJ-123 not found');
    }
  }

  public async findByKey(key: string): Promise<ProviderRef | null> {
    this.calls.push(`findByKey:${key}`);
    if (this.failFindOn === key) {
      throw new Error(`search failed for ${key}`);
    }
    return this.existingKeys.has(key) ? { id: 'existing-1', url: 'https://example.test/existing-1' } : null;
  }

  public async create(testCase: NormalizedTestCase): Promise<ProviderRef> {
    this.calls.push(`create:${testCase.id}`);
    if (this.failOn === testCase.id) {
      throw new Error(`boom on ${testCase.id}`);
    }
    this.created.push(testCase.id);
    return { id: `new-${testCase.id}`, url: `https://example.test/${testCase.id}` };
  }

  public async update(ref: ProviderRef, testCase: NormalizedTestCase): Promise<ProviderRef> {
    this.calls.push(`update:${testCase.id}`);
    this.updated.push(testCase.id);
    return ref;
  }

  public async linkToStory(ref: ProviderRef, storyId: string): Promise<void> {
    this.calls.push(`link:${ref.id}`);
    if (this.failLinkOn === ref.id) {
      throw new Error(`link refused for ${ref.id}`);
    }
    this.linked.push(`${ref.id}->${storyId}`);
  }
}

describe('testManagementProvider pushCases', () => {
  it('probes and prepares before any search, then creates and links a new case', async () => {
    const provider = new FakeProvider();
    const report = await pushCases(provider, [makeCase()]);
    expect(provider.calls).to.deep.equal([
      'checkPrerequisites',
      'prepare:1',
      'findByKey:TESTKIT:PROJ-123:F01',
      'create:PROJ-123-F01',
      'link:new-PROJ-123-F01',
    ]);
    expect(provider.linked).to.deep.equal(['new-PROJ-123-F01->PROJ-123']);
    expect(report.exitCode).to.equal(0);
    expect(report.created).to.equal(1);
    expect(report.rows).to.deep.equal([
      { provider: 'Fake', caseId: 'PROJ-123-F01', action: 'created', trackerId: 'new-PROJ-123-F01', url: 'https://example.test/PROJ-123-F01' },
    ]);
  });

  it('updates instead of creating when the idempotency key already exists, without linking again', async () => {
    const provider = new FakeProvider();
    provider.existingKeys.add('TESTKIT:PROJ-123:F01');
    const report = await pushCases(provider, [makeCase()]);
    expect(provider.created).to.be.empty;
    expect(provider.updated).to.deep.equal(['PROJ-123-F01']);
    expect(provider.linked).to.be.empty;
    expect(report.updated).to.equal(1);
    expect(report.rows[0]).to.include({ action: 'updated', trackerId: 'existing-1' });
    expect(report.exitCode).to.equal(0);
  });

  it('returns exit code 1 and fails every case when the prerequisites fail, before prepare', async () => {
    const provider = new FakeProvider();
    provider.failProbe = true;
    const report = await pushCases(provider, [makeCase('PROJ-123-F01'), makeCase('PROJ-123-F02')]);
    expect(provider.calls).to.deep.equal(['checkPrerequisites']);
    expect(report.exitCode).to.equal(1);
    expect(report.failed).to.equal(2);
    expect(report.created).to.equal(0);
    expect(report.rows.map((row) => row.caseId)).to.deep.equal(['PROJ-123-F01', 'PROJ-123-F02']);
    expect(report.rows.every((row) => row.action === 'failed' && row.error === 'Fake is unreachable')).to.be.true;
  });

  it('returns exit code 1 and fails every case when prepare fails, dry run included', async () => {
    const provider = new FakeProvider();
    provider.failPrepare = true;
    const report = await pushCases(provider, [makeCase('PROJ-123-F01'), makeCase('PROJ-123-F02')], { dryRun: true });
    expect(provider.calls).to.deep.equal(['checkPrerequisites', 'prepare:2']);
    expect(report.exitCode).to.equal(1);
    expect(report.failed).to.equal(2);
    expect(report.rows.every((row) => row.action === 'failed' && row.error === 'carrier PROJ-123 not found')).to.be.true;
  });

  it('keeps going after one case fails and returns exit code 2', async () => {
    const provider = new FakeProvider();
    provider.failOn = 'PROJ-123-F01';
    const report = await pushCases(provider, [makeCase('PROJ-123-F01'), makeCase('PROJ-123-F02')]);
    expect(provider.created).to.deep.equal(['PROJ-123-F02']);
    expect(report.exitCode).to.equal(2);
    expect(report.created).to.equal(1);
    expect(report.failed).to.equal(1);
    expect(report.rows[0]).to.include({ caseId: 'PROJ-123-F01', action: 'failed', error: 'boom on PROJ-123-F01' });
    expect(report.rows[0].trackerId).to.be.undefined;
    expect(report.rows[1]).to.include({ caseId: 'PROJ-123-F02', action: 'created' });
  });

  it('counts a failed search as a failed case', async () => {
    const provider = new FakeProvider();
    provider.failFindOn = 'TESTKIT:PROJ-123:F02';
    const report = await pushCases(provider, [makeCase('PROJ-123-F01'), makeCase('PROJ-123-F02')]);
    expect(report.exitCode).to.equal(2);
    expect(report.rows[1]).to.include({ caseId: 'PROJ-123-F02', action: 'failed', error: 'search failed for TESTKIT:PROJ-123:F02' });
  });

  it('writes nothing in dry run mode and says what would happen to each case', async () => {
    const provider = new FakeProvider();
    provider.existingKeys.add('TESTKIT:PROJ-123:F02');
    const report = await pushCases(provider, [makeCase('PROJ-123-F01'), makeCase('PROJ-123-F02')], { dryRun: true });
    expect(provider.created).to.be.empty;
    expect(provider.updated).to.be.empty;
    expect(provider.linked).to.be.empty;
    expect(provider.calls.slice(0, 2)).to.deep.equal(['checkPrerequisites', 'prepare:2']);
    expect(report.exitCode).to.equal(0);
    expect(report.created).to.equal(0);
    expect(report.updated).to.equal(0);
    expect(report.rows[0]).to.deep.equal({ provider: 'Fake', caseId: 'PROJ-123-F01', action: 'would create', trackerId: undefined, url: undefined });
    expect(report.rows[1]).to.deep.equal({
      provider: 'Fake',
      caseId: 'PROJ-123-F02',
      action: 'would update',
      trackerId: 'existing-1',
      url: 'https://example.test/existing-1',
    });
  });

  it('reports a created case that could not be linked as failed, with its tracker id', async () => {
    const provider = new FakeProvider();
    provider.failLinkOn = 'new-PROJ-123-F01';
    const report = await pushCases(provider, [makeCase('PROJ-123-F01'), makeCase('PROJ-123-F02')]);
    expect(provider.created).to.deep.equal(['PROJ-123-F01', 'PROJ-123-F02']);
    expect(report.created).to.equal(1);
    expect(report.failed).to.equal(1);
    expect(report.rows[0]).to.include({
      action: 'failed',
      caseId: 'PROJ-123-F01',
      trackerId: 'new-PROJ-123-F01',
      url: 'https://example.test/PROJ-123-F01',
    });
    expect(report.rows[0].error).to.be.a('string').and.not.empty;
    expect(report.rows[1]).to.include({ action: 'created', caseId: 'PROJ-123-F02' });
    expect(report.exitCode).to.equal(2);
  });

  it('returns exit code 0 with no row for an empty case list', async () => {
    const provider = new FakeProvider();
    const report = await pushCases(provider, []);
    expect(report.exitCode).to.equal(0);
    expect(report.rows).to.be.empty;
  });
});

describe('testManagementProvider selectTestManagementProvider', () => {
  const providers = (): Array<{ key: string; provider: TestManagementProviderRoot }> => [
    { key: 'azure-devops', provider: new FakeProvider('Azure DevOps', true) },
    { key: 'xray', provider: new FakeProvider('Xray Cloud', false) },
  ];

  it('returns the active provider of the key, whatever its case', () => {
    const list = providers();
    expect(selectTestManagementProvider(list, 'azure-devops')).to.equal(list[0].provider);
    expect(selectTestManagementProvider(list, 'Azure-DevOps')).to.equal(list[0].provider);
  });

  it('refuses an unknown key', () => {
    let message = '';
    try {
      selectTestManagementProvider(providers(), 'unknown-tool');
    } catch (e) {
      message = (e as Error).message;
    }
    // The unknown key and the valid ones are named
    expect(message).to.contain('unknown-tool');
    expect(message).to.contain('azure-devops, xray');
  });

  it('refuses an inactive provider and names the settings it needs', () => {
    let message = '';
    try {
      selectTestManagementProvider(providers(), 'xray');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.contain('Xray Cloud (xray): FAKE_URL, FAKE_TOKEN');
  });
});

describe('testManagementProvider descriptors', () => {
  const ENV_KEYS = [
    'SYSTEM_COLLECTIONURI',
    'SYSTEM_TEAMPROJECT',
    'CI_SFDX_HARDIS_AZURE_TOKEN',
    'SYSTEM_ACCESSTOKEN',
    'AZURE_DEVOPS_EXT_PAT',
    'XRAY_CLIENT_ID',
    'XRAY_CLIENT_SECRET',
    'XRAY_REGION',
    'JIRA_HOST',
    'JIRA_PROJECT_KEY',
    'JIRA_EMAIL',
    'JIRA_TOKEN',
  ];
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it('exposes one descriptor per provider, keyed for the --provider flag', () => {
    expect(TEST_MANAGEMENT_PROVIDER_KEYS).to.deep.equal(['azure-devops', 'xray']);
    // A label is display text: it must never be what the flag matches on.
    expect(allTestManagementProviders.every((descriptor) => descriptor.label.length > 0)).to.be.true;
  });

  it('builds every provider, passing the configuration to Xray', async () => {
    // Both set: the git remote detection is a no-op
    process.env.SYSTEM_COLLECTIONURI = 'https://dev.azure.com/acme';
    process.env.SYSTEM_TEAMPROJECT = 'Sales';
    process.env.XRAY_CLIENT_ID = 'cid';
    process.env.XRAY_CLIENT_SECRET = 'secret';
    process.env.JIRA_PROJECT_KEY = 'PROJ';
    process.env.JIRA_EMAIL = 'bot@acme.test';
    process.env.JIRA_TOKEN = 'jira-token';
    const built = await buildTestManagementProviders({ jiraHost: 'acme.atlassian.net' });
    expect(built.map((entry) => entry.key)).to.deep.equal(['azure-devops', 'xray']);
    expect(built[0].provider).to.be.instanceOf(AzureDevopsTestProvider);
    expect(built[1].provider).to.be.instanceOf(XrayTestProvider);
    // No token for Azure DevOps, but a complete Xray setup through the config
    expect(built.map((entry) => entry.provider.isActive)).to.deep.equal([false, true]);
    expect(selectTestManagementProvider(built, 'xray')).to.equal(built[1].provider);
    expect(() => selectTestManagementProvider(built, 'azure-devops')).to.throw(/CI_SFDX_HARDIS_AZURE_TOKEN/);
  });

  it('describes the settings of each provider on its own line', () => {
    const text = describeRequiredSettings([
      { key: 'azure-devops', provider: new AzureDevopsTestProvider() },
      { key: 'xray', provider: new XrayTestProvider() },
    ]);
    const lines = text.split('\n');
    expect(lines).to.have.lengthOf(2);
    expect(lines[0]).to.equal('  - Azure DevOps (azure-devops): SYSTEM_COLLECTIONURI (or an Azure DevOps git remote), SYSTEM_TEAMPROJECT (or an Azure DevOps git remote), CI_SFDX_HARDIS_AZURE_TOKEN (or SYSTEM_ACCESSTOKEN or AZURE_DEVOPS_EXT_PAT)');
    expect(lines[1]).to.contain('XRAY_CLIENT_ID');
    expect(lines[1]).to.not.contain('AZURE');
  });
});

describe('TestManagementProviderRoot.describeHttpError', () => {
  it('keeps an error given as a plain string, as Xray answers a refused authentication', () => {
    const error = { message: 'Request failed with status code 401', response: { data: { error: 'Invalid client credentials!' } } };
    expect(TestManagementProviderRoot.describeHttpError(error)).to.equal('Request failed with status code 401: Invalid client credentials!');
  });
});
