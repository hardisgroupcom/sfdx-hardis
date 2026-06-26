/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { formatPicklistValues, MAX_PICKLIST_VALUES_IN_CELL } from '../../../src/common/utils/dataDictionaryUtils.js';

describe('dataDictionaryUtils', () => {
  // ---------------------------------------------------------------------------
  // formatPicklistValues()
  // ---------------------------------------------------------------------------
  describe('formatPicklistValues()', () => {
    it('returns empty string when field has no picklistValues', () => {
      expect(formatPicklistValues({})).to.equal('');
      expect(formatPicklistValues({ picklistValues: null })).to.equal('');
      expect(formatPicklistValues({ picklistValues: [] })).to.equal('');
    });

    it('returns empty string when field is null or undefined', () => {
      expect(formatPicklistValues(null)).to.equal('');
      expect(formatPicklistValues(undefined)).to.equal('');
    });

    it('joins active values with "; "', () => {
      const field = {
        picklistValues: [
          { value: 'Alpha', active: true },
          { value: 'Beta', active: true },
          { value: 'Gamma', active: true },
        ],
      };
      expect(formatPicklistValues(field)).to.equal('Alpha; Beta; Gamma');
    });

    it('filters out inactive values', () => {
      const field = {
        picklistValues: [
          { value: 'Active', active: true },
          { value: 'Inactive', active: false },
          { value: 'Also Active', active: true },
        ],
      };
      expect(formatPicklistValues(field)).to.equal('Active; Also Active');
    });

    it('filters out entries with empty or non-string values', () => {
      const field = {
        picklistValues: [
          { value: 'Good', active: true },
          { value: '', active: true },
          { value: 42, active: true },
          { active: true },
        ],
      };
      expect(formatPicklistValues(field)).to.equal('Good');
    });

    it('returns all values when count equals MAX_PICKLIST_VALUES_IN_CELL', () => {
      const field = {
        picklistValues: Array.from({ length: MAX_PICKLIST_VALUES_IN_CELL }, (_, i) => ({
          value: `V${i}`,
          active: true,
        })),
      };
      const result = formatPicklistValues(field);
      expect(result).to.equal(Array.from({ length: MAX_PICKLIST_VALUES_IN_CELL }, (_, i) => `V${i}`).join('; '));
      expect(result).not.to.include('more)');
    });

    it('caps at MAX_PICKLIST_VALUES_IN_CELL and appends overflow note', () => {
      const total = MAX_PICKLIST_VALUES_IN_CELL + 5;
      const field = {
        picklistValues: Array.from({ length: total }, (_, i) => ({ value: `V${i}`, active: true })),
      };
      const result = formatPicklistValues(field);
      expect(result).to.include(`(+5 more)`);
      // Format: "V0; V1; ... V49 (+5 more)" - the note is appended after the last value with a space
      const noteIndex = result.lastIndexOf(' (+5 more)');
      const shownPart = result.slice(0, noteIndex);
      const shown = shownPart.split('; ');
      expect(shown).to.have.lengthOf(MAX_PICKLIST_VALUES_IN_CELL);
      expect(shown[0]).to.equal('V0');
      expect(shown[MAX_PICKLIST_VALUES_IN_CELL - 1]).to.equal(`V${MAX_PICKLIST_VALUES_IN_CELL - 1}`);
    });

    it('MAX_PICKLIST_VALUES_IN_CELL is 50', () => {
      expect(MAX_PICKLIST_VALUES_IN_CELL).to.equal(50);
    });
  });
});
