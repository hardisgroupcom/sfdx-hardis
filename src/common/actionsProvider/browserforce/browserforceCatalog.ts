// The settings Browserforce can apply (sf browserforce plugins list), and the validation of a setting
// value (sf browserforce plugins validate). The catalog is cached in a file shared with the VS Code
// extension, one file per Browserforce version.
import c from 'chalk';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SfError } from '@salesforce/core';
import { createTempDir, removeTempDir, uxLog } from '../../utils/index.js';
import { t } from '../../utils/i18n.js';
import { ensureBrowserforce, execBrowserforceJson, InstalledBrowserforce } from './browserforcePlugin.js';

// Version of the catalog format this sfdx-hardis reads. Browserforce only increments it when it
// removes or renames a field, so a higher one may lack what sfdx-hardis reads.
export const SUPPORTED_CATALOG_FORMAT_VERSION = 1;

export interface BrowserforceField {
  path: string;
  group?: string;
  type: 'string' | 'boolean' | 'number' | 'integer' | 'string[]' | 'json';
  title?: string;
  description?: string;
  required: boolean;
  enum?: unknown[];
  default?: unknown;
  isPassword: boolean;
  isIrreversible: boolean;
}

export interface BrowserforceFieldGroup {
  path: string;
  kind: 'array' | 'record';
  title?: string;
  description?: string;
  keyPattern?: string;
}

export interface BrowserforceSetting {
  key: string;
  title?: string;
  description?: string;
  jsonSchema: Record<string, unknown>;
  groups: BrowserforceFieldGroup[];
  fields: BrowserforceField[];
  examples: unknown[];
  warnings: {
    irreversibleFields: string[];
    userInterface: 'classic' | 'lightning' | null;
    prerequisites: string[];
  };
}

export interface BrowserforceDeprecatedSetting {
  path: string;
  reason: string;
  message: string;
  alternatives?: string;
}

export interface BrowserforceCatalog {
  formatVersion: number;
  browserforceVersion: string;
  plugins: BrowserforceSetting[];
  deprecatedSettings: BrowserforceDeprecatedSetting[];
}

export interface BrowserforceValidationResult {
  valid: boolean;
  errors: { path: string; message: string }[];
  environmentVariables: { name: string; path: string }[];
}

const memoryCache = new Map<string, BrowserforceCatalog>();
const validationCache = new Map<string, BrowserforceValidationResult>();

/**
 * The catalog of the installed Browserforce, installing it if needed. Read from memory, then from
 * the cache file of its version, then from sf browserforce plugins list. A linked plugin changes
 * under the same version, so it is only kept in memory.
 */
export async function getBrowserforceCatalog(): Promise<BrowserforceCatalog> {
  const installed = await ensureBrowserforce();
  const memoryKey = `${installed.root}@${installed.version}`;
  const inMemory = memoryCache.get(memoryKey);
  if (inMemory) {
    return inMemory;
  }
  let catalog = installed.linked ? null : readCatalogFile(installed.version);
  if (!catalog) {
    catalog = await loadCatalogFromCommand();
    if (!installed.linked) {
      writeCatalogFile(installed, catalog);
    }
  }
  assertCatalogFormat(catalog);
  memoryCache.set(memoryKey, catalog);
  return catalog;
}

export function findBrowserforceSetting(catalog: BrowserforceCatalog, key: string): BrowserforceSetting | null {
  return catalog.plugins.find((plugin) => plugin.key === key) || null;
}

/** A setting Browserforce removed, with its migration message */
export function findDeprecatedBrowserforceSetting(catalog: BrowserforceCatalog, key: string): BrowserforceDeprecatedSetting | null {
  return catalog.deprecatedSettings.find((deprecated) => deprecated.path === key || deprecated.path.startsWith(`${key}.`)) || null;
}

/** Why a setting key cannot be used: Browserforce removed it (with its migration message), or never had it */
export function describeMissingBrowserforceSetting(catalog: BrowserforceCatalog, key: string): string {
  const deprecated = findDeprecatedBrowserforceSetting(catalog, key);
  return deprecated
    ? t('actionValidationBrowserDeprecatedSetting', { setting: key, message: deprecated.message })
    : t('actionValidationBrowserUnknownSetting', { setting: key, version: catalog.browserforceVersion });
}

/** The warnings of a setting, as translated sentences */
export function describeSettingWarnings(setting: BrowserforceSetting): string[] {
  const warnings: string[] = [];
  if (setting.warnings.irreversibleFields.length > 0) {
    warnings.push(t('browserforceSettingWarningIrreversible', { fields: setting.warnings.irreversibleFields.join(', ') }));
  }
  if (setting.warnings.userInterface) {
    warnings.push(t('browserforceSettingWarningUserInterface', { userInterface: setting.warnings.userInterface === 'classic' ? 'Classic' : 'Lightning Experience' }));
  }
  if (setting.warnings.prerequisites.length > 0) {
    warnings.push(t('browserforceSettingWarningPrerequisites', { prerequisites: setting.warnings.prerequisites.join(', ') }));
  }
  return warnings;
}

/**
 * Checks the value of one setting against its schema, without any org. ${VAR} references are
 * accepted and listed. The value goes through a temporary file: JSON on a command line does not
 * survive the quoting of every shell.
 */
export async function validateBrowserforceConfig(setting: string, config: any): Promise<BrowserforceValidationResult> {
  const installed = await ensureBrowserforce();
  // The prompt validates the value, then action:create validates it again before saving: one sf
  // process (several seconds) is enough for both. A linked plugin changes under the same version.
  const cacheKey = installed.linked ? null : `${installed.version}|${setting}|${JSON.stringify(config)}`;
  const cached = cacheKey ? validationCache.get(cacheKey) : undefined;
  if (cached) {
    return cached;
  }
  const result = await runBrowserforceValidate(setting, config);
  if (cacheKey) {
    validationCache.set(cacheKey, result);
  }
  return result;
}

/** Folder of the catalog cache files, shared with the VS Code extension */
export function getCatalogCacheDir(): string {
  return process.env.SFDX_HARDIS_BROWSERFORCE_CACHE_DIR || path.join(os.homedir(), '.sfdx', 'sfdx-hardis-cache', 'browserforce');
}

async function runBrowserforceValidate(setting: string, config: any): Promise<BrowserforceValidationResult> {
  const tmpDir = await createTempDir();
  const configFile = path.join(tmpDir, `${randomUUID()}.json`);
  try {
    await fs.promises.writeFile(configFile, JSON.stringify({ settings: { [setting]: config } }, null, 2), 'utf8');
    const { envelope, rawOutput } = await execBrowserforceJson(`sf browserforce plugins validate -f "${configFile}" --json`);
    const result = envelope?.result;
    if (!result || typeof result.valid !== 'boolean') {
      throw new SfError(envelope?.message || rawOutput || 'sf browserforce plugins validate returned no result');
    }
    return {
      valid: result.valid,
      errors: Array.isArray(result.errors) ? result.errors : [],
      environmentVariables: Array.isArray(result.environmentVariables) ? result.environmentVariables : [],
    };
  } finally {
    await removeTempDir(tmpDir);
  }
}

function readCatalogFile(version: string): BrowserforceCatalog | null {
  try {
    const catalog = JSON.parse(fs.readFileSync(getCatalogFile(version), 'utf8'));
    // A file written by another tool or cut short is a cache miss, not an error
    return Array.isArray(catalog?.plugins) && Array.isArray(catalog?.deprecatedSettings) ? catalog : null;
  } catch {
    return null;
  }
}

async function loadCatalogFromCommand(): Promise<BrowserforceCatalog> {
  uxLog('log', null, c.grey(t('browserforceCatalogLoading')));
  const { envelope, rawOutput } = await execBrowserforceJson('sf browserforce plugins list --json');
  const catalog = envelope?.result;
  if (!Array.isArray(catalog?.plugins)) {
    throw new SfError(envelope?.message || rawOutput || 'sf browserforce plugins list returned no catalog');
  }
  return { ...catalog, deprecatedSettings: Array.isArray(catalog.deprecatedSettings) ? catalog.deprecatedSettings : [] };
}

// Written to a temporary file then renamed, so a reader never sees half a file. The files of
// other versions are removed: only the installed version is ever read.
function writeCatalogFile(installed: InstalledBrowserforce, catalog: BrowserforceCatalog): void {
  try {
    const cacheDir = getCatalogCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    const target = getCatalogFile(installed.version);
    const tmpFile = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(catalog), 'utf8');
    fs.renameSync(tmpFile, target);
    for (const file of fs.readdirSync(cacheDir)) {
      if (/^catalog-.+\.json$/.test(file) && path.join(cacheDir, file) !== target) {
        fs.rmSync(path.join(cacheDir, file), { force: true });
      }
    }
  } catch (e) {
    // The cache only saves time: a read-only home folder must not fail the action
    uxLog('other', null, c.grey(`[Browserforce] Catalog cache not written: ${(e as Error).message}`));
  }
}

function assertCatalogFormat(catalog: BrowserforceCatalog): void {
  if (Number(catalog.formatVersion) > SUPPORTED_CATALOG_FORMAT_VERSION) {
    throw new SfError(t('browserforceCatalogFormatUnsupported', { version: catalog.browserforceVersion, format: catalog.formatVersion }));
  }
}

function getCatalogFile(version: string): string {
  return path.join(getCatalogCacheDir(), `catalog-${version.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}
