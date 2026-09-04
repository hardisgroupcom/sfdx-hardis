/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from '../../../src/common/utils/fsUtils.js';
import os from 'os';
import path from 'path';
import { resolveNotebookInput } from '../../../src/common/utils/testNotebookInput.js';

const NOTEBOOK_LINES = [
  '| ID | Cas de test | Étapes | Résultat attendu |',
  '|---|---|---|---|',
  '| PROJ-123-F01 | Un cas | 1. A → B | C |',
];

describe('resolveNotebookInput', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-notebook-input-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('refuses both --notebook and --testsjsonfile at once', async () => {
    let message = '';
    try {
      await resolveNotebookInput({ notebook: 'a.md', testsjsonfile: 'b.json' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.match(/exactly one/i);
  });

  it('refuses neither of them', async () => {
    let message = '';
    try {
      await resolveNotebookInput({});
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.match(/--notebook|--testsjsonfile/);
  });

  it('reads the notebook when only --notebook is given', async () => {
    const file = path.join(tmpDir, 'cahier.md');
    await fs.writeFile(file, NOTEBOOK_LINES.join('\n'), 'utf8');

    const cases = await resolveNotebookInput({ notebook: file });
    expect(cases).to.have.lengthOf(1);
    expect(cases[0].id).to.equal('PROJ-123-F01');
  });

  it('lets --ticket-number override the ticket derived from the ID column', async () => {
    const file = path.join(tmpDir, 'cahier.md');
    await fs.writeFile(file, NOTEBOOK_LINES.join('\n'), 'utf8');

    const cases = await resolveNotebookInput({ notebook: file, 'ticket-number': 'PROJ-999' });
    expect(cases[0].ticket).to.equal('PROJ-999');
  });

  it('names the missing file rather than failing on a parse error', async () => {
    let message = '';
    try {
      await resolveNotebookInput({ testsjsonfile: path.join(tmpDir, 'absent.json') });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.match(/not found/i);
    expect(message).to.contain('absent.json');
  });

  it('validates a --testsjsonfile payload against the public contract', async () => {
    const file = path.join(tmpDir, 'cases.json');
    await fs.writeFile(file, JSON.stringify([{ id: 'PROJ-123-F01' }]), 'utf8');
    let message = '';
    try {
      await resolveNotebookInput({ testsjsonfile: file });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.contain('[0]');
  });
});
