// Applies one Browserforce setting to an org with sf browserforce apply, for the browser based action
// types. The setting value is written with its ${VAR} references untouched: the values only travel
// as environment variables of the Browserforce process, never in a file.
import c from 'chalk';
import fs from 'fs';
import path from 'path';
import { createTempDir, removeTempDir, uxLog } from '../../utils/index.js';
import { t } from '../../utils/i18n.js';
import { redactSecrets } from '../../utils/secretMaskingUtils.js';
import { ensureBrowserforce, execBrowserforceJson } from './browserforcePlugin.js';
import { findVariableReferences, resolveVariables, VariableReference } from './browserforceVariables.js';
import type { BrowserforceField } from './browserforceCatalog.js';

export interface BrowserforceApplyOptions {
  setting: string;
  config: any;
  // Username of the org to apply the setting to
  username: string;
  // Only read the org and report what would change
  dryRun: boolean;
  // Branch the deployment targets: the variables are read for it
  targetBranch: string | null;
}

export interface BrowserforceApplyOutcome {
  success: boolean;
  outputLines: string[];
}

// Messages of a browser that cannot start, from Playwright
const BROWSER_LAUNCH_ERROR_PATTERN = /Executable doesn't exist|browserType\.launch|Failed to launch|chrome-linux|ENOENT.*chrom/i;

export async function runBrowserforceApply(options: BrowserforceApplyOptions): Promise<BrowserforceApplyOutcome> {
  const references = findVariableReferences(options.config);
  const isSecret = references.length > 0 ? await buildSecretReferenceMatcher(options.setting) : () => true;
  const variables = await resolveVariables(references, options.targetBranch, isSecret);
  if (variables.missing.length > 0) {
    return fail(variables.missing.map((variable) => t('browserVariableMissing', { name: variable.name, lookedUp: variable.lookedUp.join(', ') })));
  }
  await ensureBrowserforce();
  const tmpDir = await createTempDir();
  try {
    const configFile = path.join(tmpDir, 'config.json');
    await fs.promises.writeFile(configFile, JSON.stringify({ settings: { [options.setting]: options.config } }, null, 2), 'utf8');
    const command = buildApplyCommand(configFile, options);
    // Run from the temporary folder: a Playwright trace never lands in the repository
    const { envelope, rawOutput } = await execBrowserforceJson(command, {
      cwd: tmpDir,
      env: { ...variables.env, ...(await getBrowserEnvironment()) },
      output: true,
    });
    if (envelope?.status === 0 && envelope?.result) {
      return { success: true, outputLines: formatApplyResult(options.setting, envelope.result) };
    }
    const message = redactSecrets(String(envelope?.message || rawOutput || 'sf browserforce apply failed'));
    const lines = [message];
    if (BROWSER_LAUNCH_ERROR_PATTERN.test(message)) {
      lines.push(t('browserforceBrowserLaunchFailed'));
    }
    return fail(lines);
  } finally {
    await removeTempDir(tmpDir);
  }
}

/**
 * Tells whether a variable reference fills a password field of the setting. A value per org (a
 * density, a URL) stays readable in the outputs; only secrets are masked. When the catalog cannot
 * say, the value is treated as a secret.
 */
async function buildSecretReferenceMatcher(setting: string): Promise<(reference: VariableReference) => boolean> {
  let fields: BrowserforceField[] = [];
  try {
    const { getBrowserforceCatalog, findBrowserforceSetting } = await import('./browserforceCatalog.js');
    fields = findBrowserforceSetting(await getBrowserforceCatalog(), setting)?.fields || [];
  } catch {
    return () => true;
  }
  const fieldPatterns = fields.map((field) => ({ field, pattern: buildFieldPathPattern(field.path) }));
  return (reference) => {
    const matched = fieldPatterns.find(({ pattern }) => pattern.test(reference.path));
    return matched ? matched.field.isPassword : true;
  };
}

// A catalog field path (portals[].name, *.consumerSecret) as a pattern of the paths of a value
// (portals[0].name, MyProvider.consumerSecret)
function buildFieldPathPattern(fieldPath: string): RegExp {
  const escaped = fieldPath
    .split('[]').map((part) => part.split('*').map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^.\\[\\]]+'))
    .join('\\[\\d+\\]');
  return new RegExp(`^${escaped}$`);
}

function buildApplyCommand(configFile: string, options: BrowserforceApplyOptions): string {
  return `sf browserforce apply -f "${configFile}" --target-org "${options.username}" --json` + (options.dryRun ? ' --dry-run' : '');
}

// The browser sfdx-hardis already knows (PUPPETEER_EXECUTABLE_PATH of the Docker image, or a local
// Chrome), unless the user chose one for Browserforce
async function getBrowserEnvironment(): Promise<Record<string, string>> {
  if (process.env.BROWSERFORCE_BROWSER_EXECUTABLE_PATH || process.env.CHROME_BIN) {
    return {};
  }
  const { getChromeExecutablePath } = await import('../../utils/orgConfigUtils.js');
  const executablePath = getChromeExecutablePath();
  return executablePath ? { BROWSERFORCE_BROWSER_EXECUTABLE_PATH: executablePath } : {};
}

// One line per changed field, or one line saying nothing differs
function formatApplyResult(setting: string, result: any): string[] {
  const dryRun = result?.dryRun === true;
  const entries: any[] = Array.isArray(result?.settings) ? result.settings : [];
  const lines: string[] = [];
  for (const entry of entries) {
    const changes = entry?.changes;
    if (!changes || typeof changes !== 'object' || Object.keys(changes).length === 0) {
      lines.push(dryRun ? t('browserDryRunNoChange', { setting: entry?.key || setting }) : t('browserNoChange', { setting: entry?.key || setting }));
      continue;
    }
    for (const [field, value] of Object.entries(changes)) {
      const params = { field, value: redactSecrets(JSON.stringify(value)) };
      lines.push(dryRun || entry?.applied !== true ? t('browserDryRunWouldChange', params) : t('browserApplied', params));
    }
  }
  for (const line of lines) {
    uxLog('log', null, c.green(`[DeploymentActions] ${line}`));
  }
  return lines;
}

function fail(lines: string[]): BrowserforceApplyOutcome {
  for (const line of lines) {
    uxLog('error', null, c.red(`[DeploymentActions] ${line}`));
  }
  return { success: false, outputLines: lines };
}
