/**
 * Read a test notebook (markdown, xlsx, csv or pre-normalized json) into the
 * `NormalizedTestCase[]` public contract, and render steps back to a flat one-line cell.
 *
 * Ported from the cloudity-test-notebook skill, where the same parsing already ran in
 * production. The notebook is the only structured source: the xlsx cells and the CSV fields
 * are one-way renders, so there is no flat to structured direction to support anywhere
 * except the xlsx a tester fills in, which keeps the very columns this module writes.
 */

import ExcelJS from 'exceljs';
import path from 'path';
import fs from './fsUtils.js';
import {
  deriveTicketAndKind,
  normalizePriority,
  normalizeSoql,
  NormalizedTestCase,
  TestCaseKind,
  TestCaseStep,
  TEST_CASE_TODO,
} from './testNotebookTypes.js';

const TABLE_ROW_RE = /^\s*\|(.*)\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Step separator of a CSV field: keeps the cell on one physical line. */
export const STEP_SEPARATOR = '<br>';
const PAIR_SEPARATOR = ' → ';
const LITERAL_ARROW = '->';
// A control character sentinel, so it can never collide with real notebook content the way
// any readable placeholder eventually would.
const ARROW_SENTINEL = '\u0000';

/**
 * Header spellings a notebook may carry, accented or not, French or English. A tester who
 * renames a column to its English label must still be able to push.
 */
export const HEADER_ALIASES: Map<string, string> = new Map([
  ['id', 'id'],
  ['module', 'module'],
  ['priorité', 'priority'],
  ['priorite', 'priority'],
  ['priority', 'priority'],
  ['cas de test', 'title'],
  ['test case', 'title'],
  ['titre', 'title'],
  ['title', 'title'],
  ['classe / méthode', 'target'],
  ['classe / methode', 'target'],
  ['prérequis et données', 'preconditions'],
  ['prerequis et donnees', 'preconditions'],
  ['preconditions', 'preconditions'],
  ['requête soql', 'soql'],
  ['requete soql', 'soql'],
  ['soql query', 'soql'],
  ['soql', 'soql'],
  ['étapes', 'steps'],
  ['etapes', 'steps'],
  ['steps', 'steps'],
  ['résultat attendu', 'expected'],
  ['resultat attendu', 'expected'],
  ['expected result', 'expected'],
  ['résultat obtenu', 'actual'],
  ['resultat obtenu', 'actual'],
  ['commentaire', 'comment'],
  ['statut', 'status'],
]);

function _normalizeHeader(header: unknown): string {
  if (header === null || header === undefined || header === '') {
    return '';
  }
  const lookup = String(header).toLowerCase().trim();
  return HEADER_ALIASES.get(lookup) ?? lookup;
}

function _splitRow(line: string): string[] {
  const inner = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function _mdCellToText(cell: string): string {
  return cell.replace(HTML_COMMENT_RE, '').trim();
}

/**
 * Split a canonical `Étapes` cell into `{ action, expected }` pairs.
 *
 * Rules, all four ported as is:
 *  1. `<br>` separates steps; the decorative `1. ` / `2. ` head is dropped.
 *  2. ` → ` splits action from expected, on the FIRST occurrence only, so an expected text
 *     may itself contain an arrow.
 *  3. An action needing a literal arrow writes `->`, restored afterwards.
 *  4. A step with no arrow keeps its action and gets the completion marker as expected,
 *     never an empty expected.
 */
export function parseSteps(raw: unknown): TestCaseStep[] {
  if (!raw) {
    return [];
  }
  const normalized = String(raw).replace(/<br\s*\/?>/gi, '\n');
  return normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^\s*\d+[.)]\s*/, '')
        .replace(/^\s*[-*]\s*/, '')
        .trim()
    )
    .filter(Boolean)
    .map((line) => {
      const guarded = line.split(LITERAL_ARROW).join(ARROW_SENTINEL);
      const index = guarded.indexOf(PAIR_SEPARATOR);
      const restore = (value: string): string => value.split(ARROW_SENTINEL).join(PAIR_SEPARATOR.trim()).trim();
      if (index === -1) {
        return { action: restore(guarded), expected: TEST_CASE_TODO };
      }
      return {
        action: restore(guarded.slice(0, index)),
        expected: restore(guarded.slice(index + PAIR_SEPARATOR.length)) || TEST_CASE_TODO,
      };
    });
}

/**
 * Render steps into one numbered cell.
 *
 * `separator` decides what the cell can be read back from, and each caller has a different
 * constraint:
 *  - `' | '` (default) for a markdown table cell, which must stay on a single line;
 *  - `'\n'` for an xlsx cell, where a real line break is what a tester wants to see and what
 *    `parseSteps` reads back;
 *  - `STEP_SEPARATOR` (`<br>`) for a CSV field, which must stay on one physical line because
 *    the CSV reader splits on newlines before it looks at quotes.
 *
 * The last two are the ones that make the round trip work: a workbook produced by `:render`
 * has to be readable by `:push` after a tester has filled in the result columns.
 *
 * A literal pipe becomes `/`: a cosmetic loss, needed only for the markdown form, harmless in
 * the other two.
 */
export function renderStepsFlat(steps: TestCaseStep[], separator: string = ' | '): string {
  if (!Array.isArray(steps) || steps.length === 0) {
    return '';
  }
  const clean = (value: unknown): string =>
    String(value ?? '')
      .replace(/\|/g, '/')
      .replace(/\s*[\r\n]+\s*/g, ' ')
      .trim();
  return steps
    .map((step, i) => `${i + 1}. ${clean(step.action)}${PAIR_SEPARATOR}${clean(step.expected)}`)
    .join(separator);
}

/**
 * Turn one row of normalized header keys plus raw cells into a test case. Shared by the
 * markdown, CSV and xlsx readers so the id validation, the ticket and kind derivation and
 * the default values exist exactly once.
 *
 * `rowNumber` is the 1 based row number as a human counts it in their file, so an error
 * message points at the line they can actually go and fix.
 */
function _rowToCase(keys: string[], row: string[], rowNumber: number, ticketOverride?: string): NormalizedTestCase {
  const rec: Record<string, string> = {};
  keys.forEach((key, i) => {
    if (key) {
      rec[key] = row[i] === undefined ? '' : row[i];
    }
  });
  const id = (rec.id || '').trim();
  if (!id) {
    throw new Error(`Empty ID cell on notebook row ${rowNumber}. Every test case needs an identifier.`);
  }
  // Fails loudly, naming the offending cell and its row, rather than guessing a kind.
  let derived: { ticket: string; kind: TestCaseKind };
  try {
    derived = deriveTicketAndKind(id);
  } catch (e) {
    throw new Error(`Notebook row ${rowNumber}: ${(e as Error).message}`);
  }
  return {
    id,
    ticket: ticketOverride || derived.ticket,
    kind: derived.kind,
    module: rec.module || '',
    priority: normalizePriority(rec.priority),
    title: rec.title || '',
    target: rec.target || '',
    preconditions: rec.preconditions || '',
    soql: normalizeSoql(rec.soql),
    steps: parseSteps(rec.steps),
    expected: rec.expected || '',
  };
}

/**
 * Locate the first markdown table holding an `ID` column, anywhere in the document.
 *
 * The skill used to receive the H2 heading to look under, because the model knew which
 * section it had just written. A CLI command cannot know it, so the rule becomes the only
 * one a human can guess without reading any documentation: the first table that looks like
 * a test case table wins.
 */
function _findTestCaseTable(lines: string[]): { headers: string[]; rows: string[][] } {
  for (let i = 0; i < lines.length; i++) {
    if (!TABLE_ROW_RE.test(lines[i])) {
      continue;
    }
    const headers = _splitRow(lines[i]).map(_mdCellToText);
    const keys = headers.map(_normalizeHeader);
    if (!keys.includes('id')) {
      continue;
    }
    let j = i + 1;
    if (j < lines.length && TABLE_SEPARATOR_RE.test(lines[j])) {
      j++;
    }
    const rows: string[][] = [];
    for (; j < lines.length; j++) {
      if (!lines[j].trim() || /^#{1,6}\s/.test(lines[j]) || !TABLE_ROW_RE.test(lines[j])) {
        break;
      }
      rows.push(_splitRow(lines[j]).map(_mdCellToText));
    }
    return { headers, rows };
  }
  throw new Error(
    'No test case table found in the markdown notebook. Expected a table holding at least an ' +
      '"ID" column (aliases: ID). Run "sf hardis:project:test-cases:template" to get a valid one.'
  );
}

export function parseNotebookMarkdown(content: string, ticketOverride?: string): NormalizedTestCase[] {
  const lines = String(content).split(/\r?\n/);
  const table = _findTestCaseTable(lines);
  const keys = table.headers.map(_normalizeHeader);
  return table.rows.map((row, rowIndex) => _rowToCase(keys, row, rowIndex + 1, ticketOverride));
}

const CSV_DELIMITER = ';';
// The renderer writes a SYNTHÈSE block under the cases; parsing must stop there rather than
// turning the summary rows into malformed test cases.
export const CSV_FOOTER_MARKER = 'SYNTHÈSE';

/**
 * Split one CSV line on `;`, honoring RFC 4180 double quotes (a quoted field may hold the
 * delimiter, and `""` is an escaped quote).
 */
function _splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === CSV_DELIMITER && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

export function parseNotebookCsv(content: string, ticketOverride?: string): NormalizedTestCase[] {
  // Strip the UTF-8 BOM the renderer writes so Excel opens accents on a double click.
  const lines = String(content).replace(/^\ufeff/, '').split(/\r?\n/);
  if (lines.length === 0 || !lines[0].trim()) {
    throw new Error('Empty CSV notebook: the first line must hold the column headers.');
  }
  const keys = _splitCsvLine(lines[0]).map(_normalizeHeader);
  if (!keys.includes('id')) {
    throw new Error('CSV notebook has no "ID" column. Its first line must be the header row.');
  }
  const cases: NormalizedTestCase[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.split(CSV_DELIMITER).join('').trim() === '') {
      continue;
    }
    const row = _splitCsvLine(raw);
    if ((row[0] || '').startsWith(CSV_FOOTER_MARKER)) {
      break;
    }
    cases.push(_rowToCase(keys, row, i, ticketOverride));
  }
  return cases;
}

/**
 * Validate a `--testsjsonfile` payload against the public contract. The message names the
 * array index and the field, so a pipeline author can fix their generator without reading
 * this source.
 */
export function validateNormalizedCases(payload: unknown): NormalizedTestCase[] {
  if (!Array.isArray(payload)) {
    throw new Error('Test cases JSON must be an array of NormalizedTestCase objects.');
  }
  payload.forEach((item: any, index: number) => {
    // Every problem of one entry is reported at once: a generator that got the shape wrong
    // usually got it wrong in more than one field, and fixing them one round trip at a time
    // is the slowest possible way to learn the contract.
    const problems: string[] = [];
    for (const field of ['id', 'title', 'expected']) {
      if (typeof item?.[field] !== 'string' || item[field].trim() === '') {
        problems.push(`"${field}" is required and must be a non empty string`);
      }
    }
    if (!Array.isArray(item?.steps)) {
      problems.push('"steps" must be an array of { action, expected } objects');
    } else {
      item.steps.forEach((step: any, stepIndex: number) => {
        if (typeof step?.action !== 'string' || typeof step?.expected !== 'string') {
          problems.push(`steps[${stepIndex}] must hold both "action" and "expected" as strings`);
        }
      });
    }
    if (item?.priority !== undefined && ![1, 2, 3].includes(item.priority)) {
      problems.push('"priority" must be 1, 2 or 3');
    }
    if (item?.kind !== undefined && !['functional', 'technical', 'tma'].includes(item.kind)) {
      problems.push('"kind" must be functional, technical or tma');
    }
    if (problems.length > 0) {
      throw new Error(`Test cases JSON [${index}]: ${problems.join('; ')}.`);
    }
  });
  // Fill what the contract derives, so a hand written payload does not have to repeat it.
  return payload.map((item: any) => {
    const derived = deriveTicketAndKind(item.id);
    return {
      ...item,
      ticket: item.ticket || derived.ticket,
      kind: item.kind || derived.kind,
      priority: normalizePriority(item.priority),
      module: item.module || '',
      preconditions: item.preconditions || '',
      soql: normalizeSoql(item.soql),
    } as NormalizedTestCase;
  });
}

/**
 * Single entry point of the three commands: read a notebook and normalize it, whatever its
 * format. The format comes from the extension and is never sniffed from the content, so the
 * failure of a mistyped path is immediate and legible.
 */
export async function parseNotebookFile(filePath: string, ticketOverride?: string): Promise<NormalizedTestCase[]> {
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`Notebook file not found: ${filePath}`);
  }
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.md' || extension === '.markdown') {
    return parseNotebookMarkdown(await fs.readFile(filePath, 'utf8'), ticketOverride);
  }
  if (extension === '.csv') {
    return parseNotebookCsv(await fs.readFile(filePath, 'utf8'), ticketOverride);
  }
  if (extension === '.xlsx') {
    return parseNotebookXlsx(filePath, ticketOverride);
  }
  if (extension === '.json') {
    return validateNormalizedCases(JSON.parse(await fs.readFile(filePath, 'utf8')));
  }
  throw new Error(
    `Unsupported notebook extension ${extension || '(none)'} on ${filePath}. ` + 'Supported: .md, .xlsx, .csv, .json.'
  );
}

/**
 * Flatten one ExcelJS cell value into text.
 *
 * ExcelJS returns five different shapes depending on how the cell was authored, and a
 * notebook filled in by a human in Excel hits most of them: a bolded word makes the whole
 * cell `richText`, a pasted link makes it `hyperlink`, a formula makes it `formula` with a
 * cached `result`. Reading `String(cell.value)` would yield "[object Object]" on those.
 */
function _xlsxCellToText(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value.richText)) {
    return value.richText.map((part: any) => part?.text ?? '').join('');
  }
  if (value.text !== undefined) {
    return String(value.text);
  }
  if (value.result !== undefined) {
    return String(value.result);
  }
  if (value.error !== undefined) {
    return '';
  }
  return String(value);
}

/**
 * Read a workbook produced by `:render` or `:template`, or filled in by a tester in Excel.
 *
 * The sheet is picked by content and not by name: `:render` names it Fonctionnel / Technique
 * / TMA, but a tester who copies the sheet gets "Fonctionnel (2)" and must still be able to
 * push. The first sheet holding an ID column wins, mirroring the markdown rule.
 */
export async function parseNotebookXlsx(filePath: string, ticketOverride?: string): Promise<NormalizedTestCase[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheetNames: string[] = [];
  for (const worksheet of workbook.worksheets) {
    sheetNames.push(worksheet.name);
    const headerRow = worksheet.getRow(1);
    const keys: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      keys[colNumber - 1] = _normalizeHeader(_xlsxCellToText(cell.value));
    });
    if (!keys.includes('id')) {
      continue;
    }

    const cases: NormalizedTestCase[] = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const values: string[] = [];
      for (let col = 1; col <= keys.length; col++) {
        values[col - 1] = _xlsxCellToText(row.getCell(col).value);
      }
      // Excel keeps formatted but empty trailing rows: skip anything with no content at all.
      if (values.every((value) => value.trim() === '')) {
        continue;
      }
      const firstCell = values[keys.indexOf('id')] || '';
      if (firstCell.trim().startsWith(CSV_FOOTER_MARKER)) {
        break;
      }
      cases.push(_rowToCase(keys, values, rowNumber - 1, ticketOverride));
    }
    return cases;
  }

  throw new Error(
    `No worksheet holding an "ID" column found in ${filePath}. Sheets read: ${sheetNames.join(', ') || '(none)'}. ` +
      'The header row must be row 1.'
  );
}
