/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import ExcelJS from 'exceljs';
import fs from '../../../src/common/utils/fsUtils.js';
import os from 'os';
import path from 'path';
import { parseNotebookXlsx } from '../../../src/common/utils/testNotebookUtils.js';

describe('testNotebookUtils - xlsx', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-notebook-xlsx-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  async function writeWorkbook(rows: any[][], headers: string[]): Promise<string> {
    const file = path.join(tmpDir, 'cahier.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Fonctionnel');
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(row));
    await workbook.xlsx.writeFile(file);
    return file;
  }

  const HEADERS = [
    'ID',
    'Module',
    'Priorité',
    'Cas de test',
    'Prérequis et données',
    'Requête SOQL',
    'Étapes',
    'Résultat attendu',
  ];

  it('reads the first worksheet holding an ID column', async () => {
    const file = await writeWorkbook(
      [
        [
          'PROJ-123-F01',
          'Devis',
          'P1',
          'Créer un devis',
          'Un compte actif',
          'SELECT Id FROM Account',
          '1. Ouvrir → OK',
          'Le devis existe',
        ],
      ],
      HEADERS
    );
    const cases = await parseNotebookXlsx(file);
    expect(cases).to.have.lengthOf(1);
    expect(cases[0].id).to.equal('PROJ-123-F01');
    expect(cases[0].priority).to.equal(1);
    expect(cases[0].steps[0]).to.deep.equal({ action: 'Ouvrir', expected: 'OK' });
  });

  it('reads a multi-line cell, the shape Prérequis and Étapes actually take in Excel', async () => {
    const file = await writeWorkbook(
      [['PROJ-123-F02', 'Devis', 'P2', 'Un cas', 'Ligne 1\nLigne 2', '', '1. A → B\n2. C → D', 'Fini']],
      HEADERS
    );
    const cases = await parseNotebookXlsx(file);
    expect(cases[0].preconditions).to.contain('Ligne 1').and.to.contain('Ligne 2');
    expect(cases[0].steps).to.have.lengthOf(2);
    expect(cases[0].steps[1]).to.deep.equal({ action: 'C', expected: 'D' });
  });

  it('reads a numeric priority cell that Excel typed as a number', async () => {
    const file = await writeWorkbook([['PROJ-123-F03', 'Devis', 3, 'Un cas', '', '', '1. A → B', 'Fini']], HEADERS);
    const cases = await parseNotebookXlsx(file);
    expect(cases[0].priority).to.equal(3);
  });

  it('reads a rich text cell, which ExcelJS returns as an object and not a string', async () => {
    const file = path.join(tmpDir, 'rich.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Fonctionnel');
    sheet.addRow(HEADERS);
    const row = sheet.addRow(['PROJ-123-F04', 'Devis', 'P1', '', '', '', '1. A → B', 'Fini']);
    row.getCell(4).value = { richText: [{ text: 'Créer ' }, { text: 'un devis', font: { bold: true } }] };
    await workbook.xlsx.writeFile(file);

    const cases = await parseNotebookXlsx(file);
    expect(cases[0].title).to.equal('Créer un devis');
  });

  it('skips the trailing empty rows Excel leaves behind', async () => {
    const file = await writeWorkbook(
      [
        ['PROJ-123-F05', 'Devis', 'P1', 'Un cas', '', '', '1. A → B', 'Fini'],
        ['', '', '', '', '', '', '', ''],
        [null, null, null, null, null, null, null, null],
      ],
      HEADERS
    );
    const cases = await parseNotebookXlsx(file);
    expect(cases).to.have.lengthOf(1);
  });

  it('names the workbook and the sheets when no sheet holds an ID column', async () => {
    const file = await writeWorkbook([['x']], ['Autre chose']);
    let message = '';
    try {
      await parseNotebookXlsx(file);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.contain('Fonctionnel');
    expect(message).to.match(/ID/);
  });
});
