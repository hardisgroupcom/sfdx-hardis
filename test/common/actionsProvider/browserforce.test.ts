import { expect } from 'chai';
import { findInstalledBrowserforce, getSfDataDir } from '../../../src/common/actionsProvider/browserforce/browserforcePlugin.js';
import {
  describeSettingWarnings,
  findBrowserforceSetting,
  findDeprecatedBrowserforceSetting,
  getBrowserforceCatalog,
} from '../../../src/common/actionsProvider/browserforce/browserforceCatalog.js';
import {
  describeVariableLookups,
  findVariableReferences,
  resolveVariables,
} from '../../../src/common/actionsProvider/browserforce/browserforceVariables.js';
import { FIXTURE_CATALOG, installBrowserforceFixture } from './browserforceFixture.js';

describe('Browserforce plugin detection', () => {
  it('reads the version of a plugin installed with sf plugins install, without the sf CLI', () => {
    const fixture = installBrowserforceFixture({ version: '7.1.2' });
    try {
      expect(getSfDataDir()).to.equal(fixture.dataDir);
      const installed = findInstalledBrowserforce();
      expect(installed?.version).to.equal('7.1.2');
      expect(installed?.linked).to.equal(false);
    } finally {
      fixture.restore();
    }
  });

  it('reads the version of a linked plugin from its own folder', () => {
    const fixture = installBrowserforceFixture({ type: 'link', version: '7.2.0-dev' });
    try {
      const installed = findInstalledBrowserforce();
      expect(installed?.linked).to.equal(true);
      expect(installed?.version).to.equal('7.2.0-dev');
    } finally {
      fixture.restore();
    }
  });

  it('returns null when the registry does not list the plugin', () => {
    const fixture = installBrowserforceFixture();
    try {
      process.env.SF_DATA_DIR = fixture.cacheDir;
      expect(findInstalledBrowserforce()).to.equal(null);
    } finally {
      fixture.restore();
    }
  });
});

describe('Browserforce catalog', () => {
  it('is read from the cache file of the installed version', async () => {
    const fixture = installBrowserforceFixture({ version: '7.2.5' });
    try {
      const catalog = await getBrowserforceCatalog();
      expect(catalog.browserforceVersion).to.equal('7.2.5');
      expect(findBrowserforceSetting(catalog, 'densitySettings')?.title).to.equal('Density Settings');
      expect(findBrowserforceSetting(catalog, 'unknown')).to.equal(null);
      expect(findDeprecatedBrowserforceSetting(catalog, 'salesforceToSalesforce')?.message).to.contain('retired');
    } finally {
      fixture.restore();
    }
  });

  it('refuses a catalog format this version cannot read', async () => {
    const fixture = installBrowserforceFixture({ version: '7.2.6', catalog: { ...FIXTURE_CATALOG, formatVersion: 2 } });
    try {
      let error: Error | null = null;
      await getBrowserforceCatalog().catch((e) => (error = e));
      expect(error).to.not.equal(null);
    } finally {
      fixture.restore();
    }
  });

  it('describes the warnings of a setting', () => {
    const warnings = describeSettingWarnings(FIXTURE_CATALOG.plugins[1] as any);
    expect(warnings).to.have.lengthOf(2);
  });
});

describe('Browserforce variables', () => {
  it('finds the references written exactly ${NAME}, with their path', () => {
    const references = findVariableReferences({
      MyProvider: { consumerSecret: '${MY_SECRET}', url: 'prefix-${NOT_A_REFERENCE}' },
      list: ['${OTHER}', '$${ESCAPED}'],
    });
    expect(references).to.deep.equal([
      { name: 'MY_SECRET', path: 'MyProvider.consumerSecret' },
      { name: 'OTHER', path: 'list[0]' },
    ]);
  });

  it('reads the variable of the target branch first, then the plain one, and lists what is missing', async () => {
    const previous = { ...process.env };
    process.env.BF_TEST_SECRET_UAT = 'uat-value';
    process.env.BF_TEST_SECRET = 'default-value';
    delete process.env.BF_TEST_MISSING;
    try {
      const uat = await resolveVariables([{ name: 'BF_TEST_SECRET', path: 'a' }, { name: 'BF_TEST_MISSING', path: 'b' }], 'uat');
      expect(uat.env).to.deep.equal({ BF_TEST_SECRET: 'uat-value' });
      expect(uat.missing).to.have.lengthOf(1);
      expect(uat.missing[0].lookedUp).to.include('BF_TEST_MISSING_UAT');
      const integration = await resolveVariables([{ name: 'BF_TEST_SECRET', path: 'a' }], 'integration');
      expect(integration.env).to.deep.equal({ BF_TEST_SECRET: 'default-value' });
    } finally {
      process.env = previous;
    }
  });

  it('masks only the values of the references that are secrets', async () => {
    const { redactSecrets } = await import('../../../src/common/utils/secretMaskingUtils.js');
    const previous = { ...process.env };
    process.env.BF_TEST_DENSITY = 'Compactissimo';
    process.env.BF_TEST_PASSWORD = 'Sup3rS3cretValue';
    try {
      await resolveVariables(
        [{ name: 'BF_TEST_DENSITY', path: 'density' }, { name: 'BF_TEST_PASSWORD', path: 'P.consumerSecret' }],
        null,
        (reference) => reference.path.endsWith('consumerSecret')
      );
      expect(redactSecrets('Compactissimo')).to.equal('Compactissimo');
      expect(redactSecrets('Sup3rS3cretValue')).to.not.contain('Sup3rS3cretValue');
    } finally {
      process.env = previous;
    }
  });

  it('describes the names to declare, developer orgs included', async () => {
    const lookups = await describeVariableLookups({ MyProvider: { consumerSecret: '${MY_SECRET}' } });
    expect(lookups).to.have.lengthOf(1);
    const devSandboxes = lookups[0].lookupByBranch.find((branch) => branch.branch === 'dev-sandboxes');
    expect(devSandboxes?.names).to.deep.equal(['MY_SECRET']);
  });
});
