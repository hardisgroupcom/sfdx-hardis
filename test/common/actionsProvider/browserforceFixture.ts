// A fake Browserforce installation for the tests: an sf data folder whose plugin registry lists
// sfdx-browserforce-plugin, and a catalog cache file, so nothing starts the sf CLI.
import fs from 'fs';
import os from 'os';
import path from 'path';

export const FIXTURE_CATALOG = {
  formatVersion: 1,
  browserforceVersion: '7.2.0',
  plugins: [
    {
      key: 'densitySettings',
      title: 'Density Settings',
      jsonSchema: { type: 'object', properties: { density: { type: 'string', enum: ['Comfy', 'Compact'] } } },
      groups: [],
      fields: [{ path: 'density', type: 'string', required: false, enum: ['Comfy', 'Compact'], isPassword: false, isIrreversible: false }],
      examples: [{ density: 'Compact' }],
      warnings: { irreversibleFields: [], userInterface: null, prerequisites: [] },
    },
    {
      key: 'authProviders',
      title: 'Auth Providers',
      jsonSchema: { type: 'object' },
      groups: [{ path: '*', kind: 'record' }],
      fields: [{ path: '*.consumerSecret', group: '*', type: 'string', required: false, isPassword: true, isIrreversible: false }],
      examples: [{ MyProvider: { consumerSecret: '${MY_PROVIDER_SECRET}' } }],
      warnings: { irreversibleFields: [], userInterface: 'classic', prerequisites: ['An auth provider'] },
    },
  ],
  deprecatedSettings: [{ path: 'salesforceToSalesforce', reason: 'retired', message: 'Salesforce to Salesforce is retired' }],
};

export interface BrowserforceFixture {
  dataDir: string;
  cacheDir: string;
  restore: () => void;
}

/** Installs the fake plugin (version 7.2.0 unless given) and its cached catalog, and points the env vars to them */
export function installBrowserforceFixture(options: { version?: string; type?: 'user' | 'link'; catalog?: any; withCache?: boolean } = {}): BrowserforceFixture {
  const version = options.version || '7.2.0';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hardis-bf-test-'));
  const dataDir = path.join(root, 'sf');
  const cacheDir = path.join(root, 'cache');
  const linkedRoot = path.join(root, 'linked-browserforce');
  const pluginRoot = options.type === 'link' ? linkedRoot : path.join(dataDir, 'node_modules', 'sfdx-browserforce-plugin');
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'package.json'), JSON.stringify({ name: 'sfdx-browserforce-plugin', version }));
  const entry = options.type === 'link'
    ? { name: 'sfdx-browserforce-plugin', type: 'link', root: linkedRoot }
    : { name: 'sfdx-browserforce-plugin', type: 'user', tag: 'latest' };
  fs.writeFileSync(path.join(dataDir, 'package.json'), JSON.stringify({ oclif: { plugins: [{ name: 'sfdmu', type: 'user' }, entry] } }));
  if (options.withCache !== false) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, `catalog-${version}.json`), JSON.stringify(options.catalog || { ...FIXTURE_CATALOG, browserforceVersion: version }));
  }
  const previous = { SF_DATA_DIR: process.env.SF_DATA_DIR, SFDX_HARDIS_BROWSERFORCE_CACHE_DIR: process.env.SFDX_HARDIS_BROWSERFORCE_CACHE_DIR };
  process.env.SF_DATA_DIR = dataDir;
  process.env.SFDX_HARDIS_BROWSERFORCE_CACHE_DIR = cacheDir;
  return {
    dataDir,
    cacheDir,
    restore: () => {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
