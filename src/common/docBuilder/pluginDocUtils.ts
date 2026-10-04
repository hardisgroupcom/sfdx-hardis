import fs from 'fs';
import * as path from 'path';
import sortArray from '../utils/sortArray.js';

export const GENERATED_PLUGIN_DOC_HEADER =
  "<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->";

const GENERATED_PLUGIN_DOC_HEADER_START = "<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'";

export type CommandSelection = {
  /** Ids of the commands matching at least one pattern, in the order of the command list */
  selected: string[];
  /** Patterns that match no command */
  unmatched: string[];
};

export type GeneratedCommandPage = {
  commandId: string;
  file: string;
};

type TableAlignment = 'left' | 'center' | 'right' | 'none';

/**
 * Resolves the values of --commands against the ids of the plugin.
 *
 * A value is a list of ids or patterns separated by commas. `*` stands for any sequence of
 * characters, `:` included, so `hardis:*:deploy:*` reaches `hardis:project:deploy:sources:dx`.
 * An id typed the way it is run (`hardis org monitor backup`) is read as its colon form.
 */
export function selectCommands(allCommandIds: string[], patterns: string[]): CommandSelection {
  const normalizedPatterns = patterns
    .flatMap((pattern) => pattern.split(','))
    .map((pattern) => pattern.trim().replace(/\s+/g, ':'))
    .filter((pattern) => pattern !== '');
  const selectedIds = new Set<string>();
  const unmatched: string[] = [];
  for (const pattern of normalizedPatterns) {
    const regex = new RegExp('^' + pattern.split('*').map(escapeRegex).join('.*') + '$');
    const matches = allCommandIds.filter((commandId) => regex.test(commandId));
    if (matches.length === 0) {
      unmatched.push(pattern);
    }
    for (const match of matches) {
      selectedIds.add(match);
    }
  }
  return { selected: allCommandIds.filter((commandId) => selectedIds.has(commandId)), unmatched };
}

// Path of the page of a command, relative to the docs folder, with forward slashes
export function getCommandDocRelativePath(commandId: string): string {
  return commandId.replace(/:/g, '/') + '.md';
}

/**
 * Lists the command pages this generator wrote under the docs folder.
 *
 * A page counts when it starts with the generated header and its title is the command id
 * its own path stands for. The folder is no proof: hand-written pages live next to the
 * generated ones, and index.md carries the same header. A page already replaced by
 * buildRemovedCommandPage has no header anymore, so it is never listed and never rewritten.
 */
export function listGeneratedCommandPages(docsRoot: string): GeneratedCommandPage[] {
  const pages: GeneratedCommandPage[] = [];
  for (const file of listMarkdownFiles(docsRoot)) {
    const content = fs.readFileSync(file, 'utf8');
    if (!content.startsWith(GENERATED_PLUGIN_DOC_HEADER_START)) {
      continue;
    }
    const titleLine = content.split(/\r?\n/, 3).find((line) => line.startsWith('# '));
    const pathCommandId = path.relative(docsRoot, file).replace(/\.md$/, '').split(path.sep).join(':');
    if (titleLine && titleLine.substring(2).trim() === pathCommandId) {
      pages.push({ commandId: pathCommandId, file });
    }
  }
  return pages;
}

// Markdown page of a single command
export function buildCommandDocMarkdown(command: any): string {
  const lines = [GENERATED_PLUGIN_DOC_HEADER];
  // Title
  lines.push(`# ${command.id}`, '');
  // Description
  lines.push(`## Description`, '', ...(command.description || '').split('\n'), '');
  // Flags
  lines.push(
    `## Parameters`,
    '',
    '|Name|Type|Description|Default|Required|Options|',
    '|:---|:--:|:----------|:-----:|:------:|:-----:|',
    ...Object.keys(command.flags || {})
      .sort()
      .map((flagKey: string) => buildFlagTableRow(command.flags[flagKey])),
    ''
  );
  // Examples
  lines.push(
    `## Examples`,
    '',
    ...(command.examples || []).map((example: string) => ['```shell', ...(example || '').split('\n'), '```', '']).flat(),
    ''
  );
  return formatMarkdownTables(lines.join('\n') + '\n');
}

/**
 * Markdown of index.md and commands.md, which both list every command of the plugin.
 * index.md opens with the README of the plugin, up to its own list of commands.
 */
export function buildIndexAndCommandsMarkdown(
  commands: any[],
  pjson: any,
  readme: string
): { indexMarkdown: string; commandsMarkdown: string } {
  const lines = [GENERATED_PLUGIN_DOC_HEADER];
  let reusableReadmePartFound = false;
  // Try to find README content until auto-generated commands
  const limitStrings = ['## Commands', '## COMMANDS', '# Commands', '<!-- commands -->'];
  for (const limitString of limitStrings) {
    if (readme.indexOf(limitString) > 0) {
      lines.push(...readme.substring(0, readme.indexOf(limitString)).split(/\r?\n/));
      reusableReadmePartFound = true;
      break;
    }
  }
  // Default index.md
  if (reusableReadmePartFound === false) {
    lines.push('', `# ${pjson.name}`, '', '## Description', '', (pjson.description || '').split('\n').join('<br/>'), '');
  }

  // Build commands (for index.md and commands.md)
  const cmdLines: string[] = [];
  lines.push('', '## Commands');
  cmdLines.push('# Commands');
  let currentSection = '';
  for (const command of sortArray(commands, { by: ['id'], order: ['asc'] }) as any[]) {
    const section = command.id.split(':')[0] + ':' + command.id.split(':')[1];
    if (section !== currentSection) {
      lines.push('', `### ${section}`, '', '|Command|Title|', '|:------|:----------|');
      cmdLines.push('', `## ${section}`, '', '|Command|Title|', '|:------|:----------|');
      currentSection = section;
    }
    const row = `|[**${command.id}**](${getCommandDocRelativePath(command.id)})|${sanitizeTableCell(getCommandTitle(command))}|`;
    lines.push(row);
    cmdLines.push(row);
  }
  return {
    indexMarkdown: formatMarkdownTables(lines.join('\n') + '\n'),
    commandsMarkdown: formatMarkdownTables(cmdLines.join('\n') + '\n'),
  };
}

/**
 * Page left where a command used to be documented, so the links to it keep working.
 * It has no generated header: later runs leave it alone, and a note such as the command
 * to use instead can be added by hand. It is out of the search, like the moved pages.
 */
export function buildRemovedCommandPage(commandId: string): string {
  const commandsPagePath = '../'.repeat(commandId.split(':').length - 1) + 'commands.md';
  return [
    '---',
    `title: "${commandId}"`,
    'description: This command no longer exists',
    'search:',
    '  exclude: true',
    '---',
    "<!-- Removed command page kept by 'sf hardis:doc:plugin:generate' so old links keep working. You can edit it. -->",
    '',
    `# ${commandId}`,
    '',
    'This command no longer exists.',
    '',
    `See the [list of available commands](${commandsPagePath}).`,
    '',
  ].join('\n');
}

// Title of a command in the lists of commands
export function getCommandTitle(command: any): string {
  if (command.title) {
    return command.title;
  }
  if (command.summary) {
    return command.summary;
  }
  const firstTextLine = (command.description || '')
    .split('\n')
    .map((line: string) => line.trim())
    .find((line: string) => line !== '' && !line.startsWith('#') && !line.startsWith('<'));
  return firstTextLine || '';
}

// Row of the Parameters table for a flag, as oclif caches it
export function buildFlagTableRow(flag: any): string {
  const optionsUnique: string[] = [];
  for (const option of flag.options || []) {
    if (!optionsUnique.some((o) => o.toLowerCase() === String(option).toLowerCase())) {
      optionsUnique.push(String(option));
    }
  }
  // A default computed on the machine that builds the doc (the default org username) says
  // nothing about the command: oclif leaves it out of its manifest, and so does the doc.
  const defaultValue = flag.noCacheDefault ? '' : flag.default || '';
  const cells = [
    sanitizeTableCell(flag.name) + (flag.char ? `<br/>-${flag.char}` : ''),
    flag.type,
    sanitizeTableCell(flag.description || flag.summary || ''),
    sanitizeTableCell(String(defaultValue)),
    flag.required ? 'true' : '',
    optionsUnique.map((option) => sanitizeTableCell(option)).join('<br/>'),
  ];
  return `|${cells.join('|')}|`;
}

// A table cell holds one line, and a pipe in it would start another cell
export function sanitizeTableCell(text: string): string {
  return String(text ?? '')
    .trim()
    .replace(/\r?\n/g, '<br/>')
    .replace(/\\?\|/g, '\\|');
}

/**
 * Pads the tables of a Markdown text the way markdown-table-formatter does, so a generated
 * page is identical to what MegaLinter would turn it into. Tables in code blocks are left
 * alone, and so is a table with a row that does not have the cells of its header.
 */
export function formatMarkdownTables(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeBlock = !inCodeBlock;
    }
    if (inCodeBlock || !line.startsWith('|') || !isTableSeparatorLine(lines[i + 1] || '')) {
      result.push(line);
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end].startsWith('|')) {
      end++;
    }
    const tableLines = lines.slice(i, end);
    result.push(...formatTable(tableLines));
    i = end;
  }
  return result.join('\n');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(entryPath));
    } else if (entry.name.endsWith('.md')) {
      files.push(entryPath);
    }
  }
  return files;
}

function isTableSeparatorLine(line: string): boolean {
  return /^\|(\s*:?-+:?\s*\|)+\s*$/.test(line);
}

function formatTable(tableLines: string[]): string[] {
  const rows = tableLines.map((tableLine) => splitTableRow(tableLine));
  const columnCount = rows[1]?.length ?? 0;
  if (rows.some((row) => row === null || row.length !== columnCount)) {
    return tableLines;
  }
  const cellRows = rows as string[][];
  const alignments = cellRows[1].map((cell) => getTableAlignment(cell));
  const contentRows = [cellRows[0], ...cellRows.slice(2)];
  const widths = alignments.map((_, column) => Math.max(...contentRows.map((row) => getTextWidth(row[column]))));
  const formatRow = (row: string[]) =>
    '|' + row.map((cell, column) => ' ' + padTableCell(cell, widths[column], alignments[column]) + ' ').join('|') + '|';
  const separator =
    '|' + alignments.map((alignment, column) => buildTableSeparatorCell(widths[column], alignment)).join('|') + '|';
  return [formatRow(cellRows[0]), separator, ...cellRows.slice(2).map(formatRow)];
}

// Cells of a table row, or null when the line is not closed by a pipe
function splitTableRow(line: string): string[] | null {
  const trimmedLine = line.trimEnd();
  if (!trimmedLine.endsWith('|') || trimmedLine.endsWith('\\|')) {
    return null;
  }
  const cells: string[] = [];
  let current = '';
  for (let i = 1; i < trimmedLine.length; i++) {
    const char = trimmedLine[i];
    if (char === '\\' && trimmedLine[i + 1] === '|') {
      current += '\\|';
      i++;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  return cells;
}

function getTableAlignment(separatorCell: string): TableAlignment {
  const startsWithColon = separatorCell.startsWith(':');
  const endsWithColon = separatorCell.endsWith(':');
  if (startsWithColon && endsWithColon) {
    return 'center';
  }
  if (startsWithColon) {
    return 'left';
  }
  return endsWithColon ? 'right' : 'none';
}

function getTextWidth(text: string): number {
  return [...text].length;
}

function padTableCell(text: string, width: number, alignment: TableAlignment): string {
  const extra = width - getTextWidth(text);
  if (alignment === 'center') {
    return ' '.repeat(Math.floor(extra / 2)) + text + ' '.repeat(Math.ceil(extra / 2));
  }
  if (alignment === 'right') {
    return ' '.repeat(extra) + text;
  }
  return text + ' '.repeat(extra);
}

// The separator spans the cell and its two margins, colons included
function buildTableSeparatorCell(width: number, alignment: TableAlignment): string {
  if (alignment === 'center') {
    return ':' + '-'.repeat(width) + ':';
  }
  if (alignment === 'left') {
    return ':' + '-'.repeat(width + 1);
  }
  if (alignment === 'right') {
    return '-'.repeat(width + 1) + ':';
  }
  return '-'.repeat(width + 2);
}
