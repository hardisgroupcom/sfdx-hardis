/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { deriveTicketAndKind, idempotencyKey, normalizePriority } from '../../../src/common/utils/testNotebookTypes.js';

describe('testNotebookTypes', () => {
  describe('deriveTicketAndKind', () => {
    it('derives a functional case from an -F suffix', () => {
      expect(deriveTicketAndKind('PROJ-123-F01')).to.deep.equal({ ticket: 'PROJ-123', kind: 'functional' });
    });

    it('derives a technical case from a -T suffix', () => {
      expect(deriveTicketAndKind('PROJ-123-T07')).to.deep.equal({ ticket: 'PROJ-123', kind: 'technical' });
    });

    it('derives a tma case from a bare numeric suffix', () => {
      expect(deriveTicketAndKind('PROJ-123-01')).to.deep.equal({ ticket: 'PROJ-123', kind: 'tma' });
    });

    it('supports a ticket key holding several dashes', () => {
      expect(deriveTicketAndKind('INC0012345-F02')).to.deep.equal({ ticket: 'INC0012345', kind: 'functional' });
      expect(deriveTicketAndKind('DSI-2026-14545-F02')).to.deep.equal({ ticket: 'DSI-2026-14545', kind: 'functional' });
    });

    it('throws on an id it cannot read instead of guessing', () => {
      expect(() => deriveTicketAndKind('nonsense')).to.throw(/nonsense/);
      expect(() => deriveTicketAndKind('PROJ-123-X01')).to.throw(/PROJ-123-X01/);
      expect(() => deriveTicketAndKind('')).to.throw();
    });
  });

  describe('idempotencyKey', () => {
    // Non-regression guard: cases already pushed by the skill carry this exact string.
    // Changing it would re-create every one of them as a duplicate.
    it('uses the short id, not the full id', () => {
      expect(idempotencyKey('PROJ-123-F01')).to.equal('TESTKIT:PROJ-123:F01');
    });

    it('keeps the id whole when it does not start with the ticket prefix', () => {
      expect(idempotencyKey('F01', 'PROJ-123')).to.equal('TESTKIT:PROJ-123:F01');
    });
  });

  describe('normalizePriority', () => {
    it('reads P1 / 1 / P3 forms', () => {
      expect(normalizePriority('P1')).to.equal(1);
      expect(normalizePriority('1')).to.equal(1);
      expect(normalizePriority(3)).to.equal(3);
    });

    it('defaults to 2 on anything unreadable', () => {
      expect(normalizePriority('')).to.equal(2);
      expect(normalizePriority('haute')).to.equal(2);
      expect(normalizePriority(null)).to.equal(2);
    });
  });
});
