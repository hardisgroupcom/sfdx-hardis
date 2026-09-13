/**
 * Write normalized test cases into the notebook a tester works in: an Excel workbook, a CSV or a
 * markdown table. Every file written here is read back by testNotebookUtils.ts.
 *
 * The workbook is written with ExcelJS rather than with `generateCsvFile`: a notebook needs a
 * status value list, tester columns and a summary sheet, and must stay readable back, which a
 * report does not.
 */

import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import path from 'path';
import fs from './fsUtils.js';
import {
  NormalizedTestCase,
  renderStepsFlat,
  sanitizeCsvCell,
  STEP_SEPARATOR,
  SUMMARY_MARKER,
  TestCaseKind,
} from './testNotebookUtils.js';

export type NotebookFormat = 'xlsx' | 'csv' | 'md';

export const STATUS_VALUES = ['Passed', 'Failed', 'Blocked', 'N/A'];
export const SUMMARY_SHEET_NAME = 'Summary';
const HEADER_FILL_ARGB = 'FFD9D9D9';

interface NotebookColumn {
  key: string;
  header: string;
  width: number;
}

const COL: Record<string, NotebookColumn> = {
  id: { key: 'id', header: 'ID', width: 16 },
  module: { key: 'module', header: 'Module', width: 26 },
  // 9.5, not 9: ExcelJS drops a width equal to the default one (9) on write
  priority: { key: 'priority', header: 'Priority', width: 9.5 },
  target: { key: 'target', header: 'Class / Method', width: 30 },
  title: { key: 'title', header: 'Test case', width: 40 },
  preconditions: { key: 'preconditions', header: 'Preconditions and data', width: 40 },
  soql: { key: 'soql', header: 'SOQL query', width: 55 },
  steps: { key: 'steps', header: 'Steps', width: 60 },
  expected: { key: 'expected', header: 'Expected result', width: 40 },
  actual: { key: 'actual', header: 'Actual result', width: 24 },
  comment: { key: 'comment', header: 'Comment', width: 24 },
  status: { key: 'status', header: 'Status', width: 10 },
};

/**
 * The technical notebook has no SOQL query nor steps, a unit test building its own data, and
 * carries the class and method under test instead. The maintenance one has no module nor priority.
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
  maintenance: [
    COL.id, COL.title, COL.preconditions, COL.soql, COL.steps, COL.expected, COL.actual, COL.comment,
    COL.status,
  ],
};

export const SHEET_NAMES: Record<TestCaseKind, string> = {
  functional: 'Functional',
  technical: 'Technical',
  maintenance: 'Maintenance',
};

/** Fold a value onto one line with the separator its destination reads back (`<br>` or `\n`). */
function _oneLine(value: unknown, separator: string): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(separator);
}

function _valueFor(key: string, testCase: NormalizedTestCase, separator: string): string {
  if (key === 'priority') {
    return testCase.priority ? `P${testCase.priority}` : '';
  }
  if (key === 'steps') {
    return renderStepsFlat(testCase.steps, separator);
  }
  return _oneLine((testCase as any)[key], separator);
}

/** One row per module plus a TOTAL, counting the cases by priority. */
export function summaryRows(cases: NormalizedTestCase[]): Array<Array<string | number>> {
  const byModule = new Map<string, number[]>();
  for (const testCase of cases) {
    const key = testCase.module || '(no module)';
    const counts = byModule.get(key) ?? [0, 0, 0, 0];
    counts[0]++;
    if (testCase.priority) {
      counts[testCase.priority]++;
    }
    byModule.set(key, counts);
  }
  const total = [0, 0, 0, 0];
  const rows: Array<Array<string | number>> = [];
  for (const [moduleName, counts] of byModule) {
    rows.push([moduleName, ...counts]);
    counts.forEach((count, i) => (total[i] += count));
  }
  rows.push(['TOTAL', ...total]);
  return rows;
}

const SUMMARY_HEADERS = ['Module', 'Tests', 'P1', 'P2', 'P3'];

function _styleHeader(worksheet: ExcelJS.Worksheet): void {
  const header = worksheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
  });
  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
}

async function _writeXlsx(outputPath: string, kind: TestCaseKind, cases: NormalizedTestCase[], withSummary: boolean): Promise<void> {
  const columns = COLUMNS[kind];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'sfdx-hardis';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(SHEET_NAMES[kind]);
  worksheet.columns = columns.map((column) => ({ header: column.header, key: column.key, width: column.width }));
  _styleHeader(worksheet);
  for (const testCase of cases) {
    const row = worksheet.addRow(columns.map((column) => _valueFor(column.key, testCase, '\n')));
    row.eachCell((cell) => {
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
  }
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  // The tester picks a status from a list instead of typing free text
  const statusColumn = columns.findIndex((column) => column.key === 'status') + 1;
  for (let rowNumber = 2; statusColumn > 0 && rowNumber <= cases.length + 1; rowNumber++) {
    worksheet.getCell(rowNumber, statusColumn).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${STATUS_VALUES.join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Invalid status',
      error: `Allowed values: ${STATUS_VALUES.join(', ')}`,
    };
  }

  if (withSummary) {
    const summary = workbook.addWorksheet(SUMMARY_SHEET_NAME);
    summary.columns = SUMMARY_HEADERS.map((header, i) => ({ header, key: header, width: i === 0 ? 34 : 8 }));
    _styleHeader(summary);
    summaryRows(cases).forEach((row) => summary.addRow(row));
    if (summary.lastRow) {
      summary.lastRow.font = { bold: true };
    }
  }
  await workbook.xlsx.writeFile(outputPath);
}

/**
 * `,` delimiter, as an English Excel expects, UTF-8 with a BOM so Excel reads the accents, CRLF
 * line endings, formula lead characters guarded, and a summary under a `SUMMARY` marker row
 * where the reader stops.
 */
async function _writeCsv(outputPath: string, kind: TestCaseKind, cases: NormalizedTestCase[], withSummary: boolean): Promise<void> {
  const columns = COLUMNS[kind];
  const width = columns.length;
  const pad = (fields: Array<string | number>): string[] => {
    const padded = fields.slice(0, width).map((field) => sanitizeCsvCell(field));
    while (padded.length < width) {
      padded.push('');
    }
    return padded;
  };
  const rows = [pad(columns.map((column) => column.header))];
  for (const testCase of cases) {
    rows.push(pad(columns.map((column) => _valueFor(column.key, testCase, STEP_SEPARATOR))));
  }
  if (withSummary) {
    rows.push(pad([]), pad([SUMMARY_MARKER]), pad(SUMMARY_HEADERS), ...summaryRows(cases).map(pad));
  }
  const content = Papa.unparse(rows, { delimiter: ',', newline: '\r\n' });
  await fs.writeFile(outputPath, '\ufeff' + content + '\r\n', 'utf8');
}

/** A markdown table, handy when the notebook is committed next to the code and read in a diff. */
async function _writeMarkdown(outputPath: string, kind: TestCaseKind, cases: NormalizedTestCase[]): Promise<void> {
  const columns = COLUMNS[kind];
  const cell = (value: string): string => value.replace(/\|/g, '\\|');
  const lines = [
    `| ${columns.map((column) => column.header).join(' | ')} |`,
    `|${columns.map(() => '---').join('|')}|`,
    ...cases.map((testCase) => `| ${columns.map((column) => cell(_valueFor(column.key, testCase, STEP_SEPARATOR))).join(' | ')} |`),
  ];
  await fs.writeFile(outputPath, lines.join('\n') + '\n', 'utf8');
}

/** Write a notebook in one format. The tester columns are written as the cases carry them. */
export async function writeNotebook(
  outputPath: string,
  format: NotebookFormat,
  kind: TestCaseKind,
  cases: NormalizedTestCase[],
  options: { withSummary?: boolean } = {}
): Promise<string> {
  const withSummary = options.withSummary !== false;
  await fs.ensureDir(path.dirname(path.resolve(outputPath)));
  if (format === 'xlsx') {
    await _writeXlsx(outputPath, kind, cases, withSummary);
  } else if (format === 'csv') {
    await _writeCsv(outputPath, kind, cases, withSummary);
  } else {
    await _writeMarkdown(outputPath, kind, cases);
  }
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

const KIND_ID_LETTER: Record<TestCaseKind, string> = { functional: 'F', technical: 'T', maintenance: '' };

/**
 * The empty cases of a blank notebook, identifiers pre-filled. Numbering runs across module
 * groups, so no two rows share an identifier.
 */
export function buildTemplateCases(options: TemplateOptions): NormalizedTestCase[] {
  const groups = options.modules && options.modules.length > 0 ? options.modules : [''];
  const letter = KIND_ID_LETTER[options.kind];
  const cases: NormalizedTestCase[] = [];
  for (const moduleName of groups) {
    for (let i = 0; i < Math.max(1, options.rows); i++) {
      cases.push({
        id: `${options.ticket}-${letter}${String(cases.length + 1).padStart(2, '0')}`,
        ticket: options.ticket,
        kind: options.kind,
        module: moduleName,
        title: '',
        expected: '',
      });
    }
  }
  return cases;
}
