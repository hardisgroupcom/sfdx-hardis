/**
 * Render normalized test cases into the deliverable a tester receives: a formatted Excel
 * workbook, or a CSV Excel opens cleanly on a double click.
 *
 * This module writes the workbook itself with ExcelJS rather than going through
 * `generateCsvFile` / `createXlsxFromCsv` of filesUtils, and that is deliberate. Those write
 * *reports*: a comma delimited CSV with no BOM, re-read through the ExcelJS CSV parser (also
 * comma based), then decorated with an Excel table whose theme rewrites the rows. A test
 * notebook is a different artifact: semicolon delimited with a UTF-8 BOM so Excel opens the
 * accents on a double click, a frozen bold header on a grey fill, a `Statut` column restricted
 * to a value list, and a SYNTHÈSE footer. Forcing one through the other would break the
 * round trip that lets the parser read back the very workbook this module produced.
 *
 * What is shared with filesUtils is what genuinely is: the report path, the IDE notification,
 * and the formula-injection guard of testNotebookGuards.
 */

import ExcelJS from 'exceljs';
import path from 'path';
import fs from './fsUtils.js';
import { sanitizeCell } from './testNotebookGuards.js';
import { renderStepsFlat, STEP_SEPARATOR } from './testNotebookUtils.js';
import { NormalizedTestCase, TestCaseKind } from './testNotebookTypes.js';

export const STATUS_VALUES = ['OK', 'KO', 'N/A', 'Bloqué'];
const HEADER_FILL_ARGB = 'FFD9D9D9';
const BOM = '\ufeff';
const CSV_DELIMITER = ';';
const CSV_EOL = '\r\n';
export const SYNTHESIS_SHEET_NAME = 'Synthèse';
export const SYNTHESIS_MARKER = 'SYNTHÈSE';

interface NotebookColumn {
  key: string;
  header: string;
  width: number;
}

const COL: Record<string, NotebookColumn> = {
  id: { key: 'id', header: 'ID', width: 16 },
  module: { key: 'module', header: 'Module', width: 26 },
  // 9.5, not 9: ExcelJS treats a width equal to the default column width (9) as "not custom"
  // and omits customWidth on write, so a width of exactly 9 reads back undefined.
  priority: { key: 'priority', header: 'Priorité', width: 9.5 },
  target: { key: 'target', header: 'Classe / Méthode', width: 30 },
  title: { key: 'title', header: 'Cas de test', width: 40 },
  preconditions: { key: 'preconditions', header: 'Prérequis et données', width: 40 },
  soql: { key: 'soql', header: 'Requête SOQL', width: 55 },
  steps: { key: 'steps', header: 'Étapes', width: 60 },
  expected: { key: 'expected', header: 'Résultat attendu', width: 40 },
  actual: { key: 'actual', header: 'Résultat obtenu', width: 24 },
  comment: { key: 'comment', header: 'Commentaire', width: 24 },
  status: { key: 'status', header: 'Statut', width: 10 },
};

/**
 * `Requête SOQL` sits right after `Prérequis et données`: it is what finds the data that
 * column describes. The technical notebook gets neither it nor `Étapes`, a unit test building
 * its own data in its setup, and carries `Classe / Méthode` instead.
 */
export const COLUMNS: Record<TestCaseKind, NotebookColumn[]> = {
  functional: [
    COL.id, COL.module, COL.priority, COL.title, COL.preconditions, COL.soql, COL.steps,
    COL.expected, COL.actual, COL.comment, COL.status,
  ],
  technical: [
    COL.id, COL.module, COL.priority, COL.target, COL.title, COL.preconditions, COL.expected,
    COL.actual, COL.comment, COL.status,
  ],
  tma: [COL.id, COL.title, COL.preconditions, COL.soql, COL.steps, COL.expected, COL.actual, COL.comment, COL.status],
};

export const SHEET_NAMES: Record<TestCaseKind, string> = {
  functional: 'Fonctionnel',
  technical: 'Technique',
  tma: 'TMA',
};

/**
 * Value of one cell. `Résultat obtenu`, `Commentaire` and `Statut` are written empty on
 * purpose: they are the tester's columns, and pre-filling them would be answering for them.
 */
function _valueFor(key: string, testCase: NormalizedTestCase, stepSeparator: string): string {
  switch (key) {
    case 'priority':
      return sanitizeCell(`P${testCase.priority}`);
    case 'steps':
      return sanitizeCell(renderStepsFlat(testCase.steps, stepSeparator));
    case 'actual':
    case 'comment':
    case 'status':
      return '';
    case 'target':
      return sanitizeCell(testCase.target || '');
    default:
      return sanitizeCell((testCase as any)[key] === undefined ? '' : String((testCase as any)[key]));
  }
}

/** One row per module plus a TOTAL, counting the cases by priority. */
export function synthesisRows(cases: NormalizedTestCase[]): Array<Array<string | number>> {
  const byModule = new Map<string, { n: number; 1: number; 2: number; 3: number }>();
  for (const testCase of cases) {
    const key = testCase.module || '(sans module)';
    if (!byModule.has(key)) {
      byModule.set(key, { n: 0, 1: 0, 2: 0, 3: 0 });
    }
    const aggregate = byModule.get(key) as any;
    aggregate.n++;
    aggregate[testCase.priority] = (aggregate[testCase.priority] || 0) + 1;
  }
  const rows: Array<Array<string | number>> = [];
  const total = { n: 0, 1: 0, 2: 0, 3: 0 };
  for (const [moduleName, aggregate] of byModule) {
    rows.push([moduleName, aggregate.n, aggregate[1], aggregate[2], aggregate[3]]);
    total.n += aggregate.n;
    total[1] += aggregate[1];
    total[2] += aggregate[2];
    total[3] += aggregate[3];
  }
  rows.push(['TOTAL', total.n, total[1], total[2], total[3]]);
  return rows;
}

/** Header keys of a column set, so a caller can build a header row without knowing the shape. */
export function headersFor(kind: TestCaseKind): string[] {
  return COLUMNS[kind].map((column) => column.header);
}

/** One record per case, keyed by header, ready to be written to a sheet or a CSV line. */
export function buildRows(
  kind: TestCaseKind,
  cases: NormalizedTestCase[],
  stepSeparator: string = STEP_SEPARATOR
): Array<Record<string, string>> {
  return cases.map((testCase) => {
    const row: Record<string, string> = {};
    for (const column of COLUMNS[kind]) {
      row[column.header] = _valueFor(column.key, testCase, stepSeparator);
    }
    return row;
  });
}

function _styleHeader(worksheet: ExcelJS.Worksheet): void {
  const header = worksheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
  });
  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
}

function _addCasesSheet(workbook: ExcelJS.Workbook, kind: TestCaseKind, cases: NormalizedTestCase[]): void {
  const columns = COLUMNS[kind];
  const worksheet = workbook.addWorksheet(SHEET_NAMES[kind]);
  worksheet.columns = columns.map((column) => ({ header: column.header, key: column.key, width: column.width }));
  _styleHeader(worksheet);

  for (const testCase of cases) {
    const row = worksheet.addRow(columns.map((column) => _valueFor(column.key, testCase, '\n')));
    row.eachCell((cell) => {
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
  }

  // Column letters are computed rather than derived from a single char code, so the range
  // stays correct past Z.
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  // The tester picks a status from a list instead of typing free text.
  const statusIndex = columns.findIndex((column) => column.key === 'status') + 1;
  if (statusIndex > 0 && cases.length > 0) {
    for (let rowNumber = 2; rowNumber <= cases.length + 1; rowNumber++) {
      worksheet.getCell(rowNumber, statusIndex).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${STATUS_VALUES.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Statut invalide',
        error: `Valeurs autorisées : ${STATUS_VALUES.join(', ')}`,
      };
    }
  }
}

function _addSynthesisSheet(workbook: ExcelJS.Workbook, cases: NormalizedTestCase[]): void {
  const worksheet = workbook.addWorksheet(SYNTHESIS_SHEET_NAME);
  worksheet.columns = [
    { header: 'Module', key: 'module', width: 34 },
    { header: 'Nb tests', key: 'n', width: 10 },
    { header: 'P1', key: 'p1', width: 6 },
    { header: 'P2', key: 'p2', width: 6 },
    { header: 'P3', key: 'p3', width: 6 },
  ];
  _styleHeader(worksheet);
  for (const row of synthesisRows(cases)) {
    worksheet.addRow(row);
  }
  if (worksheet.lastRow) {
    worksheet.lastRow.font = { bold: true };
  }
}

/** Write the workbook. The sheet is named after the kind, so a tester knows what they hold. */
export async function writeNotebookXlsx(
  outputPath: string,
  kind: TestCaseKind,
  cases: NormalizedTestCase[]
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'sfdx-hardis';
  workbook.created = new Date();
  _addCasesSheet(workbook, kind, cases);
  _addSynthesisSheet(workbook, cases);
  await fs.ensureDir(path.dirname(path.resolve(outputPath)));
  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}

function _escapeCsvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (text.includes('"') || text.includes(CSV_DELIMITER) || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Pad every line to the header width, so no line is wider than the header. */
function _csvLine(fields: Array<string | number>, width: number): string {
  const padded = fields.slice(0, width);
  while (padded.length < width) {
    padded.push('');
  }
  return padded.map(_escapeCsvField).join(CSV_DELIMITER);
}

/**
 * Write the CSV: `;` delimiter, UTF-8 WITH BOM so Excel opens the accents on a double click,
 * CRLF line endings, and a SYNTHÈSE footer. `parseNotebookCsv` stops at that footer marker,
 * so the file stays readable back.
 */
export async function writeNotebookCsv(
  outputPath: string,
  kind: TestCaseKind,
  cases: NormalizedTestCase[]
): Promise<string> {
  const columns = COLUMNS[kind];
  const width = columns.length;
  const lines = [_csvLine(columns.map((column) => column.header), width)];
  for (const testCase of cases) {
    lines.push(_csvLine(columns.map((column) => _valueFor(column.key, testCase, STEP_SEPARATOR)), width));
  }
  lines.push(_csvLine([], width));
  lines.push(_csvLine([SYNTHESIS_MARKER], width));
  lines.push(_csvLine(['Module', 'Nb tests', 'P1', 'P2', 'P3'], width));
  for (const row of synthesisRows(cases)) {
    lines.push(_csvLine(row, width));
  }
  await fs.ensureDir(path.dirname(path.resolve(outputPath)));
  await fs.writeFile(outputPath, BOM + lines.join(CSV_EOL) + CSV_EOL, 'utf8');
  return outputPath;
}

export interface TemplateOptions {
  kind: TestCaseKind;
  ticket: string;
  /** One group of rows per module. Empty means a single group with no module name. */
  modules?: string[];
  /** Rows per module group. */
  rows: number;
}

/** Identifier prefix of a kind: -F01 functional, -T01 technical, -01 TMA. */
const KIND_ID_LETTER: Record<TestCaseKind, string> = { functional: 'F', technical: 'T', tma: '' };

/**
 * Build the rows of an empty notebook, identifiers pre-filled to the convention.
 *
 * Numbering runs continuously across module groups and does not restart at each one: two
 * cases sharing an identifier are indistinguishable to anything that reads the notebook back.
 *
 * Every identifier produced here is readable back by `deriveTicketAndKind`, so the blank
 * workbook this feeds is readable back without any manual fixing.
 */
export function buildTemplateRows(options: TemplateOptions): Array<Record<string, string>> {
  const groups = options.modules && options.modules.length > 0 ? options.modules : [''];
  const headers = headersFor(options.kind);
  const letter = KIND_ID_LETTER[options.kind];
  const rows: Array<Record<string, string>> = [];
  let counter = 1;
  for (const moduleName of groups) {
    for (let i = 0; i < Math.max(1, options.rows); i++) {
      const row: Record<string, string> = {};
      for (const header of headers) {
        row[header] = '';
      }
      row['ID'] = `${options.ticket}-${letter}${String(counter).padStart(2, '0')}`;
      if (moduleName && headers.includes('Module')) {
        row['Module'] = moduleName;
      }
      rows.push(row);
      counter++;
    }
  }
  return rows;
}

/** Write an empty notebook as a workbook, a CSV or a markdown table. */
export async function writeTemplate(
  outputPath: string,
  options: TemplateOptions,
  format: 'xlsx' | 'csv' | 'md'
): Promise<string> {
  const headers = headersFor(options.kind);
  const rows = buildTemplateRows(options);
  await fs.ensureDir(path.dirname(path.resolve(outputPath)));

  if (format === 'md') {
    const lines = [
      `| ${headers.join(' | ')} |`,
      `|${headers.map(() => '---').join('|')}|`,
      ...rows.map((row) => `| ${headers.map((header) => row[header] || '').join(' | ')} |`),
    ];
    await fs.writeFile(outputPath, lines.join('\n') + '\n', 'utf8');
    return outputPath;
  }

  if (format === 'csv') {
    const width = headers.length;
    const lines = [_csvLine(headers, width), ...rows.map((row) => _csvLine(headers.map((h) => row[h] || ''), width))];
    await fs.writeFile(outputPath, BOM + lines.join(CSV_EOL) + CSV_EOL, 'utf8');
    return outputPath;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'sfdx-hardis';
  workbook.created = new Date();
  const columns = COLUMNS[options.kind];
  const worksheet = workbook.addWorksheet(SHEET_NAMES[options.kind]);
  worksheet.columns = columns.map((column) => ({ header: column.header, key: column.key, width: column.width }));
  _styleHeader(worksheet);
  for (const row of rows) {
    const added = worksheet.addRow(headers.map((header) => row[header] || ''));
    added.eachCell((cell) => {
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
  }
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const statusIndex = columns.findIndex((column) => column.key === 'status') + 1;
  if (statusIndex > 0 && rows.length > 0) {
    for (let rowNumber = 2; rowNumber <= rows.length + 1; rowNumber++) {
      worksheet.getCell(rowNumber, statusIndex).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${STATUS_VALUES.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Statut invalide',
        error: `Valeurs autorisées : ${STATUS_VALUES.join(', ')}`,
      };
    }
  }
  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}
