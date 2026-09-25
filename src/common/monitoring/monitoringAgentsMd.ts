import * as path from 'path';
import fs from '../utils/fsUtils.js';
import { PACKAGE_ROOT_DIR } from '../../settings.js';
import {
  DEFAULT_MONTHLY_DAY,
  DEFAULT_WEEKLY_DAY,
  getMonitoringDisable,
  resolveMonitoringCommands,
} from '../notifProvider/notificationConfig.js';
import type { MonitoringCommandEntry } from '../notifProvider/types.js';
import { t } from '../utils/i18n.js';
import { getTitleI18nKey, monitoringCommandsDefault } from './monitoringDefaults.js';
import { GitProvider } from '../gitProvider/index.js';

// AGENTS.md written at the root of a monitoring repository, so that a coding agent opened in it knows
// how the backup works and what each file holds. Only the block between the markers belongs to
// sfdx-hardis: it is rewritten at each backup, and what users write outside of it is kept.
export const AGENTS_MD_START_MARKER = '<!-- sfdx-hardis-monitoring-agents-start -->';
export const AGENTS_MD_END_MARKER = '<!-- sfdx-hardis-monitoring-agents-end -->';

const AGENTS_MD_TEMPLATE = path.join(PACKAGE_ROOT_DIR, 'defaults', 'templates', 'monitoring', 'AGENTS.md');

function countOccurrences(content: string, marker: string): number {
  return content.split(marker).length - 1;
}

// Replaces the sfdx-hardis block of an existing AGENTS.md, or appends it when the file has none.
// Returns null when the markers are broken (one without the other, several pairs, end before start):
// the file is then left alone, because guessing where the block ends could delete what the user wrote.
export function mergeAgentsMdBlock(existingContent: string | null, block: string): string | null {
  if (existingContent == null || existingContent.trim() === '') {
    return block;
  }
  const existing = existingContent.replace(/\r\n/g, '\n');
  const startCount = countOccurrences(existing, AGENTS_MD_START_MARKER);
  const endCount = countOccurrences(existing, AGENTS_MD_END_MARKER);
  if (startCount === 0 && endCount === 0) {
    return existing.trimEnd() + '\n\n' + block;
  }
  const startPos = existing.indexOf(AGENTS_MD_START_MARKER);
  const endPos = existing.indexOf(AGENTS_MD_END_MARKER);
  if (startCount !== 1 || endCount !== 1 || endPos < startPos) {
    return null;
  }
  const before = existing.substring(0, startPos);
  const after = existing.substring(endPos + AGENTS_MD_END_MARKER.length).replace(/^\n/, '');
  return before + block + after;
}

export function buildMonitoringCommandsTable(commands: MonitoringCommandEntry[], monitoringDisable: string[]): string {
  const lines = ['| Key | Check | Command | Frequency |', '| --- | ----- | ------- | --------- |'];
  for (const command of commands) {
    if (!command.command) {
      continue;
    }
    const title = command.title ?? t(getTitleI18nKey(command.key));
    lines.push(`| \`${command.key}\` | ${escapeTableCell(title)} | \`${escapeTableCell(command.command)}\` | ${describeFrequency(command, monitoringDisable)} |`);
  }
  return lines.join('\n');
}

// Same defaults as shouldRunCommandNow, so the table says the day the check really runs
function describeFrequency(command: MonitoringCommandEntry, monitoringDisable: string[]): string {
  if (monitoringDisable.includes(command.key)) {
    return 'disabled (monitoringDisable)';
  }
  const frequency = command.frequency ?? 'daily';
  if (frequency === 'weekly') {
    return `weekly (${command.frequencyDay ?? DEFAULT_WEEKLY_DAY})`;
  }
  if (frequency === 'biweekly') {
    return `biweekly (${command.frequencyDay ?? DEFAULT_WEEKLY_DAY}, even ISO weeks)`;
  }
  if (frequency === 'monthly') {
    return `monthly (day ${command.frequencyDayOfMonth ?? DEFAULT_MONTHLY_DAY})`;
  }
  return frequency;
}

function escapeTableCell(value: string): string {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export async function buildMonitoringAgentsMdBlock(config: any): Promise<string> {
  const template = (await fs.readFile(AGENTS_MD_TEMPLATE, 'utf8')).replace(/\r\n/g, '\n');
  const commands = resolveMonitoringCommands(monitoringCommandsDefault, config?.monitoringCommands);
  const table = buildMonitoringCommandsTable(commands, getMonitoringDisable(config));
  const deploymentRepositoryStatus = buildDeploymentRepositoryStatus(config);
  // Replacer functions: a value from the configuration may hold $$, $& or $', which a replacement
  // string would expand instead of copying
  return template
    .replace('{{monitoringCommandsTable}}', () => table)
    .replace('{{deploymentRepositoryStatus}}', () => deploymentRepositoryStatus)
    .trimEnd() + '\n';
}

export function buildDeploymentRepositoryStatus(config: any): string {
  const deploymentRepository = typeof config?.deploymentRepository === 'string' ? config.deploymentRepository.trim() : '';
  if (deploymentRepository === '') {
    return [
      '**No deployment repository is configured on this branch.** The first time a question would need the CI/CD project or its pipelines, ask the user whether they want to set one:',
      '',
      '1. Ask for the address of the sfdx-hardis CI/CD repository that deploys to this org (for example `https://github.com/my-company/my-project`). It is optional: if the user declines, answer with this repository alone and do not ask again in this conversation.',
      '2. If the user gives one, check that it is a git repository address (`https://host/path`, `ssh://host/path` or `user@host:path`), then write it as `deploymentRepository: <address>` in `.sfdx-hardis.yml` at the root of this branch. Change only that line, and keep the rest of the file and its comments as they are.',
      '3. Ask whether the other monitoring branches of this repository (`git branch -a`) are deployed by the same repository. It is usually the case: each branch has its own `.sfdx-hardis.yml`, and the user has to update them one by one.',
      '4. Tell the user to commit and push the change (do not do it unless they ask), and that the next backup rewrites this file with it. Then use it right away, as explained below.',
      '',
      'The user can also set it from the Org Monitoring panel of VS Code.',
    ].join('\n');
  }
  const providerType = GitProvider.getProviderTypeFromRemoteUrl(deploymentRepository);
  const lines = [`The deployment repository of this org is \`${deploymentRepository}\`${providerType ? ` (git provider: \`${providerType}\`)` : ''}, from \`deploymentRepository\` in \`.sfdx-hardis.yml\`.`];
  const deploymentBranch = typeof config?.deploymentBranch === 'string' ? config.deploymentBranch.trim() : '';
  if (deploymentBranch !== '') {
    lines.push(`Its branch \`${deploymentBranch}\` deploys to this org (\`deploymentBranch\` in \`.sfdx-hardis.yml\`).`);
  } else {
    lines.push('Find its branch that deploys to this org as explained below.');
  }
  return lines.join(' ');
}

export type MonitoringAgentsMdResult = {
  // Files created or updated
  updatedFiles: string[];
  // AGENTS.md exists with broken markers, so it was not touched
  markersBroken: boolean;
};

// Writes AGENTS.md, and a CLAUDE.md that imports it when the repository has none
export async function writeMonitoringAgentsMd(config: any, rootDir: string = process.cwd()): Promise<MonitoringAgentsMdResult> {
  const result: MonitoringAgentsMdResult = { updatedFiles: [], markersBroken: false };
  const block = await buildMonitoringAgentsMdBlock(config);
  const agentsMdFile = path.join(rootDir, 'AGENTS.md');
  const existing = fs.existsSync(agentsMdFile) ? await fs.readFile(agentsMdFile, 'utf8') : null;
  const newContent = mergeAgentsMdBlock(existing, block);
  if (newContent === null) {
    result.markersBroken = true;
  } else if (newContent !== existing) {
    await fs.writeFile(agentsMdFile, newContent, 'utf8');
    result.updatedFiles.push('AGENTS.md');
  }
  // Claude Code reads CLAUDE.md, not AGENTS.md
  const claudeMdFile = path.join(rootDir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdFile)) {
    await fs.writeFile(claudeMdFile, '@AGENTS.md\n', 'utf8');
    result.updatedFiles.push('CLAUDE.md');
  }
  return result;
}
