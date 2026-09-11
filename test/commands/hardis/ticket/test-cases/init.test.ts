/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { buildTemplateRows } from '../../../../../src/common/utils/testNotebookRender.js';
import { deriveTicketAndKind } from '../../../../../src/common/utils/testNotebookTypes.js';

describe('buildTemplateRows', () => {
  it('produces rows per module group', () => {
    const rows = buildTemplateRows({ kind: 'functional', ticket: 'PROJ-123', modules: ['Devis', 'Contrat'], rows: 2 });
    expect(rows).to.have.lengthOf(4);
  });

  it('numbers the identifiers continuously, never restarting at each module', () => {
    const rows = buildTemplateRows({ kind: 'functional', ticket: 'PROJ-123', modules: ['Devis', 'Contrat'], rows: 2 });
    expect(rows.map((row) => row['ID'])).to.deep.equal([
      'PROJ-123-F01',
      'PROJ-123-F02',
      'PROJ-123-F03',
      'PROJ-123-F04',
    ]);
  });

  it('follows the kind for the identifier prefix', () => {
    expect(buildTemplateRows({ kind: 'functional', ticket: 'PROJ-1', rows: 1 })[0]['ID']).to.equal('PROJ-1-F01');
    expect(buildTemplateRows({ kind: 'technical', ticket: 'PROJ-1', rows: 1 })[0]['ID']).to.equal('PROJ-1-T01');
    expect(buildTemplateRows({ kind: 'tma', ticket: 'PROJ-1', rows: 1 })[0]['ID']).to.equal('PROJ-1-01');
  });

  it('carries the module name on every row of its group', () => {
    const rows = buildTemplateRows({ kind: 'functional', ticket: 'PROJ-123', modules: ['Devis', 'Contrat'], rows: 2 });
    expect(rows.map((row) => row['Module'])).to.deep.equal(['Devis', 'Devis', 'Contrat', 'Contrat']);
  });

  it('leaves every other column empty', () => {
    const [row] = buildTemplateRows({ kind: 'functional', ticket: 'PROJ-123', modules: ['Devis'], rows: 1 });
    for (const [header, value] of Object.entries(row)) {
      if (header !== 'ID' && header !== 'Module') {
        expect(value, `column ${header}`).to.equal('');
      }
    }
  });

  it('produces a single unnamed group without --modules', () => {
    const rows = buildTemplateRows({ kind: 'functional', ticket: 'PROJ-123', rows: 3 });
    expect(rows).to.have.lengthOf(3);
    expect(rows.every((row) => row['Module'] === '')).to.be.true;
  });

  // The looping guarantee: the blank notebook the command writes must be readable back by
  // push and render with no manual fixing.
  it('produces identifiers that all read back through deriveTicketAndKind', () => {
    for (const kind of ['functional', 'technical', 'tma'] as const) {
      const rows = buildTemplateRows({ kind, ticket: 'DSI-2026-14545', modules: ['A', 'B'], rows: 2 });
      for (const row of rows) {
        const derived = deriveTicketAndKind(row['ID']);
        expect(derived.ticket).to.equal('DSI-2026-14545');
        expect(derived.kind).to.equal(kind);
      }
    }
  });
});
