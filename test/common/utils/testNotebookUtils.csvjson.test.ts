/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from '../../../src/common/utils/fsUtils.js';
import os from 'os';
import path from 'path';
import { parseNotebookFile, validateNormalizedCases } from '../../../src/common/utils/testNotebookUtils.js';

// The renderer writes a UTF-8 BOM so Excel opens accents on a double click. Kept as an
// escape rather than an invisible literal, so a reader can see what is being asserted.
const BOM = '\ufeff';

describe('testNotebookUtils - csv and json', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-notebook-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('parses a semicolon CSV written with a BOM', async () => {
    const file = path.join(tmpDir, 'cahier.csv');
    const csv =
      BOM +
      'ID;Module;Priorité;Cas de test;Prérequis et données;Étapes;Résultat attendu\r\n' +
      'PROJ-123-F01;Devis;P1;Créer un devis;Un compte actif;1. Ouvrir → OK;Le devis existe\r\n';
    await fs.writeFile(file, csv, 'utf8');

    const cases = await parseNotebookFile(file);
    expect(cases).to.have.lengthOf(1);
    expect(cases[0].id).to.equal('PROJ-123-F01');
    expect(cases[0].module).to.equal('Devis');
    expect(cases[0].priority).to.equal(1);
    expect(cases[0].steps[0]).to.deep.equal({ action: 'Ouvrir', expected: 'OK' });
  });

  it('stops the CSV at the summary footer instead of parsing it as cases', async () => {
    const file = path.join(tmpDir, 'cahier.csv');
    const csv =
      BOM +
      'ID;Cas de test;Étapes;Résultat attendu\r\n' +
      'PROJ-123-01;Un cas;1. A → B;C\r\n' +
      ';;;\r\n' +
      'SYNTHÈSE;;;\r\n' +
      'Module;Nb tests;P1;P2\r\n' +
      'Devis;1;1;0\r\n';
    await fs.writeFile(file, csv, 'utf8');

    const cases = await parseNotebookFile(file);
    expect(cases).to.have.lengthOf(1);
  });

  it('accepts a valid pre-normalized json file', async () => {
    const file = path.join(tmpDir, 'cases.json');
    const payload = [
      {
        id: 'PROJ-123-F01',
        ticket: 'PROJ-123',
        kind: 'functional',
        module: 'Devis',
        priority: 1,
        title: 'Créer un devis',
        preconditions: 'Un compte actif',
        steps: [{ action: 'A', expected: 'B' }],
        expected: 'Le devis existe',
      },
    ];
    await fs.writeFile(file, JSON.stringify(payload), 'utf8');

    const cases = await parseNotebookFile(file);
    expect(cases).to.have.lengthOf(1);
    expect(cases[0].kind).to.equal('functional');
  });

  it('rejects a json payload that is off contract, naming the offending index and field', () => {
    expect(() => validateNormalizedCases([{ id: 'PROJ-123-F01' }])).to.throw(/\[0\].*title/i);
    expect(() => validateNormalizedCases([{ id: 'PROJ-123-F01', title: 'T', steps: 'nope' }])).to.throw(/\[0\].*steps/i);
    expect(() => validateNormalizedCases({} as any)).to.throw(/array/i);
  });

  it('refuses an unknown extension rather than guessing the format', async () => {
    const file = path.join(tmpDir, 'cahier.docx');
    await fs.writeFile(file, 'x', 'utf8');
    let message = '';
    try {
      await parseNotebookFile(file);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.match(/\.docx/);
  });
});
