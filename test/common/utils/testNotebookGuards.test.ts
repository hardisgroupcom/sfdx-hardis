/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { assertPushable, sanitizeCell, unsanitizeCell } from '../../../src/common/utils/testNotebookGuards.js';
import { NormalizedTestCase } from '../../../src/common/utils/testNotebookTypes.js';

function makeCase(overrides: Partial<NormalizedTestCase> = {}): NormalizedTestCase {
  return {
    id: 'PROJ-123-F01',
    ticket: 'PROJ-123',
    kind: 'functional',
    module: 'Devis',
    priority: 1,
    title: 'Créer un devis',
    preconditions: 'Un compte actif',
    steps: [{ action: 'Ouvrir', expected: 'La page apparait' }],
    expected: 'Le devis existe',
    ...overrides,
  };
}

describe('testNotebookGuards', () => {
  describe('assertPushable', () => {
    it('accepts a complete notebook', () => {
      expect(() => assertPushable([makeCase()])).to.not.throw();
    });

    it('refuses a case whose expected result is still the completion marker', () => {
      expect(() => assertPushable([makeCase({ expected: 'À COMPLÉTER' })])).to.throw(/PROJ-123-F01/);
    });

    it('refuses a case whose step expectation is still the completion marker', () => {
      const offender = makeCase({ steps: [{ action: 'Ouvrir', expected: 'À COMPLÉTER' }] });
      expect(() => assertPushable([offender])).to.throw(/step 1/);
    });

    it('lists every offender at once instead of stopping at the first', () => {
      let message = '';
      try {
        assertPushable([
          makeCase({ expected: 'À COMPLÉTER' }),
          makeCase({ id: 'PROJ-123-F02', expected: 'À COMPLÉTER' }),
        ]);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).to.contain('PROJ-123-F01').and.to.contain('PROJ-123-F02');
    });

    it('refuses an unsubstituted template placeholder', () => {
      expect(() => assertPushable([makeCase({ title: '{SCENARIO_TITLE}' })])).to.throw(/SCENARIO_TITLE/);
    });

    it('refuses a forbidden literal a generator may have stringified', () => {
      expect(() => assertPushable([makeCase({ expected: 'null' })])).to.throw(/null/);
      expect(() => assertPushable([makeCase({ title: 'N/A' })])).to.throw(/N\/A/i);
    });

    it('lets an empty soql cell through, because the column is advisory', () => {
      expect(() => assertPushable([makeCase({ soql: '' })])).to.not.throw();
    });

    it('still refuses a placeholder inside the advisory soql cell', () => {
      expect(() => assertPushable([makeCase({ soql: '{QUERY}' })])).to.throw(/QUERY/);
    });

    it('refuses two cases sharing an id, listing every duplicated id at once', () => {
      let message = '';
      try {
        assertPushable([
          makeCase(),
          makeCase(),
          makeCase({ id: 'PROJ-123-F02' }),
          makeCase({ id: 'PROJ-123-F02' }),
          makeCase({ id: 'PROJ-123-F03' }),
        ]);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).to.match(/more than once/);
      expect(message).to.contain('PROJ-123-F01').and.to.contain('PROJ-123-F02');
      expect(message).to.not.contain('PROJ-123-F03');
    });
  });

  describe('sanitizeCell', () => {
    it('neutralizes the four formula lead characters Excel executes', () => {
      expect(sanitizeCell('=1+1')).to.equal("'=1+1");
      expect(sanitizeCell('+1')).to.equal("'+1");
      expect(sanitizeCell('-1')).to.equal("'-1");
      expect(sanitizeCell('@SUM(A1)')).to.equal("'@SUM(A1)");
    });

    it('leaves ordinary text untouched', () => {
      expect(sanitizeCell('Créer un devis')).to.equal('Créer un devis');
      expect(sanitizeCell('')).to.equal('');
      expect(sanitizeCell(undefined)).to.equal('');
    });

    it('also guards a value the author started with an apostrophe before a formula character', () => {
      expect(sanitizeCell("'+' button adds a line")).to.equal("''+' button adds a line");
      expect(sanitizeCell("'plain")).to.equal("'plain");
    });

    it('reads back exactly what it guarded, apostrophes typed by the author included', () => {
      for (const value of ['=1+1', "'=1+1", "''=1+1", "'+' button adds a line", "'plain", 'plain', '-1', '\tx', '']) {
        expect(unsanitizeCell(sanitizeCell(value)), JSON.stringify(value)).to.equal(value);
      }
      expect(unsanitizeCell("'plain")).to.equal("'plain");
    });
  });
});
