import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BrowserAction } from '../../../src/common/actionsProvider/browserAction.js';
import type { BrowserforceApplyOptions, BrowserforceApplyOutcome } from '../../../src/common/actionsProvider/browserforce/browserforceRunner.js';
import { PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';
import { resolveRunOnlyOnceByOrg } from '../../../src/common/actionsProvider/actionTypes.js';
import { assertNoFlagsOfOtherTypes, throwActionValidationErrors } from '../../../src/common/utils/actionUtils.js';
import { buildActionTypesDescription } from '../../../src/common/utils/actionTypesUtils.js';
import { FIXTURE_CATALOG, installBrowserforceFixture } from './browserforceFixture.js';
import { readCachedBrowserforceCatalog } from '../../../src/common/actionsProvider/browserforce/browserforceCatalog.js';
import { describeDeploymentActionsForAi } from '../../../src/common/utils/deployTipActions.js';

// Browserforce cannot run in the tests: the calls are recorded and answered with the given outcome
class TestBrowserAction extends BrowserAction {
  public calls: BrowserforceApplyOptions[] = [];
  public constructor(private readonly outcome: BrowserforceApplyOutcome = { success: true, outputLines: ['Changed density to "Compact"'] }) {
    super();
  }
  protected async applyWithBrowserforce(options: BrowserforceApplyOptions): Promise<BrowserforceApplyOutcome> {
    this.calls.push(options);
    return this.outcome;
  }
}

function action(parameters: Record<string, any>, extra: Partial<PrePostCommand> = {}): PrePostCommand {
  return {
    id: 'browser-1',
    label: 'Compact density',
    type: 'browser',
    when: 'post-deploy',
    context: 'all',
    command: '',
    parameters,
    ...extra,
  } as PrePostCommand;
}

describe('BrowserAction type rules', () => {
  const provider = new BrowserAction();

  it('runs in both phases, in deployment checks too, once per org by default', () => {
    expect(provider.getAllowedWhen()).to.equal(null);
    expect(provider.getDefaultContext()).to.equal('all');
    expect(resolveRunOnlyOnceByOrg({ type: 'browser' })).to.equal(true);
  });

  it('describes its two parameters with their flags', () => {
    expect(provider.getParameterDescriptions().map((parameter) => parameter.flag)).to.deep.equal(['browser-setting', 'browser-config']);
  });

  it('refuses its flags on another type', async () => {
    let error: Error | null = null;
    await assertNoFlagsOfOtherTypes('apex', { 'browser-setting': 'densitySettings' }).catch((e) => (error = e));
    expect(error).to.not.equal(null);
  });
});

describe('BrowserAction.applyFlags and collectParameters', () => {
  const provider = new BrowserAction();

  it('reads --browser-config as JSON, or as the path of a .json file', () => {
    expect(provider.applyFlags({}, { 'browser-setting': 'densitySettings', 'browser-config': '{"density":"Compact"}' }))
      .to.deep.equal({ setting: 'densitySettings', config: { density: 'Compact' } });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hardis-bf-')), 'config.json');
    fs.writeFileSync(file, '{"density":"Comfy"}');
    expect(provider.applyFlags({}, { 'browser-config': file }).config).to.deep.equal({ density: 'Comfy' });
  });

  it('refuses a value that is not JSON', () => {
    expect(() => provider.applyFlags({}, { 'browser-config': '{density' })).to.throw();
  });

  it('drops the value of the previous setting when the setting changes', () => {
    expect(provider.applyFlags({ setting: 'densitySettings', config: { density: 'Compact' } }, { 'browser-setting': 'authProviders' }))
      .to.deep.equal({ setting: 'authProviders' });
  });

  it('requires both flags when headless', async () => {
    let error: Error | null = null;
    await provider.collectParameters({ 'browser-setting': 'densitySettings' }, true, {}).catch((e) => (error = e));
    expect(String(error)).to.contain('browser-config');
  });
});

describe('BrowserAction.getDefinitionErrors and help', () => {
  let fixture: ReturnType<typeof installBrowserforceFixture>;
  before(() => {
    fixture = installBrowserforceFixture({ version: '7.2.1' });
  });
  after(() => fixture.restore());

  it('requires a setting and an object or list value', async () => {
    const errors = await new BrowserAction().getDefinitionErrors(action({ config: 'Compact' }));
    expect(errors).to.have.lengthOf(2);
  });

  it('refuses an unknown setting and a removed one, with its migration message', async () => {
    expect((await new BrowserAction().getDefinitionErrors(action({ setting: 'nope', config: {} })))[0]).to.contain('nope');
    expect((await new BrowserAction().getDefinitionErrors(action({ setting: 'salesforceToSalesforce', config: {} })))[0]).to.contain('retired');
  });

  it('does not ask Browserforce again when an update leaves the setting and its value unchanged', async () => {
    const unchanged = action({ setting: 'nope', config: { a: 1 } });
    expect(await new BrowserAction().getDefinitionErrors(unchanged, 'post-deploy', structuredClone(unchanged))).to.deep.equal([]);
  });

  it('returns the fields and the example of the setting with the validation error', async () => {
    let error: any = null;
    await throwActionValidationErrors(action({ setting: 'densitySettings', config: { density: 'Huge' } }), ['density: Invalid option']).catch((e) => (error = e));
    expect(error?.data?.errors).to.deep.equal(['density: Invalid option']);
    expect(error?.data?.setting?.example).to.deep.equal({ density: 'Compact' });
    expect(error?.data?.setting?.fields?.[0]?.path).to.equal('density');
  });

  it('is described by action:types with its settings, or one of them', async () => {
    const all = await buildActionTypesDescription({ type: 'browser', flags: {} });
    expect(all.types[0].details?.settings.map((setting: any) => setting.key)).to.deep.equal(['densitySettings', 'authProviders']);
    expect(all.types[0].details?.secretsLookup?.branches?.at(-1)?.branch).to.equal('dev-sandboxes');
    const one = await buildActionTypesDescription({ type: 'browser', flags: { 'browser-setting': 'authProviders' } });
    expect(one.types[0].details?.setting?.fields?.[0]?.isPassword).to.equal(true);
  });

  it('lists the CI/CD variables to declare once saved', async () => {
    const details = await new BrowserAction().getSaveDetails(action({ setting: 'authProviders', config: { P: { consumerSecret: '${P_SECRET}' } } }));
    expect(details?.environmentVariables?.[0]?.name).to.equal('P_SECRET');
    expect(await new BrowserAction().getSaveDetails(action({ setting: 'densitySettings', config: { density: 'Compact' } }))).to.equal(null);
  });
});

describe('BrowserAction documentation links and deployment error hints', () => {
  const DOC_URL = 'https://amtrack.github.io/sfdx-browserforce-plugin/settings/densitySettings/';
  let fixture: ReturnType<typeof installBrowserforceFixture>;
  before(() => {
    // Browserforce 7.1.0 and later give a docUrl per setting: here densitySettings only
    const catalog = {
      ...FIXTURE_CATALOG,
      browserforceVersion: '7.2.0',
      plugins: FIXTURE_CATALOG.plugins.map((plugin) => (plugin.key === 'densitySettings' ? { ...plugin, docUrl: DOC_URL } : plugin)),
    };
    fixture = installBrowserforceFixture({ version: '7.2.0', catalog });
  });
  after(() => fixture.restore());

  it('links a setting to its page of the Browserforce documentation, without asking Browserforce', () => {
    const provider = new BrowserAction();
    expect(provider.getDocumentationUrl({ setting: 'recordTypes', config: {} })).to.equal('https://amtrack.github.io/sfdx-browserforce-plugin/settings/recordTypes/');
    expect(provider.getDocumentationUrl({})).to.equal(null);
    expect(provider.getDeployTipNotes()).to.have.length(1);
  });

  it('gives the documentation page of a setting in action:types only when the catalog has it', async () => {
    const all = await buildActionTypesDescription({ type: 'browser', flags: {} });
    const settings = all.types[0].details?.settings;
    expect(settings.find((setting: any) => setting.key === 'densitySettings').docUrl).to.equal(DOC_URL);
    expect(settings.find((setting: any) => setting.key === 'authProviders')).to.not.have.property('docUrl');
  });

  it('tells the AI the settings of the cached catalog in one line, with the command built from its flags', async () => {
    const description = await new BrowserAction().describeForDeployErrorAi();
    expect(description).to.contain('Its settings: densitySettings, authProviders.');
    expect(description!.split('\n')).to.have.length(1);
    const all = await describeDeploymentActionsForAi();
    expect(all).to.contain(`--type browser --label "<label>" --browser-setting <setting> --browser-config '<config as JSON>'`);
  });

  it('uses the highest cached catalog that this version can read when the installed one has none', async () => {
    const cache = installBrowserforceFixture({ version: '7.10.0', withCache: false });
    try {
      const write = (version: string, catalog: any) =>
        fs.writeFileSync(path.join(cache.cacheDir, `catalog-${version}.json`), JSON.stringify(catalog));
      fs.mkdirSync(cache.cacheDir, { recursive: true });
      write('7.9.0', { ...FIXTURE_CATALOG, browserforceVersion: '7.9.0' });
      write('7.11.0', { ...FIXTURE_CATALOG, browserforceVersion: '7.11.0', formatVersion: 99 });
      write('7.10.1', { ...FIXTURE_CATALOG, browserforceVersion: '7.10.1' });
      expect(readCachedBrowserforceCatalog()?.browserforceVersion).to.equal('7.10.1');
    } finally {
      cache.restore();
      process.env.SF_DATA_DIR = fixture.dataDir;
      process.env.SFDX_HARDIS_BROWSERFORCE_CACHE_DIR = fixture.cacheDir;
    }
  });

  it('points the AI to the settings page when no catalog was ever cached', async () => {
    const empty = installBrowserforceFixture({ version: '7.1.0', withCache: false });
    try {
      const description = await new BrowserAction().describeForDeployErrorAi();
      expect(description).to.contain('https://amtrack.github.io/sfdx-browserforce-plugin/settings/');
      expect(description).to.not.contain('densitySettings');
    } finally {
      empty.restore();
      // The outer fixture is back for the next tests
      process.env.SF_DATA_DIR = fixture.dataDir;
      process.env.SFDX_HARDIS_BROWSERFORCE_CACHE_DIR = fixture.cacheDir;
    }
  });
});

describe('BrowserAction.run', () => {
  let previousConn: any;
  beforeEach(() => {
    previousConn = globalThis.jsForceConn;
    globalThis.jsForceConn = { getUsername: () => 'admin@example.com' } as any;
  });
  afterEach(() => {
    globalThis.jsForceConn = previousConn;
  });

  it('only reads the org during a deployment check', async () => {
    const provider = new TestBrowserAction();
    const result = await provider.run(action({ setting: 'densitySettings', config: { density: 'Compact' } }, {
      pipelineContext: { checkOnly: 'true', targetBranch: 'uat' } as any,
    }));
    expect(result.statusCode).to.equal('success');
    expect(provider.calls[0]).to.deep.include({ setting: 'densitySettings', username: 'admin@example.com', dryRun: true, targetBranch: 'uat' });
    // Never recorded as run in the org: the deployment after the merge must still apply it
    expect(result.dryRun).to.equal(true);
  });

  it('applies the setting in a deployment job, and fails with Browserforce', async () => {
    const provider = new TestBrowserAction({ success: false, outputLines: ['Variable X is not set'] });
    const result = await provider.run(action({ setting: 'densitySettings', config: { density: 'Compact' } }, {
      pipelineContext: { checkOnly: 'false', targetBranch: 'main' } as any,
    }));
    expect(provider.calls[0].dryRun).to.equal(false);
    expect(result.statusCode).to.equal('failed');
    expect(result.output).to.contain('Variable X');
  });

  it('fails before Browserforce when the definition is incomplete', async () => {
    const provider = new TestBrowserAction();
    const result = await provider.run(action({ setting: 'densitySettings' }));
    expect(result.statusCode).to.equal('failed');
    expect(provider.calls).to.have.lengthOf(0);
  });
});

describe('action:types', () => {
  it('describes every deployment action type with its parameters, without loading the details of one', async () => {
    const description = await buildActionTypesDescription();
    const byType = Object.fromEntries(description.types.map((type) => [type.type, type]));
    expect(Object.keys(byType)).to.include.members(['command', 'apex', 'data', 'run-batch', 'remove-packagexml-items', 'user-access-policy', 'browser']);
    for (const type of description.types) {
      expect(type.parameters.length, type.type).to.be.greaterThan(0);
      expect(type.details, type.type).to.equal(undefined);
    }
    expect(byType['remove-packagexml-items'].defaultContext).to.equal('all');
    expect(byType['remove-packagexml-items'].allowedWhen).to.deep.equal(['pre-deploy']);
    expect(byType['run-batch'].defaultContext).to.equal('process-deployment-only');
    expect(byType['user-access-policy'].runOnlyOnceByOrgDefault).to.equal(false);
  });

  it('filters the types by phase', async () => {
    const description = await buildActionTypesDescription({ when: 'post-deploy' });
    expect(description.types.map((type) => type.type)).to.not.include('remove-packagexml-items');
  });
});
