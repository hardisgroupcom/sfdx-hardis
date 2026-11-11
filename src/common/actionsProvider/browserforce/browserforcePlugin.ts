// The Browserforce plugin (sfdx-browserforce-plugin) as installed in the sf CLI: where it is, which
// version, and its installation when a browser action needs it. Only the browser based action types
// (browser, user-access-policy) import this module.
import c from 'chalk';
import fs from 'fs';
import os from 'os';
import path from 'path';
import semver from 'semver';
import { SfError } from '@salesforce/core';
import { execCommand, uxLog } from '../../utils/index.js';
import { t } from '../../utils/i18n.js';

export const BROWSERFORCE_PLUGIN_NAME = 'sfdx-browserforce-plugin';
// First release with plugins list / validate, the changes in the --json result of apply,
// and applyToAll in userAccessPolicies
export const BROWSERFORCE_MIN_VERSION = '7.0.0';
// The Browserforce documentation site, with one page per setting
export const BROWSERFORCE_DOCS_URL = 'https://amtrack.github.io/sfdx-browserforce-plugin/';
export const BROWSERFORCE_SETTINGS_DOC_URL = `${BROWSERFORCE_DOCS_URL}settings/`;

/**
 * Documentation page of a setting, without asking the installed Browserforce: a deployment error
 * tip must not install it. The catalog of Browserforce 7.1.0 and later gives the same URL (docUrl).
 */
export function browserforceSettingDocUrl(key: string): string {
  return `${BROWSERFORCE_SETTINGS_DOC_URL}${encodeURIComponent(key)}/`;
}

export interface InstalledBrowserforce {
  version: string;
  root: string;
  // Installed with sf plugins link: its content changes under the same version
  linked: boolean;
}

/**
 * Installs Browserforce when it is missing or older than BROWSERFORCE_MIN_VERSION, and returns it.
 * A linked plugin is a development copy: it is used whatever its version.
 */
export async function ensureBrowserforce(): Promise<InstalledBrowserforce> {
  const installed = findInstalledBrowserforce();
  if (installed && (installed.linked || isRecentEnough(installed.version))) {
    return installed;
  }
  if (installed) {
    uxLog('warning', null, c.yellow(t('browserforceUpgrading', { installed: installed.version, minimum: BROWSERFORCE_MIN_VERSION })));
  } else {
    uxLog('action', null, c.cyan(t('browserforceInstalling')));
  }
  await execCommand(`echo y|sf plugins install ${BROWSERFORCE_PLUGIN_NAME}@latest`, null, { fail: true, output: false });
  const afterInstall = findInstalledBrowserforce();
  if (!afterInstall) {
    throw new SfError(t('browserforceNotFoundAfterInstall'));
  }
  return afterInstall;
}

/**
 * The Browserforce plugin registered in the sf CLI, read from the plugin registry of the sf data
 * folder: no sf command is started. null when it is not installed.
 */
export function findInstalledBrowserforce(): InstalledBrowserforce | null {
  const dataDir = getSfDataDir();
  const registry = readJsonFile(path.join(dataDir, 'package.json'));
  const plugins: any[] = Array.isArray(registry?.oclif?.plugins) ? registry.oclif.plugins : [];
  const entry = plugins.find((plugin) => plugin?.name === BROWSERFORCE_PLUGIN_NAME);
  if (!entry) {
    return null;
  }
  const linked = entry.type === 'link';
  const root = linked && typeof entry.root === 'string' ? entry.root : path.join(dataDir, 'node_modules', BROWSERFORCE_PLUGIN_NAME);
  const pluginPackage = readJsonFile(path.join(root, 'package.json'));
  if (!pluginPackage?.version) {
    return null;
  }
  return { version: String(pluginPackage.version), root, linked };
}

/**
 * Runs a Browserforce command with --json and returns its JSON envelope ({ status, result, message }).
 * A command that fails still answers JSON on stdout (plugins validate exits 1 on an invalid config):
 * it is read from the error too. null when nothing parseable came back.
 */
export async function execBrowserforceJson(
  command: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv; output?: boolean } = {}
): Promise<{ envelope: any; rawOutput: string }> {
  const res = await execCommand(command, null, {
    fail: false,
    output: options.output === true,
    spinner: true,
    cwd: options.cwd,
    env: options.env,
  });
  if (res?.status === 0 && res?.result !== undefined) {
    return { envelope: res, rawOutput: '' };
  }
  const rawOutput = [res?.stdout, res?.error?.stdout, res?.error?.stderr, res?.stderr]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
    .join('\n');
  for (const candidate of [res?.stdout, res?.error?.stdout]) {
    const parsed = parseJsonDocument(candidate);
    if (parsed) {
      return { envelope: parsed, rawOutput };
    }
  }
  return { envelope: null, rawOutput: rawOutput || res?.errorMessage || '' };
}

/** Folder where the sf CLI keeps its user plugins, the same rule as oclif */
export function getSfDataDir(): string {
  if (process.env.SF_DATA_DIR) {
    return process.env.SF_DATA_DIR;
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'sf');
  }
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdgDataHome, 'sf');
}

function isRecentEnough(version: string): boolean {
  const coerced = semver.coerce(version);
  return coerced != null && semver.gte(coerced, BROWSERFORCE_MIN_VERSION);
}

// A JSON document, possibly after warnings printed before it
function parseJsonDocument(text: unknown): any {
  if (typeof text !== 'string' || text.trim() === '') {
    return null;
  }
  const start = text.indexOf('{');
  if (start < 0) {
    return null;
  }
  try {
    return JSON.parse(text.substring(start));
  } catch {
    return null;
  }
}

function readJsonFile(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
