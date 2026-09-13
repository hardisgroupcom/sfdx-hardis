/**
 * Test notebooks: the `NormalizedTestCase` contract, the checks run before a push, and the
 * readers turning a markdown, CSV, xlsx or JSON notebook into that contract.
 *
 * Writing a notebook lives in testNotebookRender.ts. Sending it to a tracker lives in
 * src/common/testManagementProvider.
 */

import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import path from 'path';
import { SfError } from '@salesforce/core';
import fs from './fsUtils.js';
import { t } from './i18n.js';

/* ------------------------------------------------------------------------------------------ */
/* Contract                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export interface TestCaseStep {
  action: string;
  /** Empty for a step that only performs an action. */
  expected: string;
}

export type TestCaseKind = 'functional' | 'technical' | 'maintenance';

export const TEST_CASE_KINDS: TestCaseKind[] = ['functional', 'technical', 'maintenance'];

/**
 * One test case, as read from a notebook or from a `--testsjsonfile` payload.
 *
 * An optional field left `undefined` means "this notebook has no such column": a provider
 * then leaves the matching tracker field untouched on update, instead of blanking it.
 */
export interface NormalizedTestCase {
  /** Full identifier, e.g. "PROJ-123-F01" */
  id: string;
  /** Carrier ticket, derived from the id or set with --ticket-number */
  ticket: string;
  /** Derived from the id suffix */
  kind: TestCaseKind;
  module?: string;
  priority?: 1 | 2 | 3;
  title: string;
  preconditions?: string;
  /** Apex class and method under test, carried by technical notebooks */
  target?: string;
  /** Helper query to find the test data. Never required. */
  soql?: string;
  steps?: TestCaseStep[];
  expected: string;
  /** Tester columns: kept when a filled notebook is converted, never sent to a tracker */
  actual?: string;
  comment?: string;
  status?: string;
}

/** Marker a generator writes in a cell it could not fill. A notebook still holding it is not pushed. */
export const TEST_CASE_TODO = 'TO BE COMPLETED';

// <TICKET>-F01 functional, <TICKET>-T01 technical, <TICKET>-01 maintenance. The counter has 2 or
// 3 digits, so a bare ticket key such as DSI-2026-14545 is not read as a test case id.
const ID_RE = /^(.+)-([FT]?)(\d{2,3})$/;
// No quote, space or query operator can reach a tracker query through an identifier.
const ID_CHARS_RE = /^[A-Za-z0-9_.#-]+$/;

/** A ticket key uses the characters of an identifier only, so it can never alter a tracker query. */
export function isValidTicketKey(ticket: unknown): boolean {
  return typeof ticket === 'string' && ID_CHARS_RE.test(ticket.trim());
}

/**
 * Split an identifier into its carrier ticket and its kind. Everything before the last segment
 * is the ticket, so a ticket key holding dashes (DSI-2026-14545-F01) works.
 */
export function deriveTicketAndKind(id: string): { ticket: string; kind: TestCaseKind } {
  const value = String(id ?? '').trim();
  const match = ID_RE.exec(value);
  if (!match || !ID_CHARS_RE.test(value)) {
    throw new SfError(t('testCasesUnreadableId', { id: JSON.stringify(id) }));
  }
  const [, ticket, letter] = match;
  const kind: TestCaseKind = letter === 'F' ? 'functional' : letter === 'T' ? 'technical' : 'maintenance';
  return { ticket, kind };
}

/**
 * `TESTKIT:<TICKET>:<SHORT ID>`, the ticket always being the one of the identifier. It never
 * depends on --ticket-number: a case pushed once with the flag and once without must match
 * the same tracker record.
 */
export function idempotencyKey(id: string): string {
  const { ticket } = deriveTicketAndKind(id);
  return `TESTKIT:${ticket}:${String(id).trim().slice(ticket.length + 1)}`;
}

/** `P1` / `1` -> 1. Empty stays undefined, anything else defaults to 2. */
export function normalizePriority(value: unknown): 1 | 2 | 3 | undefined {
  const text = String(value ?? '').trim();
  if (text === '') {
    return undefined;
  }
  const match = /^P?([123])$/i.exec(text);
  return match ? (Number(match[1]) as 1 | 2 | 3) : 2;
}

/** Collapse the helper query to a single line and drop a trailing semicolon. */
export function normalizeSoql(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim()
    .replace(/;\s*$/, '')
    .trim();
}

/* ------------------------------------------------------------------------------------------ */
/* Checks before a push                                                                        */
/* ------------------------------------------------------------------------------------------ */

/** Literals a generator may have written instead of leaving a cell empty. */
const FORBIDDEN_LITERALS = new Set(['null', 'none', 'undefined', 'nan', 'n/a']);
/** `{SCENARIO_TITLE}` or `{{SCENARIO_TITLE}}` anywhere in a cell. */
const PLACEHOLDER_RE = /\{\{?\s*[A-Z][A-Z0-9_]*\s*\}?\}/;

function _cellProblems(where: string, value: unknown, required: boolean): string[] {
  const text = String(value ?? '').trim();
  if (text === '') {
    return required ? [t('testCasesCheckEmpty', { where })] : [];
  }
  const problems: string[] = [];
  if (FORBIDDEN_LITERALS.has(text.toLowerCase())) {
    problems.push(t('testCasesCheckForbiddenLiteral', { where, value: text }));
  }
  const placeholder = PLACEHOLDER_RE.exec(text);
  if (placeholder) {
    problems.push(t('testCasesCheckPlaceholder', { where, value: placeholder[0] }));
  }
  if (text.includes(TEST_CASE_TODO)) {
    problems.push(t('testCasesCheckTodoMarker', { where, marker: TEST_CASE_TODO }));
  }
  return problems;
}

/**
 * Refuse the whole upsert when any case is not finished, listing every problem of every case at
 * once, so a notebook is fixed in one pass. Nothing partial is written.
 */
export function assertPushable(cases: NormalizedTestCase[]): void {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const duplicatedIds = new Set<string>();
  for (const testCase of cases) {
    const id = String(testCase.id ?? '').trim();
    if (seenIds.has(id)) {
      duplicatedIds.add(id);
    }
    seenIds.add(id);
  }
  if (duplicatedIds.size > 0) {
    problems.push(t('testCasesCheckDuplicatedIds', { ids: [...duplicatedIds].join(', ') }));
  }

  for (const testCase of cases) {
    const id = testCase.id;
    problems.push(
      ..._cellProblems(`${id} title`, testCase.title, true),
      ..._cellProblems(`${id} expected`, testCase.expected, true),
      ..._cellProblems(`${id} module`, testCase.module, false),
      ..._cellProblems(`${id} preconditions`, testCase.preconditions, false),
      ..._cellProblems(`${id} target`, testCase.target, false),
      ..._cellProblems(`${id} soql`, testCase.soql, false)
    );
    (testCase.steps || []).forEach((step, i) => {
      problems.push(
        ..._cellProblems(`${id} step ${i + 1} action`, step.action, true),
        ..._cellProblems(`${id} step ${i + 1} expected`, step.expected, false)
      );
    });
  }
  if (problems.length > 0) {
    throw new SfError(t('testCasesUpsertRefused', { count: problems.length }) + '\n  ' + problems.join('\n  '));
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Cells                                                                                       */
/* ------------------------------------------------------------------------------------------ */

/** A formula lead character, possibly behind apostrophes a previous guard added. */
const GUARDED_START_RE = /^'*[=+\-@\t\r]/;

/**
 * Neutralize a CSV field a spreadsheet would run as a formula when the file is opened, by
 * prefixing an apostrophe. Only the CSV needs it: an xlsx cell written as text is never run.
 */
export function sanitizeCsvCell(value: unknown): string {
  const text = String(value ?? '');
  return GUARDED_START_RE.test(text) ? `'${text}` : text;
}

/** Reverse of `sanitizeCsvCell`, applied when a CSV notebook is read back. */
export function unsanitizeCsvCell(value: unknown): string {
  const text = String(value ?? '');
  return text.startsWith("'") && GUARDED_START_RE.test(text.slice(1)) ? text.slice(1) : text;
}

/** Separator of steps inside a CSV field or a markdown cell, which must stay on one line. */
export const STEP_SEPARATOR = '<br>';
/** Separator written between the action and the expected result of a step. */
const PAIR_SEPARATOR = ' → ';
/** First `→` or `->` standing on its own: what splits an action from its expected result. */
const PAIR_SEPARATOR_RE = /(?:^|\s)(?:→|->)(?:\s|$)/;

/**
 * Split a steps cell into `{ action, expected }` pairs.
 *
 * - `<br>` or a line break separates steps, and a `1. ` / `2) ` numbering is dropped.
 * - The first `→` or `->` surrounded by spaces splits the action from the expected result, so
 *   the expected result may hold an arrow. The text itself is never rewritten.
 * - A step with no arrow is an action with no expected result.
 */
export function parseSteps(raw: unknown): TestCaseStep[] {
  if (!raw) {
    return [];
  }
  return String(raw)
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s*\d+[.)]\s+/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const match = PAIR_SEPARATOR_RE.exec(line);
      if (!match) {
        return { action: line, expected: '' };
      }
      return {
        action: line.slice(0, match.index).trim(),
        expected: line.slice(match.index + match[0].length).trim(),
      };
    });
}

/**
 * Render steps into one numbered cell, read back by `parseSteps`. `separator` is `<br>` for a
 * CSV field or a markdown cell, `\n` for an xlsx cell.
 */
export function renderStepsFlat(steps: TestCaseStep[] | undefined, separator: string = STEP_SEPARATOR): string {
  if (!Array.isArray(steps) || steps.length === 0) {
    return '';
  }
  const oneLine = (value: unknown): string =>
    String(value ?? '')
      .replace(/\s*[\r\n]+\s*/g, ' ')
      .trim();
  return steps
    .map((step, i) => {
      const expected = oneLine(step.expected);
      // An arrow inside the action would be read back as the separator: it is written `=>`
      const action = oneLine(step.action).replace(/(^|\s)(?:→|->)(?=\s|$)/g, '$1=>');
      return `${i + 1}. ${action}${expected ? PAIR_SEPARATOR + expected : ''}`;
    })
    .join(separator);
}

/* ------------------------------------------------------------------------------------------ */
/* Readers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** Summary rows written under the cases of a CSV notebook start with this marker. */
export const SUMMARY_MARKER = 'SUMMARY';

/**
 * Header spellings a notebook may carry, compared lower case and without accents. The French
 * ones keep notebooks written before the English headers readable.
 */
const HEADER_ALIASES: Map<string, string> = new Map([
  ['id', 'id'],
  ['module', 'module'],
  ['priority', 'priority'],
  ['priorite', 'priority'],
  ['test case', 'title'],
  ['title', 'title'],
  ['cas de test', 'title'],
  ['titre', 'title'],
  ['class / method', 'target'],
  ['class', 'target'],
  ['target', 'target'],
  ['classe / methode', 'target'],
  ['preconditions and data', 'preconditions'],
  ['preconditions', 'preconditions'],
  ['prerequisites', 'preconditions'],
  ['prerequis et donnees', 'preconditions'],
  ['soql query', 'soql'],
  ['soql', 'soql'],
  ['requete soql', 'soql'],
  ['steps', 'steps'],
  ['etapes', 'steps'],
  ['expected result', 'expected'],
  ['expected', 'expected'],
  ['resultat attendu', 'expected'],
  ['actual result', 'actual'],
  ['actual', 'actual'],
  ['resultat obtenu', 'actual'],
  ['comment', 'comment'],
  ['comments', 'comment'],
  ['commentaire', 'comment'],
  ['status', 'status'],
  ['statut', 'status'],
]);

function _normalizeHeader(header: unknown): string {
  const lookup = String(header ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return HEADER_ALIASES.get(lookup) ?? lookup;
}

/** Turn the `<br>` of a one-line cell back into a line break, or fold everything onto one line. */
function _decodeBreaks(value: string, replacement: '\n' | ' '): string {
  const pattern = replacement === '\n' ? /[ \t]*<br\s*\/?>[ \t]*/gi : /\s*(?:<br\s*\/?>|\r?\n)\s*/gi;
  return value.replace(pattern, replacement).trim();
}

/**
 * Turn one row into a test case. `where` locates the row as the author sees it ("line 12",
 * "sheet Functional row 4"), so an error points at something they can fix.
 *
 * A column the notebook does not have leaves the field `undefined`.
 */
function _rowToCase(keys: string[], row: string[], where: string, ticketOverride?: string): NormalizedTestCase {
  const rec: Record<string, string> = {};
  keys.forEach((key, i) => {
    if (key && rec[key] === undefined) {
      rec[key] = String(row[i] ?? '');
    }
  });
  const has = (key: string): boolean => rec[key] !== undefined;
  const text = (key: string): string | undefined => (has(key) ? _decodeBreaks(rec[key], '\n') : undefined);

  const id = (rec.id || '').trim();
  if (!id) {
    throw new SfError(t('testCasesEmptyIdCell', { where }));
  }
  let derived: { ticket: string; kind: TestCaseKind };
  try {
    derived = deriveTicketAndKind(id);
  } catch (e) {
    throw new SfError(`${where}: ${(e as Error).message}`);
  }
  return {
    id,
    ticket: ticketOverride || derived.ticket,
    kind: derived.kind,
    module: text('module'),
    priority: has('priority') ? normalizePriority(rec.priority) : undefined,
    title: _decodeBreaks(rec.title ?? '', ' '),
    target: text('target'),
    preconditions: text('preconditions'),
    soql: has('soql') ? normalizeSoql(text('soql')) : undefined,
    steps: has('steps') ? parseSteps(rec.steps) : undefined,
    expected: text('expected') ?? '',
    actual: text('actual'),
    comment: text('comment'),
    status: text('status'),
  };
}

const TABLE_ROW_RE = /^\s*\|(.*)\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function _splitMarkdownRow(line: string): string[] {
  const inner = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
  return inner
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').replace(/\s*<!--[\s\S]*?-->\s*/g, ' ').trim());
}

/**
 * Read every markdown table holding an `ID` column, so a notebook split into one table per
 * module is read whole. A row whose cell count differs from its header (an unescaped `|`) is
 * refused rather than read with shifted columns.
 */
export function parseNotebookMarkdown(content: string, ticketOverride?: string): NormalizedTestCase[] {
  const lines = String(content).split(/\r?\n/);
  const cases: NormalizedTestCase[] = [];
  let foundTable = false;
  for (let i = 0; i < lines.length; i++) {
    if (!TABLE_ROW_RE.test(lines[i])) {
      continue;
    }
    const keys = _splitMarkdownRow(lines[i]).map(_normalizeHeader);
    let j = i + 1;
    if (!keys.includes('id')) {
      // Skip the rest of a table that is not a test case table
      while (j < lines.length && TABLE_ROW_RE.test(lines[j])) {
        j++;
      }
      i = j - 1;
      continue;
    }
    foundTable = true;
    if (j < lines.length && TABLE_SEPARATOR_RE.test(lines[j])) {
      j++;
    }
    for (; j < lines.length && TABLE_ROW_RE.test(lines[j]); j++) {
      const cells = _splitMarkdownRow(lines[j]);
      const where = t('testCasesWhereLine', { line: j + 1 });
      if (cells.length !== keys.length) {
        throw new SfError(t('testCasesMarkdownCellCount', { where, count: cells.length, expected: keys.length }));
      }
      if (cells.every((cell) => cell === '')) {
        continue;
      }
      cases.push(_rowToCase(keys, cells, where, ticketOverride));
    }
    i = j - 1;
  }
  if (!foundTable) {
    throw new SfError(t('testCasesNoMarkdownTable'));
  }
  return cases;
}

/**
 * Read a CSV notebook. The delimiter is detected (`,` from an English Excel, `;` from a French
 * one), and a quote left open is refused instead of swallowing the rows after it.
 */
export function parseNotebookCsv(content: string, ticketOverride?: string): NormalizedTestCase[] {
  const parsed = Papa.parse<string[]>(String(content).replace(/^\ufeff/, ''), {
    delimiter: '',
    delimitersToGuess: [',', ';', '\t'],
    skipEmptyLines: false,
  });
  const quoteError = parsed.errors.find((error) => error.type === 'Quotes');
  if (quoteError) {
    throw new SfError(
      t('testCasesCsvQuoteError', { where: t('testCasesWhereRow', { row: (quoteError.row ?? 0) + 1 }), message: quoteError.message })
    );
  }
  const records = parsed.data;
  if (records.length === 0 || records[0].every((field) => String(field).trim() === '')) {
    throw new SfError(t('testCasesCsvEmpty'));
  }
  const keys = records[0].map(_normalizeHeader);
  if (!keys.includes('id')) {
    throw new SfError(t('testCasesCsvNoIdColumn'));
  }
  const cases: NormalizedTestCase[] = [];
  for (let i = 1; i < records.length; i++) {
    const row = records[i].map((field) => unsanitizeCsvCell(String(field ?? '').replace(/\r\n?/g, '\n').trim()));
    if (row.every((field) => field === '')) {
      continue;
    }
    if (row[0] === SUMMARY_MARKER) {
      break;
    }
    cases.push(_rowToCase(keys, row, t('testCasesWhereRow', { row: i + 1 }), ticketOverride));
  }
  return cases;
}

/**
 * Flatten one ExcelJS cell value into text. A bold word makes a cell `richText`, a link makes it
 * `hyperlink` (whose text may itself be rich text), a formula makes it `formula` with a cached
 * `result` that may be an error.
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
    return _xlsxCellToText(value.text);
  }
  if (value.formula !== undefined || value.sharedFormula !== undefined) {
    return _xlsxCellToText(value.result);
  }
  // A formula error such as #N/A, or a shape ExcelJS may add later: never "[object Object]"
  return '';
}

/**
 * Read every worksheet whose first row holds an `ID` column, so a workbook with one sheet per
 * module is read whole. Sheets without one (the summary) are skipped.
 */
export async function parseNotebookXlsx(filePath: string, ticketOverride?: string): Promise<NormalizedTestCase[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const cases: NormalizedTestCase[] = [];
  let foundSheet = false;
  for (const worksheet of workbook.worksheets) {
    const keys: string[] = [];
    worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      keys[colNumber - 1] = _normalizeHeader(_xlsxCellToText(cell.value));
    });
    if (!keys.includes('id')) {
      continue;
    }
    foundSheet = true;
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const values: string[] = [];
      for (let col = 1; col <= keys.length; col++) {
        values[col - 1] = _xlsxCellToText(row.getCell(col).value);
      }
      // Excel keeps formatted but empty trailing rows
      if (values.every((value) => value.trim() === '')) {
        continue;
      }
      const where = t('testCasesWhereSheetRow', { sheet: worksheet.name, row: rowNumber });
      cases.push(_rowToCase(keys, values, where, ticketOverride));
    }
  }
  if (!foundSheet) {
    throw new SfError(
      t('testCasesXlsxNoIdSheet', { file: filePath, sheets: workbook.worksheets.map((ws) => ws.name).join(', ') || '-' })
    );
  }
  return cases;
}

/**
 * Validate a JSON payload against the contract and fill what the id derives. Every problem of an
 * entry is reported at once, with its index and field.
 */
export function validateNormalizedCases(payload: unknown, ticketOverride?: string): NormalizedTestCase[] {
  if (!Array.isArray(payload)) {
    throw new SfError(t('testCasesJsonNotArray'));
  }
  payload.forEach((item: any, index: number) => {
    const problems: string[] = [];
    for (const field of ['id', 'title', 'expected']) {
      if (typeof item?.[field] !== 'string' || item[field].trim() === '') {
        problems.push(`"${field}" must be a non empty string`);
      }
    }
    if (item?.steps !== undefined) {
      if (!Array.isArray(item.steps)) {
        problems.push('"steps" must be an array of { action, expected } objects');
      } else {
        item.steps.forEach((step: any, stepIndex: number) => {
          if (typeof step?.action !== 'string' || (step?.expected !== undefined && typeof step.expected !== 'string')) {
            problems.push(`steps[${stepIndex}] must hold "action" and "expected" as strings`);
          }
        });
      }
    }
    if (item?.priority !== undefined && ![1, 2, 3].includes(item.priority)) {
      problems.push('"priority" must be 1, 2 or 3');
    }
    if (item?.kind !== undefined && ![...TEST_CASE_KINDS, 'tma'].includes(item.kind)) {
      problems.push(`"kind" must be ${TEST_CASE_KINDS.join(', ')}`);
    }
    if (typeof item?.id === 'string' && item.id.trim() !== '') {
      try {
        const derivedKind = deriveTicketAndKind(item.id).kind;
        // The kind comes from the id: a different "kind" means the id or the payload is wrong
        if (item?.kind !== undefined && (item.kind === 'tma' ? 'maintenance' : item.kind) !== derivedKind) {
          problems.push(`"kind" ${item.kind} does not match the id suffix (${derivedKind})`);
        }
      } catch (e) {
        problems.push((e as Error).message);
      }
    }
    if (item?.ticket !== undefined && !isValidTicketKey(item.ticket)) {
      problems.push(t('testCasesInvalidTicket', { ticket: JSON.stringify(item.ticket) }));
    }
    if (problems.length > 0) {
      throw new SfError(t('testCasesJsonInvalidEntry', { index, problems: problems.join('; ') }));
    }
  });
  return payload.map((item: any) => {
    const derived = deriveTicketAndKind(item.id);
    return {
      ...item,
      id: item.id.trim(),
      ticket: ticketOverride || item.ticket || derived.ticket,
      kind: derived.kind,
      steps: item.steps?.map((step: any) => ({ action: step.action, expected: step.expected ?? '' })),
      soql: item.soql === undefined ? undefined : normalizeSoql(item.soql),
    } as NormalizedTestCase;
  });
}

/** Read a JSON test cases file, tolerating the BOM some editors write. */
async function _readJsonFile(filePath: string): Promise<unknown> {
  const content = (await fs.readFile(filePath, 'utf8')).replace(/^\ufeff/, '');
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new SfError(t('testCasesJsonUnreadable', { file: filePath, message: (e as Error).message }));
  }
}

/**
 * Read a notebook and normalize it. The format comes from the extension, never from the content.
 * `ticketOverride` sets the carrier ticket of every case, whatever the format.
 */
export async function parseNotebookFile(filePath: string, ticketOverride?: string): Promise<NormalizedTestCase[]> {
  if (!(await fs.pathExists(filePath))) {
    throw new SfError(t('testCasesFileNotFound', { file: filePath }));
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
    return validateNormalizedCases(await _readJsonFile(filePath), ticketOverride);
  }
  throw new SfError(t('testCasesUnsupportedExtension', { extension: extension || '-', file: filePath }));
}

/** Exactly one of --notebook / --testsjsonfile, with the optional --ticket-number. */
export async function resolveNotebookInput(flags: any): Promise<NormalizedTestCase[]> {
  if (flags.notebook && flags.testsjsonfile) {
    throw new SfError(t('testCasesOneInputOnly'));
  }
  const file = flags.notebook || flags.testsjsonfile;
  if (!file) {
    throw new SfError(t('testCasesInputRequired'));
  }
  const ticketOverride = flags['ticket-number']?.trim() || undefined;
  if (ticketOverride && !isValidTicketKey(ticketOverride)) {
    throw new SfError(t('testCasesInvalidTicket', { ticket: JSON.stringify(ticketOverride) }));
  }
  if (flags.testsjsonfile) {
    if (!(await fs.pathExists(file))) {
      throw new SfError(t('testCasesFileNotFound', { file }));
    }
    return validateNormalizedCases(await _readJsonFile(file), ticketOverride);
  }
  return parseNotebookFile(file, ticketOverride);
}
