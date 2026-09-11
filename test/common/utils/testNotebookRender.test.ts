/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import ExcelJS from 'exceljs';
import fs from '../../../src/common/utils/fsUtils.js';
import os from 'os';
import path from 'path';
import {
  COLUMNS,
  SHEET_NAMES,
  STATUS_VALUES,
  synthesisRows,
  writeNotebookCsv,
  writeNotebookMarkdown,
  writeNotebookXlsx,
} from '../../../src/common/utils/testNotebookRender.js';
import {
  parseNotebookXlsx,
  parseNotebookCsv,
  parseNotebookMarkdown,
} from '../../../src/common/utils/testNotebookUtils.js';
import { NormalizedTestCase } from '../../../src/common/utils/testNotebookTypes.js';

function makeCase(overrides: Partial<NormalizedTestCase> = {}): NormalizedTestCase {
  return {
    id: 'PROJ-123-F01',
    ticket: 'PROJ-123',
    kind: 'functional',
    module: 'Devis',
    priority: 1,
    title: 'Creer un devis',
    preconditions: 'Un compte actif',
    soql: 'SELECT Id FROM Account LIMIT 1',
    steps: [
      { action: 'Ouvrir', expected: 'La page apparait' },
      { action: 'Valider', expected: 'Le devis est cree' },
    ],
    expected: 'Le devis existe',
    ...overrides,
  };
}

describe('testNotebookRender', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-render-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  describe('column sets', () => {
    it('orders the functional columns, the tester columns last', () => {
      expect(COLUMNS.functional.map((column) => column.header)).to.deep.equal([
        'ID',
        'Module',
        'Priorité',
        'Cas de test',
        'Prérequis et données',
        'Requête SOQL',
        'Étapes',
        'Résultat attendu',
        'Résultat obtenu',
        'Commentaire',
        'Statut',
      ]);
    });

    it('replaces the query and the steps by the class under test on a technical notebook', () => {
      const headers = COLUMNS.technical.map((column) => column.header);
      expect(headers).to.include('Classe / Méthode');
      expect(headers).to.not.include('Requête SOQL');
      expect(headers).to.not.include('Étapes');
    });

    it('drops the module and the priority on a TMA notebook', () => {
      const headers = COLUMNS.tma.map((column) => column.header);
      expect(headers).to.not.include('Module');
      expect(headers).to.not.include('Priorité');
    });
  });

  describe('xlsx', () => {
    async function render(kind: 'functional' | 'technical' | 'tma', cases: NormalizedTestCase[]) {
      const file = path.join(tmpDir, 'cahier.xlsx');
      await writeNotebookXlsx(file, kind, cases);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file);
      return { file, workbook };
    }

    it('names the sheet after the kind', async () => {
      for (const kind of ['functional', 'technical', 'tma'] as const) {
        const { workbook } = await render(kind, [makeCase()]);
        expect(workbook.worksheets[0].name).to.equal(SHEET_NAMES[kind]);
      }
    });

    it('writes a bold header on a grey fill, and freezes it', async () => {
      const { workbook } = await render('functional', [makeCase()]);
      const header = workbook.worksheets[0].getRow(1);
      expect(header.font?.bold).to.be.true;
      expect((header.getCell(1).fill as any)?.fgColor?.argb).to.equal('FFD9D9D9');
      expect(workbook.worksheets[0].views[0]).to.include({ state: 'frozen', ySplit: 1 });
    });

    it('leaves the three tester columns empty', async () => {
      const { workbook } = await render('functional', [makeCase()]);
      const worksheet = workbook.worksheets[0];
      const headers = COLUMNS.functional.map((column) => column.header);
      for (const columnName of ['Résultat obtenu', 'Commentaire', 'Statut']) {
        const cell = worksheet.getRow(2).getCell(headers.indexOf(columnName) + 1);
        expect(cell.text ?? '').to.equal('');
      }
    });

    it('restricts the status column to the value list', async () => {
      const { workbook } = await render('functional', [makeCase()]);
      const worksheet = workbook.worksheets[0];
      const statusIndex = COLUMNS.functional.findIndex((column) => column.key === 'status') + 1;
      const validation = worksheet.getCell(2, statusIndex).dataValidation as any;
      expect(validation?.type).to.equal('list');
      expect(validation?.formulae?.[0]).to.contain(STATUS_VALUES[0]);
    });

    it('adds a synthesis sheet with one row per module and a total', async () => {
      const cases = [makeCase(), makeCase({ id: 'PROJ-123-F02', module: 'Contrat', priority: 2 })];
      const { workbook } = await render('functional', cases);
      const synthesis = workbook.worksheets[1];
      expect(synthesis.name).to.equal('Synthèse');
      const rows = synthesisRows(cases);
      expect(rows).to.have.lengthOf(3);
      expect(rows[rows.length - 1][0]).to.equal('TOTAL');
      expect(rows[rows.length - 1][1]).to.equal(2);
    });

    it('keeps the priority column width custom, which a width of exactly 9 would not', async () => {
      const { workbook } = await render('functional', [makeCase()]);
      const headers = COLUMNS.functional.map((column) => column.header);
      const column = workbook.worksheets[0].getColumn(headers.indexOf('Priorité') + 1);
      expect(column.width).to.equal(9.5);
    });
  });

  describe('csv', () => {
    it('writes semicolons, a BOM and CRLF endings', async () => {
      const file = path.join(tmpDir, 'cahier.csv');
      await writeNotebookCsv(file, 'functional', [makeCase()]);
      const content = await fs.readFile(file, 'utf8');
      expect(content.charCodeAt(0)).to.equal(0xfeff);
      expect(content).to.contain('\r\n');
      expect(content.split('\r\n')[0].split(';')).to.have.lengthOf(COLUMNS.functional.length);
    });

    it('writes a summary footer under the cases', async () => {
      const file = path.join(tmpDir, 'cahier.csv');
      await writeNotebookCsv(file, 'functional', [makeCase()]);
      const content = await fs.readFile(file, 'utf8');
      expect(content).to.contain('SYNTHÈSE');
      expect(content).to.contain('Nb tests');
      expect(content).to.contain('TOTAL');
    });

    it('neutralizes a cell a spreadsheet would run as a formula', async () => {
      const file = path.join(tmpDir, 'cahier.csv');
      await writeNotebookCsv(file, 'functional', [makeCase({ title: '=1+1' })]);
      const content = await fs.readFile(file, 'utf8');
      expect(content).to.contain("'=1+1");
    });
  });

  describe('round trip', () => {
    // The most useful assertion of the file: it proves the workbook a tester receives is the
    // one the parser knows how to read back.
    it('reads back an xlsx it just wrote, including the technical target column', async () => {
      const original = makeCase({
        id: 'PROJ-123-T01',
        kind: 'technical',
        target: 'AccountService.createQuote',
        soql: '',
        steps: [],
      });
      const file = path.join(tmpDir, 'technique.xlsx');
      await writeNotebookXlsx(file, 'technical', [original]);

      const [reread] = await parseNotebookXlsx(file);
      expect(reread.id).to.equal('PROJ-123-T01');
      expect(reread.kind).to.equal('technical');
      expect(reread.title).to.equal(original.title);
      expect(reread.priority).to.equal(original.priority);
      expect(reread.target).to.equal('AccountService.createQuote');
      expect(reread.expected).to.equal(original.expected);
    });

    it('reads back a functional xlsx with its steps and priority', async () => {
      const original = makeCase();
      const file = path.join(tmpDir, 'fonctionnel.xlsx');
      await writeNotebookXlsx(file, 'functional', [original]);

      const [reread] = await parseNotebookXlsx(file);
      expect(reread.priority).to.equal(1);
      expect(reread.steps).to.have.lengthOf(2);
      expect(reread.steps[0]).to.deep.equal({ action: 'Ouvrir', expected: 'La page apparait' });
      expect(reread.steps[1]).to.deep.equal({ action: 'Valider', expected: 'Le devis est cree' });
      expect(reread.soql).to.equal('SELECT Id FROM Account LIMIT 1');
    });

    it('reads back a value the formula guard prefixed, without the apostrophe', async () => {
      const original = makeCase({ title: '=1+1', preconditions: '- Un compte actif' });

      const xlsxFile = path.join(tmpDir, 'formule.xlsx');
      await writeNotebookXlsx(xlsxFile, 'functional', [original]);
      const [fromXlsx] = await parseNotebookXlsx(xlsxFile);
      expect(fromXlsx.title).to.equal('=1+1');
      expect(fromXlsx.preconditions).to.equal('- Un compte actif');

      const csvFile = path.join(tmpDir, 'formule.csv');
      await writeNotebookCsv(csvFile, 'functional', [original]);
      const [fromCsv] = parseNotebookCsv(await fs.readFile(csvFile, 'utf8'));
      expect(fromCsv.title).to.equal('=1+1');
      expect(fromCsv.preconditions).to.equal('- Un compte actif');
    });

    it('reads back a csv it just wrote, stopping at the footer', async () => {
      const file = path.join(tmpDir, 'cahier.csv');
      await writeNotebookCsv(file, 'functional', [makeCase(), makeCase({ id: 'PROJ-123-F02' })]);
      const cases = parseNotebookCsv(await fs.readFile(file, 'utf8'));
      expect(cases).to.have.lengthOf(2);
      expect(cases[0].steps).to.have.lengthOf(2);
    });
  });

  // A field holding a line break used to be written as-is, so one case spread over as many
  // physical rows as it had lines. The row ends at the newline in a CSV and in a markdown
  // table alike, so the file became unreadable back: the second line was read as a case with
  // an unusable id. Only the steps column was folded before.
  describe('multi-line fields', () => {
    const multiLine = () =>
      makeCase({
        preconditions: 'Un compte actif\nUn contact rattache',
        expected: 'Le devis existe\n  Son total vaut 100  \r\nIl est visible',
      });

    it('keeps a case on a single csv row, whatever line breaks its fields hold', async () => {
      const folded = path.join(tmpDir, 'multi.csv');
      const flat = path.join(tmpDir, 'flat.csv');
      await writeNotebookCsv(folded, 'functional', [multiLine()]);
      await writeNotebookCsv(flat, 'functional', [makeCase()]);
      const lineCount = (content: string) => content.split('\r\n').filter(Boolean).length;
      // Compared against the same notebook without line breaks rather than a hardcoded count,
      // so the assertion still means something if the footer ever gains a row.
      expect(lineCount(await fs.readFile(folded, 'utf8'))).to.equal(lineCount(await fs.readFile(flat, 'utf8')));
    });

    it('reads that csv back as one case, with the line breaks folded onto the separator', async () => {
      const file = path.join(tmpDir, 'multi.csv');
      await writeNotebookCsv(file, 'functional', [multiLine()]);
      const cases = parseNotebookCsv(await fs.readFile(file, 'utf8'));
      expect(cases).to.have.lengthOf(1);
      expect(cases[0].id).to.equal('PROJ-123-F01');
      expect(cases[0].expected).to.equal('Le devis existe<br>Son total vaut 100<br>Il est visible');
      expect(cases[0].preconditions).to.equal('Un compte actif<br>Un contact rattache');
    });

    it('keeps a case on a single markdown row too', async () => {
      const file = path.join(tmpDir, 'multi.md');
      await writeNotebookMarkdown(file, 'functional', [multiLine()]);
      const cases = parseNotebookMarkdown(await fs.readFile(file, 'utf8'));
      expect(cases).to.have.lengthOf(1);
      expect(cases[0].expected).to.contain('Son total vaut 100');
    });

    // The xlsx keeps real line breaks, so this one is about normalization rather than folding:
    // the CRLF becomes an LF and each line is trimmed. Without that, ExcelJS still produced a
    // readable file, which is why the assertion targets the exact cell content and not just
    // the row count.
    it('normalizes the line breaks it keeps in the xlsx, where a cell can hold them', async () => {
      const file = path.join(tmpDir, 'multi.xlsx');
      await writeNotebookXlsx(file, 'functional', [multiLine()]);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file);
      const sheet = workbook.getWorksheet(SHEET_NAMES.functional);
      // Column located by its key, not by its header label, so a wording change cannot make
      // this test read the wrong cell and pass for the wrong reason.
      const column = COLUMNS.functional.findIndex((entry) => entry.key === 'expected') + 1;
      const cell = String(sheet?.getRow(2).getCell(column).value ?? '');
      expect(cell).to.equal('Le devis existe\nSon total vaut 100\nIl est visible');
      // And it still reads back as one case, not three.
      expect(await parseNotebookXlsx(file)).to.have.lengthOf(1);
    });
  });

  // The literal arrow escape `->` was un-escaped into a real arrow when reading, but never
  // re-escaped when writing. So an action legitimately containing an arrow was re-split at
  // that arrow on the next read, and half of it silently moved into the expected result.
  describe('arrow round trip', () => {
    const withArrow = () =>
      makeCase({
        steps: [{ action: 'Cliquer sur Devis → Nouveau', expected: 'Le panneau apparait' }],
      });

    // Compared against the ORIGINAL steps, not against the previous cycle: the defect reached a
    // fixed point after a single read, so both renders came out byte-identical while the arrow
    // had already moved half of the action into the expected result. Byte stability proves
    // nothing here, only fidelity to the input does.
    it('survives two full write-read cycles without drifting from the input', async () => {
      const original = withArrow();
      const first = path.join(tmpDir, 'arrow-1.csv');
      const second = path.join(tmpDir, 'arrow-2.csv');
      await writeNotebookCsv(first, 'functional', [original]);
      const cycle1 = parseNotebookCsv(await fs.readFile(first, 'utf8'));
      await writeNotebookCsv(second, 'functional', cycle1);
      const cycle2 = parseNotebookCsv(await fs.readFile(second, 'utf8'));
      expect(cycle1[0].steps).to.deep.equal(original.steps);
      expect(cycle2[0].steps).to.deep.equal(original.steps);
      expect(await fs.readFile(second, 'utf8')).to.equal(await fs.readFile(first, 'utf8'));
    });

    it('keeps the arrow inside the action instead of splitting the step at it', async () => {
      const file = path.join(tmpDir, 'arrow.csv');
      await writeNotebookCsv(file, 'functional', [withArrow()]);
      const cases = parseNotebookCsv(await fs.readFile(file, 'utf8'));
      expect(cases[0].steps).to.have.lengthOf(1);
      expect(cases[0].steps[0].action).to.equal('Cliquer sur Devis → Nouveau');
      expect(cases[0].steps[0].expected).to.equal('Le panneau apparait');
    });
  });
});
