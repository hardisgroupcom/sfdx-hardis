import * as path from 'path';
import fs from '../utils/fsUtils.js';
import { PACKAGE_ROOT_DIR } from '../../settings.js';
import { resolveMonitoringCommands } from '../notifProvider/notificationConfig.js';
import type { MonitoringCommandEntry } from '../notifProvider/types.js';
import { t } from '../utils/i18n.js';
import { getTitleI18nKey, monitoringCommandsDefault } from './monitoringDefaults.js';

// AGENTS.md written at the root of a monitoring repository, so that a coding agent opened in it knows
// how the backup works and what each file holds. Only the block between the markers belongs to
// sfdx-hardis: it is rewritten at each backup, and what users write outside of it is kept.
export const AGENTS_MD_START_MARKER = '<!-- sfdx-hardis-monitoring-agents-start -->';
export const AGENTS_MD_END_MARKER = '<!-- sfdx-hardis-monitoring-agents-end -->';

const AGENTS_MD_TEMPLATE = path.join(PACKAGE_ROOT_DIR, 'defaults', 'templates', 'monitoring', 'AGENTS.md');

// Replaces the sfdx-hardis block of an existing AGENTS.md, or appends it when the file has none
export function mergeAgentsMdBlock(existingContent: string | null, block: string): string {
  if (existingContent == null || existingContent.trim() === '') {
    return block;
  }
  const existing = existingContent.replace(/\r\n/g, '\n');
  const startPos = existing.indexOf(AGENTS_MD_START_MARKER);
  const endPos = existing.indexOf(AGENTS_MD_END_MARKER, startPos);
  if (startPos === -1 || endPos === -1) {
    return existing.trimEnd() + '\n\n' + block;
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

function describeFrequency(command: MonitoringCommandEntry, monitoringDisable: string[]): string {
  if (monitoringDisable.includes(command.key)) {
    return 'disabled (monitoringDisable)';
  }
  const frequency = command.frequency ?? 'daily';
  if ((frequency === 'weekly' || frequency === 'biweekly') && command.frequencyDay) {
    return `${frequency} (${command.frequencyDay})`;
  }
  if (frequency === 'monthly' && command.frequencyDayOfMonth) {
    return `${frequency} (day ${command.frequencyDayOfMonth})`;
  }
  return frequency;
}

function escapeTableCell(value: string): string {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export async function buildMonitoringAgentsMdBlock(config: any): Promise<string> {
  const template = (await fs.readFile(AGENTS_MD_TEMPLATE, 'utf8')).replace(/\r\n/g, '\n');
  const commands = resolveMonitoringCommands(monitoringCommandsDefault, config?.monitoringCommands);
  const monitoringDisable: string[] =
    config?.monitoringDisable ?? (process.env?.MONITORING_DISABLE ? process.env.MONITORING_DISABLE.split(',') : []);
  const table = buildMonitoringCommandsTable(commands, monitoringDisable);
  return template.replace('{{monitoringCommandsTable}}', table).trimEnd() + '\n';
}

// Writes AGENTS.md, and a CLAUDE.md that imports it when the repository has none.
// Returns the list of files that were created or updated.
export async function writeMonitoringAgentsMd(config: any, rootDir: string = process.cwd()): Promise<string[]> {
  const updatedFiles: string[] = [];
  const block = await buildMonitoringAgentsMdBlock(config);
  const agentsMdFile = path.join(rootDir, 'AGENTS.md');
  const existing = fs.existsSync(agentsMdFile) ? await fs.readFile(agentsMdFile, 'utf8') : null;
  const newContent = mergeAgentsMdBlock(existing, block);
  if (newContent !== existing) {
    await fs.writeFile(agentsMdFile, newContent, 'utf8');
    updatedFiles.push('AGENTS.md');
  }
  // Claude Code reads CLAUDE.md, not AGENTS.md
  const claudeMdFile = path.join(rootDir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdFile)) {
    await fs.writeFile(claudeMdFile, '@AGENTS.md\n', 'utf8');
    updatedFiles.push('CLAUDE.md');
  }
  return updatedFiles;
}
