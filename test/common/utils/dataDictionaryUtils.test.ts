/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  buildDataCloudObjectDictionary,
  buildDataCloudRelationshipRow,
  collectDataCloudDictionaries,
  collectObjectDictionary,
  fetchDataCloudRelationships,
  formatDataCloudFieldType,
  formatFieldType,
  getDataCloudEntityType,
  formatPicklistValues,
  hasLocalCustomizations,
  isLocallyCustomApiName,
  listDataCloudObjectNamesForPrompt,
  MAX_PICKLIST_VALUES_IN_CELL,
} from '../../../src/common/utils/dataDictionaryUtils.js';
import { getDataModelObjectRelationships } from '../../../src/common/utils/dataCloudUtils.js';

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

  // ---------------------------------------------------------------------------
  // Data Cloud objects
  // ---------------------------------------------------------------------------
  const BASE_URL = 'https://example.my.salesforce.com/services/data/v64.0';

  const dmoMetadata = {
    name: 'ssot__Individual__dlm',
    displayName: 'Individual',
    category: 'Profile',
    primaryKeys: [{ name: 'ssot__Id__c', displayName: 'Individual Id', indexOrder: '1' }],
    fields: [
      { name: 'ssot__Id__c', displayName: 'Individual Id', type: 'STRING', businessType: 'TEXT', keyQualifier: 'KQ_Id__c' },
      { name: 'Loyalty_Tier__c', displayName: 'Loyalty Tier', type: 'STRING', businessType: 'TEXT' },
      { name: 'ssot__BirthDate__c', displayName: 'Birth Date', type: 'DATE', businessType: 'DATE' },
    ],
  };
  const dloMetadata = {
    name: 'Crm_Contact__dll',
    displayName: 'Crm Contact',
    category: 'Profile',
    primaryKeys: [{ name: 'Id__c' }],
    fields: [{ name: 'Id__c', displayName: 'Id', type: 'STRING', businessType: 'TEXT' }],
  };

  const relationship = (overrides: any) => ({
    id: overrides.id,
    name: overrides.name || overrides.id,
    cardinality: 'ManyToOne',
    creationType: 'Custom',
    status: 'ACTIVE',
    sourceObject: { name: overrides.from || 'Crm_Order__dlm' },
    sourceField: { name: overrides.fromField || 'Customer_Id__c', type: 'MktDataModelField' },
    targetObject: { name: overrides.to || 'ssot__Individual__dlm' },
    targetField: { name: overrides.toField || 'ssot__Id__c', type: overrides.toType || 'MktDataModelField' },
    ...overrides.extra,
  });

  // Serves ssot/metadata by entityType and the relationships endpoint by DMO name and offset.
  const dataCloudConn = (routes: {
    metadata?: Record<string, any>;
    relationships?: Record<string, any[]>;
    failMetadata?: string;
    failMetadataFor?: Record<string, string>;
    omitTotalSize?: boolean;
  }) => {
    const calls: string[] = [];
    const conn: any = {
      baseUrl: () => BASE_URL,
      request: async ({ url }: { url: string }) => {
        calls.push(url);
        if (url.includes('/ssot/metadata?')) {
          const entityType = new URL(url).searchParams.get('entityType') || '';
          const failure = routes.failMetadata || routes.failMetadataFor?.[entityType];
          if (failure) {
            throw new Error(failure);
          }
          return { metadata: routes.metadata?.[entityType] || [] };
        }
        const match = url.match(/data-model-objects\/([^/]+)\/relationships/);
        if (match) {
          const all = routes.relationships?.[decodeURIComponent(match[1])] || [];
          const params = new URL(url).searchParams;
          const offset = Number(params.get('offset') || 0);
          const limit = Number(params.get('limit') || 500);
          const relationships = all.slice(offset, offset + limit);
          return routes.omitTotalSize ? { relationships } : { relationships, totalSize: all.length };
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    };
    return { conn, calls };
  };

  describe('getDataCloudEntityType()', () => {
    it('recognizes Data Model Objects and Data Lake Objects by suffix', () => {
      expect(getDataCloudEntityType('ssot__Individual__dlm')).to.equal('DataModelObject');
      expect(getDataCloudEntityType('Crm_Contact__DLL')).to.equal('DataLakeObject');
      expect(getDataCloudEntityType('Account')).to.equal(null);
      expect(getDataCloudEntityType('MyObject__c')).to.equal(null);
    });
  });

  describe('buildDataCloudObjectDictionary()', () => {
    it('maps fields with type, primary key, key qualifier and custom flag, sorted by API name', () => {
      const dict = buildDataCloudObjectDictionary(dmoMetadata, 'DataModelObject');
      expect(dict.apiName).to.equal('ssot__Individual__dlm');
      expect(dict.label).to.equal('Individual');
      expect(dict.custom).to.equal(false);
      expect(dict.keyPrefix).to.equal('');
      expect(dict.objectType).to.equal('Data Model Object');
      expect(dict.category).to.equal('Profile');
      expect(dict.fields.map((f) => f['API Name'])).to.deep.equal(['Loyalty_Tier__c', 'ssot__BirthDate__c', 'ssot__Id__c']);
      const id = dict.fields.find((f) => f['API Name'] === 'ssot__Id__c')!;
      expect(id).to.deep.equal({
        'API Name': 'ssot__Id__c',
        'Label': 'Individual Id',
        'Type': 'Text',
        'Data Type': 'STRING',
        'Primary Key': 'Yes',
        'Key Qualifier': 'KQ_Id__c',
        'Custom': 'No',
      });
      expect(dict.fields.find((f) => f['API Name'] === 'Loyalty_Tier__c')!['Custom']).to.equal('Yes');
    });

    it('marks a Data Lake Object as custom', () => {
      const dict = buildDataCloudObjectDictionary(dloMetadata, 'DataLakeObject');
      expect(dict.objectType).to.equal('Data Lake Object');
      expect(dict.custom).to.equal(true);
      expect(hasLocalCustomizations(dict)).to.equal(true);
    });

    it('keeps a standard DMO with a custom field for --customizedonly, and drops one without', () => {
      expect(hasLocalCustomizations(buildDataCloudObjectDictionary(dmoMetadata, 'DataModelObject'))).to.equal(true);
      const standardOnly = { ...dmoMetadata, fields: dmoMetadata.fields.filter((f) => f.name.startsWith('ssot__')) };
      expect(hasLocalCustomizations(buildDataCloudObjectDictionary(standardOnly, 'DataModelObject'))).to.equal(false);
    });
  });

  describe('formatDataCloudFieldType()', () => {
    it('maps Data Cloud business types and keeps unknown ones', () => {
      expect(formatDataCloudFieldType('DATE_TIME')).to.equal('DateTime');
      expect(formatDataCloudFieldType('email')).to.equal('Email');
      expect(formatDataCloudFieldType('SOMETHING_NEW')).to.equal('SOMETHING_NEW');
      expect(formatDataCloudFieldType('')).to.equal('');
    });
  });

  describe('collectDataCloudDictionaries()', () => {
    const metadata = { DataModelObject: [dmoMetadata], DataLakeObject: [dloMetadata] };

    it('documents the requested objects with one metadata call per object type', async () => {
      const { conn, calls } = dataCloudConn({ metadata });
      const dicts = await collectDataCloudDictionaries(conn, ['ssot__Individual__dlm'], false, {});
      expect(dicts.map((d) => d.apiName)).to.deep.equal(['ssot__Individual__dlm']);
      expect(calls).to.deep.equal([`${BASE_URL}/ssot/metadata?entityType=DataModelObject`]);
    });

    it('documents every listed object with includeAll', async () => {
      const { conn, calls } = dataCloudConn({ metadata });
      const dicts = await collectDataCloudDictionaries(conn, [], true, {});
      expect(dicts.map((d) => d.apiName)).to.deep.equal(['Crm_Contact__dll', 'ssot__Individual__dlm']);
      expect(calls).to.have.length(2);
    });

    it('skips requested objects the org does not list', async () => {
      const { conn } = dataCloudConn({ metadata });
      const dicts = await collectDataCloudDictionaries(conn, ['Unknown__dlm', 'Crm_Contact__dll'], false, {});
      expect(dicts.map((d) => d.apiName)).to.deep.equal(['Crm_Contact__dll']);
    });

    it('returns nothing without throwing when Data Cloud is not enabled', async () => {
      const { conn } = dataCloudConn({ failMetadata: 'No CDP tenant id found for this org' });
      const dicts = await collectDataCloudDictionaries(conn, [], true, {});
      expect(dicts).to.deep.equal([]);
    });

    it('reuses the listing downloaded for the prompt', async () => {
      const { conn, calls } = dataCloudConn({ metadata });
      await listDataCloudObjectNamesForPrompt(conn, {});
      const dicts = await collectDataCloudDictionaries(conn, [], true, {});
      expect(dicts).to.have.length(2);
      expect(calls).to.have.length(2);
    });
  });

  describe('listDataCloudObjectNamesForPrompt()', () => {
    it('lists the Data Model Objects and Data Lake Objects', async () => {
      const { conn } = dataCloudConn({ metadata: { DataModelObject: [dmoMetadata], DataLakeObject: [dloMetadata] } });
      expect(await listDataCloudObjectNamesForPrompt(conn, {})).to.deep.equal(['ssot__Individual__dlm', 'Crm_Contact__dll']);
    });

    it('stops quietly after one call when Data Cloud is not enabled', async () => {
      const { conn, calls } = dataCloudConn({ failMetadata: 'No CDP tenant id found for this org' });
      expect(await listDataCloudObjectNamesForPrompt(conn, {})).to.deep.equal([]);
      expect(calls).to.have.length(1);
    });

    it('still lists the Data Lake Objects when the Data Model Objects cannot be read', async () => {
      const { conn } = dataCloudConn({
        metadata: { DataLakeObject: [dloMetadata] },
        failMetadataFor: { DataModelObject: 'Request failed with status code 403' },
      });
      expect(await listDataCloudObjectNamesForPrompt(conn, {})).to.deep.equal(['Crm_Contact__dll']);
    });
  });

  describe('fetchDataCloudRelationships()', () => {
    it('leaves out the never activated standard catalog and keeps everything else', async () => {
      const { conn } = dataCloudConn({
        relationships: {
          'ssot__Individual__dlm': [
            relationship({ id: 'catalog', from: 'ssot__AbnExperimentLog__dlm', extra: { creationType: 'Standard', status: 'INACTIVE' } }),
            relationship({ id: 'standardActive', from: 'ssot__ContactPointEmail__dlm', fromField: 'ssot__PartyId__c', extra: { creationType: 'Standard' } }),
            relationship({ id: 'customInactive', extra: { status: 'INACTIVE' } }),
            relationship({ id: 'deactivated', from: 'Survey_Answer__dlm', extra: { status: 'DEACTIVATEDBYUSER', cardinality: 'OneToOne' } }),
          ],
        },
      });
      const rows = await fetchDataCloudRelationships(conn, ['ssot__Individual__dlm'], {});
      expect(rows.map((r) => r['Name'])).to.have.members(['standardActive', 'customInactive', 'deactivated']);
      const deactivated = rows.find((r) => r['Name'] === 'deactivated')!;
      expect(deactivated['Status']).to.equal('DEACTIVATEDBYUSER');
      expect(deactivated['Cardinality']).to.equal('One to One');
    });

    it('lists a relationship shared by two documented DMOs once', async () => {
      const shared = relationship({ id: 'shared' });
      const { conn } = dataCloudConn({ relationships: { 'ssot__Individual__dlm': [shared], 'Crm_Order__dlm': [shared] } });
      const rows = await fetchDataCloudRelationships(conn, ['ssot__Individual__dlm', 'Crm_Order__dlm'], {});
      expect(rows).to.have.length(1);
    });

    it('follows offset paging until totalSize', async () => {
      const many = Array.from({ length: 501 }, (_, i) => relationship({ id: `rel${i}`, fromField: `Field${i}__c` }));
      const { conn, calls } = dataCloudConn({ relationships: { 'ssot__Individual__dlm': many } });
      const rows = await fetchDataCloudRelationships(conn, ['ssot__Individual__dlm'], {});
      expect(rows).to.have.length(501);
      expect(calls[1]).to.contain('offset=500');
    });

    it('follows offset paging until an empty page when totalSize is missing', async () => {
      const many = Array.from({ length: 501 }, (_, i) => relationship({ id: `rel${i}`, fromField: `Field${i}__c` }));
      const { conn, calls } = dataCloudConn({ relationships: { 'ssot__Individual__dlm': many }, omitTotalSize: true });
      const rows = await fetchDataCloudRelationships(conn, ['ssot__Individual__dlm'], {});
      expect(rows).to.have.length(501);
      expect(calls).to.have.length(3);
    });

    it('stops at the page cap and flags the listing as truncated', async () => {
      const many = Array.from({ length: 10_001 }, (_, i) => relationship({ id: `rel${i}`, fromField: `Field${i}__c` }));
      const { conn } = dataCloudConn({ relationships: { 'ssot__Individual__dlm': many } });
      const result = await getDataModelObjectRelationships(conn, 'ssot__Individual__dlm');
      expect(result.truncated).to.equal(true);
      expect(result.relationships).to.have.length(10_000);
    });

    it('reads the relationships of several DMOs in parallel and keeps a stable order', async () => {
      const { conn } = dataCloudConn({
        relationships: {
          'B__dlm': [relationship({ id: 'b', from: 'B__dlm', to: 'Z__dlm' })],
          'A__dlm': [relationship({ id: 'a', from: 'A__dlm', to: 'Z__dlm' })],
        },
      });
      const rows = await fetchDataCloudRelationships(conn, ['B__dlm', 'A__dlm'], {});
      expect(rows.map((r) => r['Name'])).to.deep.equal(['a', 'b']);
    });

    it('logs and skips a DMO whose relationships cannot be read', async () => {
      const conn: any = { baseUrl: () => BASE_URL, request: async () => { throw new Error('boom'); } };
      const rows = await fetchDataCloudRelationships(conn, ['ssot__Individual__dlm'], {});
      expect(rows).to.deep.equal([]);
    });
  });

  describe('buildDataCloudRelationshipRow()', () => {
    it('marks relationships to CRM objects', () => {
      const row = buildDataCloudRelationshipRow(
        relationship({ id: 'crm', from: 'ssot__Individual__dlm', fromField: 'Crm_Account_Id__c', to: 'Account', toField: 'Id', toType: 'SObjectField' })
      );
      expect(row).to.deep.equal({
        'From Object': 'ssot__Individual__dlm',
        'From Field': 'Crm_Account_Id__c',
        'From Object Type': 'Data Model Object',
        'To Object': 'Account',
        'To Field': 'Id',
        'To Object Type': 'CRM Object',
        'Cardinality': 'Many to One',
        'Status': 'ACTIVE',
        'Origin': 'Custom',
        'Name': 'crm',
      });
    });

    it('marks a CRM object on the source side', () => {
      const crmSource = relationship({ id: 'crmSource', from: 'Account', fromField: 'Id', to: 'ssot__Individual__dlm', toField: 'Crm_Account_Id__c' });
      crmSource.sourceField.type = 'SObjectField';
      const row = buildDataCloudRelationshipRow(crmSource);
      expect(row['From Object Type']).to.equal('CRM Object');
      expect(row['To Object Type']).to.equal('Data Model Object');
    });
  });
});
