import { expect } from 'chai';
import {
  buildCustomFieldLookupSoql,
  buildLookupSoql,
  buildUsedBySoql,
  customFieldDeveloperName,
  isMetadataType,
  isSalesforceId,
  mapUsedByRows,
  parseCustomFieldName,
  sanitizeFsName,
  soqlString,
  stripCustomSuffix,
} from '../../../src/common/utils/metadataDepsUtils.js';

describe('metadataDepsUtils', () => {
  describe('lookup SOQL', () => {
    it('uses Name for Apex metadata', () => {
      const query = buildLookupSoql('ApexClass', "My'Class");
      expect(query).to.equal("SELECT Id, Name FROM ApexClass WHERE Name = 'My\\'Class'");
    });

    for (const type of [
      'Flow',
      'AuraDefinitionBundle',
      'LightningComponentBundle',
      'FlexiPage',
      'CustomPermission',
    ]) {
      it(`uses DeveloperName for ${type}`, () => {
        const query = buildLookupSoql(type, 'MyComponent');
        expect(query).to.contain(`FROM ${type} WHERE DeveloperName = 'MyComponent'`);
        expect(query).not.to.contain('WHERE Name');
      });
    }

    it('strips the __c suffix for CustomObject', () => {
      expect(stripCustomSuffix('MyObject__c')).to.equal('MyObject');
      expect(buildLookupSoql('CustomObject', 'MyObject__c')).to.contain("DeveloperName = 'MyObject'");
    });

    it('escapes SOQL backslashes and quotes', () => {
      expect(soqlString("A\\B'C")).to.equal("'A\\\\B\\'C'");
    });
  });

  describe('CustomField lookup', () => {
    it('splits an object-qualified custom field', () => {
      expect(parseCustomFieldName('Account.Status__c')).to.deep.equal({
        table: 'Account',
        developerName: 'Status',
      });
    });

    it('supports an unqualified namespaced custom field', () => {
      expect(customFieldDeveloperName('ns__Status__c')).to.equal('Status');
      expect(parseCustomFieldName('Amount__c')).to.deep.equal({ developerName: 'Amount' });
    });

    it('filters by DeveloperName and object keys without FullName', () => {
      const query = buildCustomFieldLookupSoql('Status', ['Account', '01I000000000001']);
      expect(query).to.contain("DeveloperName = 'Status'");
      expect(query).to.contain("TableEnumOrId = 'Account'");
      expect(query).to.contain("EntityDefinitionId = '01I000000000001'");
      expect(query).not.to.contain('FullName');
    });
  });

  describe('used-by SOQL', () => {
    it('filters the referenced component and dependent type', () => {
      const query = buildUsedBySoql('01pxx0000000001AAA', 'ApexClass', 'Flow');
      expect(query).to.contain("RefMetadataComponentId = '01pxx0000000001AAA'");
      expect(query).to.contain("RefMetadataComponentType = 'ApexClass'");
      expect(query).to.contain("MetadataComponentType = 'Flow'");
    });

    it('does not filter RefMetadataComponentType for StandardEntity', () => {
      const query = buildUsedBySoql('01Ixx0000000001AAA', 'StandardEntity');
      expect(query).not.to.contain('RefMetadataComponentType =');
    });

    it('maps the Tooling direction to used-by columns', () => {
      expect(
        mapUsedByRows([
          {
            MetadataComponentId: '301A',
            MetadataComponentName: 'UsesTarget',
            MetadataComponentType: 'Flow',
            RefMetadataComponentId: '01pA',
            RefMetadataComponentName: 'Target',
            RefMetadataComponentType: 'ApexClass',
          },
        ])
      ).to.deep.equal([
        {
          usedById: '301A',
          usedByName: 'UsesTarget',
          usedByType: 'Flow',
          targetId: '01pA',
          targetName: 'Target',
          targetType: 'ApexClass',
        },
      ]);
    });
  });

  describe('validation and paths', () => {
    it('validates Salesforce Ids', () => {
      expect(isSalesforceId('01pxx0000000001')).to.equal(true);
      expect(isSalesforceId('01pxx0000000001AAA')).to.equal(true);
      expect(isSalesforceId('not-an-id')).to.equal(false);
    });

    it('validates metadata type identifiers', () => {
      expect(isMetadataType('LightningComponentBundle')).to.equal(true);
      expect(isMetadataType('Bad Type')).to.equal(false);
    });

    it('sanitizes Windows path characters and bounds length', () => {
      expect(sanitizeFsName('Account<>:"/\\|?*Status')).to.equal('Account_________Status');
      expect(sanitizeFsName('a'.repeat(120))).to.have.length(100);
      expect(sanitizeFsName('___')).to.equal('unknown');
      expect(sanitizeFsName(`A${String.fromCharCode(1)}B`)).to.equal('A_B');
    });
  });
});
