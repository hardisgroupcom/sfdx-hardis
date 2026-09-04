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
  writeNotebookXlsx,
} from '../../../src/common/utils/testNotebookRender.js';
import { parseNotebookXlsx, parseNotebookCsv } from '../../../src/common/utils/testNotebookUtils.js';
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

    it('reads back a csv it just wrote, stopping at the footer', async () => {
      const file = path.join(tmpDir, 'cahier.csv');
      await writeNotebookCsv(file, 'functional', [makeCase(), makeCase({ id: 'PROJ-123-F02' })]);
      const cases = parseNotebookCsv(await fs.readFile(file, 'utf8'));
      expect(cases).to.have.lengthOf(2);
      expect(cases[0].steps).to.have.lengthOf(2);
    });
  });
});
