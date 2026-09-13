/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import ExcelJS from 'exceljs';
import fs from '../../../src/common/utils/fsUtils.js';
import os from 'os';
import path from 'path';
import {
  buildTemplateCases,
  COLUMNS,
  NotebookFormat,
  SHEET_NAMES,
  STATUS_VALUES,
  SUMMARY_SHEET_NAME,
  summaryRows,
  writeNotebook,
} from '../../../src/common/utils/testNotebookRender.js';
import { NormalizedTestCase, parseNotebookFile, SUMMARY_MARKER, TestCaseKind } from '../../../src/common/utils/testNotebookUtils.js';

const FORMATS: NotebookFormat[] = ['xlsx', 'csv', 'md'];
const KINDS: TestCaseKind[] = ['functional', 'technical', 'maintenance'];
const BOM = String.fromCharCode(0xfeff);

/** A case filled with every field its kind writes, tester columns included. */
function caseFor(kind: TestCaseKind, overrides: Partial<NormalizedTestCase> = {}): NormalizedTestCase {
  const base: NormalizedTestCase = {
    id: 'PROJ-123-F01',
    ticket: 'PROJ-123',
    kind,
    title: 'Create a quote',
    preconditions: 'An active account\nA linked contact',
    expected: 'The quote exists',
    actual: 'The quote exists',
    comment: 'Checked on the Sales app',
    status: 'Passed',
  };
  if (kind === 'functional') {
    Object.assign(base, {
      module: 'Sales',
      priority: 1,
      soql: 'SELECT Id FROM Account LIMIT 1',
      steps: [
        { action: 'Open the account', expected: 'The account page is shown' },
        { action: 'Click New quote', expected: '' },
      ],
    });
  } else if (kind === 'technical') {
    Object.assign(base, {
      id: 'PROJ-123-T01',
      module: 'Sales',
      priority: 2,
      target: 'QuoteService.create',
    });
  } else {
    Object.assign(base, {
      id: 'PROJ-123-01',
      soql: 'SELECT Id FROM AsyncApexJob',
      steps: [{ action: 'Run the purge batch', expected: 'Logs -> archived' }],
    });
  }
  return { ...base, ...overrides };
}

/** The fields a notebook of that kind carries, with the value read back is expected to hold. */
function expectedFieldsFor(kind: TestCaseKind): string[] {
  return COLUMNS[kind].map((column) => column.key);
}

describe('testNotebookRender', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-notebook-render-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  async function writeAndRead(
    format: NotebookFormat,
    kind: TestCaseKind,
    cases: NormalizedTestCase[],
    options: { withSummary?: boolean } = {}
  ): Promise<{ file: string; cases: NormalizedTestCase[] }> {
    const file = path.join(tmpDir, `${kind}-${Math.random().toString(36).slice(2)}.${format}`);
    const written = await writeNotebook(file, format, kind, cases, options);
    expect(written).to.equal(file);
    return { file, cases: await parseNotebookFile(file) };
  }

  describe('columns', () => {
    it('writes English headers, the tester columns last', () => {
      expect(COLUMNS.functional.map((column) => column.header)).to.deep.equal([
        'ID',
        'Module',
        'Priority',
        'Test case',
        'Preconditions and data',
        'SOQL query',
        'Steps',
        'Expected result',
        'Actual result',
        'Comment',
        'Status',
      ]);
      for (const kind of KINDS) {
        expect(COLUMNS[kind].slice(-3).map((column) => column.key)).to.deep.equal(['actual', 'comment', 'status']);
      }
    });

    it('carries the class under test instead of the query and the steps on a technical notebook', () => {
      const keys = COLUMNS.technical.map((column) => column.key);
      expect(keys).to.include('target');
      expect(keys).to.not.include('soql');
      expect(keys).to.not.include('steps');
    });

    it('has no module nor priority on a maintenance notebook', () => {
      const keys = COLUMNS.maintenance.map((column) => column.key);
      expect(keys).to.not.include('module');
      expect(keys).to.not.include('priority');
    });

    it('writes the English headers in every format', async () => {
      const csv = path.join(tmpDir, 'headers.csv');
      await writeNotebook(csv, 'csv', 'technical', [caseFor('technical')]);
      const headers = COLUMNS.technical.map((column) => column.header);
      expect((await fs.readFile(csv, 'utf8')).split('\r\n')[0]).to.equal(BOM + headers.join(','));

      const md = path.join(tmpDir, 'headers.md');
      await writeNotebook(md, 'md', 'technical', [caseFor('technical')]);
      expect((await fs.readFile(md, 'utf8')).split('\n')[0]).to.equal(`| ${headers.join(' | ')} |`);

      const xlsx = path.join(tmpDir, 'headers.xlsx');
      await writeNotebook(xlsx, 'xlsx', 'technical', [caseFor('technical')]);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(xlsx);
      const sheet = workbook.getWorksheet(SHEET_NAMES.technical);
      expect(sheet).to.not.be.undefined;
      const values = (sheet?.getRow(1).values as unknown[]).slice(1);
      expect(values).to.deep.equal(headers);
    });
  });

  describe('round trip', () => {
    for (const kind of KINDS) {
      for (const format of FORMATS) {
        it(`reads back a ${kind} ${format} notebook it just wrote`, async () => {
          const original = caseFor(kind);
          const second = caseFor(kind, {
            id: original.id.replace(/01$/, '02'),
            title: 'Delete a quote',
            status: 'Failed',
          });
          const { cases } = await writeAndRead(format, kind, [original, second]);
          expect(cases).to.have.lengthOf(2);
          const [reread] = cases;
          expect(reread.id).to.equal(original.id);
          expect(reread.ticket).to.equal('PROJ-123');
          expect(reread.kind).to.equal(kind);
          for (const key of expectedFieldsFor(kind)) {
            expect((reread as any)[key], `${format} ${kind} ${key}`).to.deep.equal((original as any)[key]);
          }
          // A column the kind does not write stays undefined, never blank
          for (const key of ['module', 'priority', 'target', 'soql', 'steps'].filter((k) => !expectedFieldsFor(kind).includes(k))) {
            expect((reread as any)[key], `${format} ${kind} ${key}`).to.be.undefined;
          }
          expect(cases[1].status).to.equal('Failed');
        });
      }
    }

    it('keeps the tester columns when a filled notebook is converted from one format to the others', async () => {
      const filled = [
        caseFor('functional', {
          actual: 'Quote created twice',
          comment: 'See ticket PROJ-200, "duplicate"',
          status: 'Failed',
        }),
        caseFor('functional', {
          id: 'PROJ-123-F02',
          actual: '',
          comment: '',
          status: 'Blocked',
        }),
      ];
      const fromXlsx = (await writeAndRead('xlsx', 'functional', filled)).cases;
      const fromCsv = (await writeAndRead('csv', 'functional', fromXlsx)).cases;
      const fromMd = (await writeAndRead('md', 'functional', fromCsv)).cases;
      const back = (await writeAndRead('xlsx', 'functional', fromMd)).cases;
      for (const cases of [fromXlsx, fromCsv, fromMd, back]) {
        expect(cases.map((testCase) => [testCase.actual, testCase.comment, testCase.status])).to.deep.equal([
          ['Quote created twice', 'See ticket PROJ-200, "duplicate"', 'Failed'],
          ['', '', 'Blocked'],
        ]);
      }
    });

    it('keeps pipes, semicolons and quotes in every format', async () => {
      const original = caseFor('functional', {
        expected: 'ISBLANK(Phone) || ISBLANK(Email); "Missing" shown',
        steps: [{ action: 'Pick A | B', expected: 'Both | shown' }],
      });
      for (const format of FORMATS) {
        const [reread] = (await writeAndRead(format, 'functional', [original])).cases;
        expect(reread.expected, format).to.equal(original.expected);
        expect(reread.steps, format).to.deep.equal(original.steps);
      }
    });

    it('reads a multi-line title back on one line', async () => {
      for (const format of FORMATS) {
        const [reread] = (await writeAndRead(format, 'functional', [caseFor('functional', { title: 'Create a quote\nfrom an account' })])).cases;
        expect(reread.title, format).to.equal('Create a quote from an account');
      }
    });
  });

  describe('csv', () => {
    it('uses a comma, a BOM and CRLF line endings', async () => {
      const file = path.join(tmpDir, 'notebook.csv');
      await writeNotebook(file, 'csv', 'functional', [caseFor('functional')]);
      const content = await fs.readFile(file, 'utf8');
      expect(content.charCodeAt(0)).to.equal(0xfeff);
      expect(content.endsWith('\r\n')).to.be.true;
      expect(content.replace(/\r\n/g, '')).to.not.contain('\n');
      expect(content.split('\r\n')[0].split(',')).to.have.lengthOf(COLUMNS.functional.length);
    });

    it('keeps a case on a single row whatever line breaks its fields hold', async () => {
      const file = path.join(tmpDir, 'multi.csv');
      await writeNotebook(
        file,
        'csv',
        'functional',
        [
          caseFor('functional', {
            expected: 'Line one\r\n  Line two  \nLine three',
          }),
        ],
        {
          withSummary: false,
        }
      );
      const lines = (await fs.readFile(file, 'utf8')).split('\r\n').filter(Boolean);
      expect(lines).to.have.lengthOf(2);
      const [reread] = await parseNotebookFile(file);
      expect(reread.expected).to.equal('Line one\nLine two\nLine three');
    });

    it('guards formula cells in the CSV only, and reads them back unguarded', async () => {
      const original = caseFor('functional', {
        title: '=1+1',
        expected: '-1 day',
        module: '@Sales',
      });
      const csv = path.join(tmpDir, 'guard.csv');
      await writeNotebook(csv, 'csv', 'functional', [original]);
      const content = await fs.readFile(csv, 'utf8');
      expect(content).to.contain("'=1+1");
      expect(content).to.contain("'-1 day");
      // The summary module name is guarded too
      expect(content.split('\r\n').some((line) => line.startsWith("'@Sales,1,"))).to.be.true;
      expect(content.split('\r\n').some((line) => /^[=+\-@]/.test(line))).to.be.false;

      const xlsx = path.join(tmpDir, 'guard.xlsx');
      await writeNotebook(xlsx, 'xlsx', 'functional', [original]);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(xlsx);
      const sheet = workbook.getWorksheet(SHEET_NAMES.functional);
      const column = (key: string) => COLUMNS.functional.findIndex((entry) => entry.key === key) + 1;
      expect(sheet?.getRow(2).getCell(column('expected')).value).to.equal('-1 day');
      expect(sheet?.getRow(2).getCell(column('title')).value).to.equal('=1+1');
      expect(workbook.getWorksheet(SUMMARY_SHEET_NAME)?.getRow(2).getCell(1).value).to.equal('@Sales');

      for (const file of [csv, xlsx]) {
        const [reread] = await parseNotebookFile(file);
        expect(reread.title).to.equal('=1+1');
        expect(reread.expected).to.equal('-1 day');
        expect(reread.module).to.equal('@Sales');
      }
    });
  });

  describe('summary', () => {
    const cases = [
      caseFor('functional', {
        id: 'PROJ-123-F01',
        module: 'Sales',
        priority: 1,
      }),
      caseFor('functional', {
        id: 'PROJ-123-F02',
        module: 'Billing',
        priority: 3,
      }),
      caseFor('functional', {
        id: 'PROJ-123-F03',
        module: 'Sales',
        priority: 2,
      }),
      caseFor('functional', {
        id: 'PROJ-123-F04',
        module: undefined,
        priority: undefined,
      }),
    ];

    it('counts the cases by module and by priority, with a total', () => {
      expect(summaryRows(cases)).to.deep.equal([
        ['Sales', 2, 1, 1, 0],
        ['Billing', 1, 0, 0, 1],
        ['(no module)', 1, 0, 0, 0],
        ['TOTAL', 4, 1, 1, 1],
      ]);
    });

    it('adds a summary sheet the reader skips', async () => {
      const { file, cases: reread } = await writeAndRead('xlsx', 'functional', cases);
      expect(reread).to.have.lengthOf(4);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file);
      const summary = workbook.getWorksheet(SUMMARY_SHEET_NAME);
      expect((summary?.getRow(1).values as unknown[]).slice(1)).to.deep.equal(['Module', 'Tests', 'P1', 'P2', 'P3']);
      expect((summary?.getRow(5).values as unknown[]).slice(1)).to.deep.equal(['TOTAL', 4, 1, 1, 1]);
      expect(summary?.getRow(5).font?.bold).to.be.true;
    });

    it('adds summary rows under a SUMMARY marker in the CSV, where the reader stops', async () => {
      const { file, cases: reread } = await writeAndRead('csv', 'functional', cases);
      expect(reread).to.have.lengthOf(4);
      const lines = (await fs.readFile(file, 'utf8')).split('\r\n');
      const marker = lines.findIndex((line) => line.startsWith(SUMMARY_MARKER));
      expect(marker).to.be.greaterThan(4);
      expect(lines[marker + 1].startsWith('Module,Tests,P1,P2,P3')).to.be.true;
      expect(lines.some((line) => line.startsWith('TOTAL,4,1,1,1'))).to.be.true;
    });

    it('writes no summary when asked not to', async () => {
      const csv = (await writeAndRead('csv', 'functional', cases, { withSummary: false })).file;
      expect(await fs.readFile(csv, 'utf8')).to.not.contain(SUMMARY_MARKER);
      const xlsx = (await writeAndRead('xlsx', 'functional', cases, { withSummary: false })).file;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(xlsx);
      expect(workbook.worksheets.map((sheet) => sheet.name)).to.deep.equal([SHEET_NAMES.functional]);
    });
  });

  describe('xlsx', () => {
    it('names the sheet after the kind, styles and freezes the header, and lists the status values', async () => {
      for (const kind of KINDS) {
        const file = path.join(tmpDir, `${kind}.xlsx`);
        await writeNotebook(file, 'xlsx', kind, [caseFor(kind)]);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(file);
        const sheet = workbook.worksheets[0];
        expect(sheet.name).to.equal(SHEET_NAMES[kind]);
        expect(sheet.getRow(1).font?.bold).to.be.true;
        expect((sheet.getRow(1).getCell(1).fill as any)?.fgColor?.argb).to.equal('FFD9D9D9');
        expect(sheet.views[0]).to.include({ state: 'frozen', ySplit: 1 });
        const statusColumn = COLUMNS[kind].findIndex((column) => column.key === 'status') + 1;
        const validation = sheet.getCell(2, statusColumn).dataValidation as any;
        expect(validation?.type).to.equal('list');
        expect(validation?.formulae?.[0]).to.equal(`"${STATUS_VALUES.join(',')}"`);
      }
    });

    it('keeps the line breaks of a cell, normalized', async () => {
      const { file } = await writeAndRead('xlsx', 'functional', [
        caseFor('functional', {
          expected: 'Line one\r\n  Line two  \nLine three',
        }),
      ]);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file);
      const column = COLUMNS.functional.findIndex((entry) => entry.key === 'expected') + 1;
      expect(workbook.getWorksheet(SHEET_NAMES.functional)?.getRow(2).getCell(column).value).to.equal('Line one\nLine two\nLine three');
    });

    it('keeps a custom width on the priority column', async () => {
      const file = path.join(tmpDir, 'width.xlsx');
      await writeNotebook(file, 'xlsx', 'functional', [caseFor('functional')]);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file);
      const column = COLUMNS.functional.findIndex((entry) => entry.key === 'priority') + 1;
      expect(workbook.worksheets[0].getColumn(column).width).to.equal(9.5);
    });
  });

  describe('markdown', () => {
    it('writes a single table with no summary', async () => {
      const file = path.join(tmpDir, 'notebook.md');
      await writeNotebook(file, 'md', 'functional', [caseFor('functional'), caseFor('functional', { id: 'PROJ-123-F02' })]);
      const lines = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean);
      expect(lines).to.have.lengthOf(4);
      expect(lines[1]).to.equal(`|${COLUMNS.functional.map(() => '---').join('|')}|`);
    });

    it('creates the output folder', async () => {
      const file = path.join(tmpDir, 'nested', 'folder', 'notebook.md');
      await writeNotebook(file, 'md', 'maintenance', [caseFor('maintenance')]);
      expect(await fs.pathExists(file)).to.be.true;
    });
  });

  describe('buildTemplateCases', () => {
    it('numbers the rows across module groups', () => {
      const cases = buildTemplateCases({
        kind: 'functional',
        ticket: 'PROJ-9',
        modules: ['Sales', 'Billing'],
        rows: 2,
      });
      expect(cases.map((testCase) => [testCase.id, testCase.module])).to.deep.equal([
        ['PROJ-9-F01', 'Sales'],
        ['PROJ-9-F02', 'Sales'],
        ['PROJ-9-F03', 'Billing'],
        ['PROJ-9-F04', 'Billing'],
      ]);
      expect(cases.every((testCase) => testCase.title === '' && testCase.expected === '' && testCase.ticket === 'PROJ-9')).to.be.true;
    });

    it('uses the letter of the kind and writes at least one row', () => {
      expect(
        buildTemplateCases({
          kind: 'technical',
          ticket: 'PROJ-9',
          rows: 0,
        }).map((testCase) => testCase.id)
      ).to.deep.equal(['PROJ-9-T01']);
      expect(
        buildTemplateCases({
          kind: 'maintenance',
          ticket: 'DSI-2026-14545',
          modules: [],
          rows: 2,
        }).map((testCase) => testCase.id)
      ).to.deep.equal(['DSI-2026-14545-01', 'DSI-2026-14545-02']);
    });

    it('switches to a 3 digit counter past 99 rows', () => {
      const cases = buildTemplateCases({
        kind: 'functional',
        ticket: 'PROJ-9',
        rows: 100,
      });
      expect(cases[99].id).to.equal('PROJ-9-F100');
    });

    for (const format of FORMATS) {
      it(`writes a blank ${format} template that reads back`, async () => {
        const template = buildTemplateCases({
          kind: 'functional',
          ticket: 'PROJ-9',
          modules: ['Sales', 'A|B'],
          rows: 2,
        });
        const { cases } = await writeAndRead(format, 'functional', template);
        expect(cases.map((testCase) => [testCase.id, testCase.ticket, testCase.kind, testCase.module])).to.deep.equal([
          ['PROJ-9-F01', 'PROJ-9', 'functional', 'Sales'],
          ['PROJ-9-F02', 'PROJ-9', 'functional', 'Sales'],
          ['PROJ-9-F03', 'PROJ-9', 'functional', 'A|B'],
          ['PROJ-9-F04', 'PROJ-9', 'functional', 'A|B'],
        ]);
        expect(cases.every((testCase) => testCase.title === '' && testCase.expected === '')).to.be.true;
      });
    }
  });
});
