/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { sanitizeCell } from '../../../src/common/utils/testNotebookGuards.js';

describe('testNotebookGuards', () => {
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
  });
});
