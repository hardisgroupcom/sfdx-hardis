/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  collectObjectDictionary,
  formatFieldType,
  formatPicklistValues,
  hasLocalCustomizations,
  isLocallyCustomApiName,
  MAX_PICKLIST_VALUES_IN_CELL,
} from '../../../src/common/utils/dataDictionaryUtils.js';

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

  // ---------------------------------------------------------------------------
  // collectObjectDictionary()
  // ---------------------------------------------------------------------------
  describe('collectObjectDictionary()', () => {
    it('sorts fields alphabetically by API name', async () => {
      const conn: any = {
        describe: async () => ({
          name: 'Account',
          label: 'Account',
          custom: false,
          keyPrefix: '001',
          fields: [
            { name: 'Zeta', label: 'Z' },
            { name: 'alpha', label: 'a' },
            { name: 'Id', label: 'Id' },
            { name: 'Beta', label: 'B' },
          ],
        }),
      };
      const dict = await collectObjectDictionary(conn, 'Account', {});
      const order = (dict?.fields ?? []).map((field) => field['API Name']);
      expect(order).to.deep.equal(['alpha', 'Beta', 'Id', 'Zeta']);
    });
  });

  // ---------------------------------------------------------------------------
  // formatFieldType()
  // ---------------------------------------------------------------------------
  describe('formatFieldType()', () => {
    it('maps numeric types to Number', () => {
      expect(formatFieldType({ type: 'int' })).to.equal('Number');
      expect(formatFieldType({ type: 'double' })).to.equal('Number');
      expect(formatFieldType({ type: 'long' })).to.equal('Number');
    });

    it('maps reference to Lookup or MasterDetail based on relationshipOrder', () => {
      expect(formatFieldType({ type: 'reference', relationshipOrder: null })).to.equal('Lookup');
      expect(formatFieldType({ type: 'reference' })).to.equal('Lookup');
      expect(formatFieldType({ type: 'reference', relationshipOrder: 0 })).to.equal('MasterDetail');
      expect(formatFieldType({ type: 'reference', relationshipOrder: 1 })).to.equal('MasterDetail');
    });

    it('maps common scalar types to Salesforce type names', () => {
      expect(formatFieldType({ type: 'string' })).to.equal('Text');
      expect(formatFieldType({ type: 'boolean' })).to.equal('Checkbox');
      expect(formatFieldType({ type: 'datetime' })).to.equal('DateTime');
      expect(formatFieldType({ type: 'url' })).to.equal('Url');
      expect(formatFieldType({ type: 'picklist' })).to.equal('Picklist');
      expect(formatFieldType({ type: 'multipicklist' })).to.equal('MultiselectPicklist');
    });

    it('distinguishes text area variants', () => {
      expect(formatFieldType({ type: 'textarea', length: 255 })).to.equal('TextArea');
      expect(formatFieldType({ type: 'textarea', length: 32768 })).to.equal('LongTextArea');
      expect(formatFieldType({ type: 'textarea', htmlFormatted: true })).to.equal('Html');
    });

    it('tags auto number, formula and roll-up summary fields', () => {
      expect(formatFieldType({ type: 'string', autoNumber: true })).to.equal('AutoNumber');
      expect(formatFieldType({ type: 'double', calculatedFormula: 'Amount * 2' })).to.equal('Formula (Number)');
      expect(formatFieldType({ type: 'currency', calculated: true })).to.equal('Roll-Up Summary (Currency)');
    });

    it('falls back to the raw type when unknown', () => {
      expect(formatFieldType({ type: 'somethingNew' })).to.equal('somethingNew');
      expect(formatFieldType({})).to.equal('');
    });
  });

  // ---------------------------------------------------------------------------
  // isLocallyCustomApiName() / hasLocalCustomizations()
  // ---------------------------------------------------------------------------
  describe('isLocallyCustomApiName()', () => {
    it('returns true for local custom names (single "__")', () => {
      expect(isLocallyCustomApiName('MyField__c')).to.equal(true);
      expect(isLocallyCustomApiName('MyObject__c')).to.equal(true);
      expect(isLocallyCustomApiName('MyEvent__e')).to.equal(true);
    });

    it('returns false for managed names (namespace prefix => two "__")', () => {
      expect(isLocallyCustomApiName('ns__MyField__c')).to.equal(false);
      expect(isLocallyCustomApiName('ns__MyObject__c')).to.equal(false);
    });

    it('returns false for standard names (no "__")', () => {
      expect(isLocallyCustomApiName('Name')).to.equal(false);
      expect(isLocallyCustomApiName('')).to.equal(false);
    });
  });

  describe('hasLocalCustomizations()', () => {
    const field = (apiName: string, custom: boolean) => ({ 'API Name': apiName, Custom: custom ? 'Yes' : 'No' });

    it('keeps a local custom object even without custom fields', () => {
      const dict = { apiName: 'MyObject__c', label: 'My Object', custom: true, keyPrefix: 'a00', fields: [field('Name', false)] };
      expect(hasLocalCustomizations(dict)).to.equal(true);
    });

    it('keeps a standard object that has a local custom field', () => {
      const dict = { apiName: 'Account', label: 'Account', custom: false, keyPrefix: '001', fields: [field('Name', false), field('MyField__c', true)] };
      expect(hasLocalCustomizations(dict)).to.equal(true);
    });

    it('keeps a managed object that has a local custom field', () => {
      const dict = { apiName: 'ns__Obj__c', label: 'Managed', custom: true, keyPrefix: 'a01', fields: [field('LocalField__c', true)] };
      expect(hasLocalCustomizations(dict)).to.equal(true);
    });

    it('excludes a standard object without custom fields', () => {
      const dict = { apiName: 'Account', label: 'Account', custom: false, keyPrefix: '001', fields: [field('Name', false), field('Industry', false)] };
      expect(hasLocalCustomizations(dict)).to.equal(false);
    });

    it('excludes a managed object whose only custom fields are managed', () => {
      const dict = { apiName: 'ns__Obj__c', label: 'Managed', custom: true, keyPrefix: 'a01', fields: [field('ns__ManagedField__c', true)] };
      expect(hasLocalCustomizations(dict)).to.equal(false);
    });
  });
});
