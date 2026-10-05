import * as path from 'path';
import * as yaml from 'js-yaml';
import fs from '../utils/fsUtils.js';
import { PACKAGE_ROOT_DIR } from '../../settings.js';

export const MEGALINTER_CONFIG_FILE = '.mega-linter.yml';

const MEGALINTER_CONFIG_TEMPLATE = path.join(PACKAGE_ROOT_DIR, 'defaults', 'monitoring', MEGALINTER_CONFIG_FILE);

const DISABLE_ERRORS_LINES = [
  '# Added by sf hardis:org:monitor:backup: MegaLinter reports its findings (reports, notifications,',
  '# Grafana) without failing the monitoring job. Set it to false to make the job fail on them again.',
  'DISABLE_ERRORS: true',
];

export interface MonitoringMegaLinterConfigResult {
  status: 'created' | 'updated' | 'unchanged' | 'unparsable';
  message?: string;
}

// The MegaLinter job of a monitoring pipeline does not run sfdx-hardis: its configuration file is
// the only way to keep it from failing on findings without changing the pipeline of the repository
export async function ensureMonitoringMegaLinterConfig(repoDir = process.cwd()): Promise<MonitoringMegaLinterConfigResult> {
  const configFile = path.join(repoDir, MEGALINTER_CONFIG_FILE);
  if (!fs.existsSync(configFile)) {
    await fs.copy(MEGALINTER_CONFIG_TEMPLATE, configFile);
    return { status: 'created' };
  }
  const content = await fs.readFile(configFile, 'utf8');
  let updatedContent: string | null;
  try {
    updatedContent = addDisableErrors(content);
  } catch (e: any) {
    return { status: 'unparsable', message: e?.message || String(e) };
  }
  if (updatedContent === null) {
    return { status: 'unchanged' };
  }
  await fs.writeFile(configFile, updatedContent);
  return { status: 'updated' };
}

// Returns the content with DISABLE_ERRORS: true appended, or null when the team already decided:
// a DISABLE_ERRORS key, true or false, is never overridden. Appended as text, so that the comments
// and the formatting of the file are kept. Throws when the content is not a YAML mapping.
export function addDisableErrors(content: string): string | null {
  const parsed = yaml.load(content) ?? {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('the root of the file is not a list of properties');
  }
  if ('DISABLE_ERRORS' in parsed) {
    return null;
  }
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const separator = content.trim() === '' ? '' : (content.endsWith('\n') ? '' : eol) + eol;
  return content + separator + DISABLE_ERRORS_LINES.join(eol) + eol;
}
