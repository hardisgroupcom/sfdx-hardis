import { expect } from 'chai';
import { DocBuilderVisualforce } from '../../../src/common/docBuilder/docBuilderVisualforce.js';

const VISUALFORCE_DESCRIPTIONS = [
  {
    name: 'AccountSummary',
    type: 'Page',
    label: 'Account Summary',
    apexControllers: ['AccountSummaryController', 'AccountSummaryExtension'],
    docPath: 'AccountSummary.md',
    impactedObjects: ['Account'],
  },
  {
    name: 'AddressBlock',
    type: 'Component',
    label: 'Address Block',
    apexControllers: [],
    docPath: 'AddressBlock-component.md',
    impactedObjects: ['Contact'],
  },
];

describe('DocBuilderVisualforce', () => {
  describe('buildIndexTable()', () => {
    it('lists pages and components with their own documentation path', () => {
      const lines = DocBuilderVisualforce.buildIndexTable('', VISUALFORCE_DESCRIPTIONS);

      expect(lines[0]).to.equal('## Visualforce');
      expect(lines[2]).to.equal('| Visualforce | Type | Label | Apex Controllers |');
      expect(lines[4]).to.equal('| [AccountSummary](AccountSummary.md) | Page | Account Summary | AccountSummaryController, AccountSummaryExtension |');
      expect(lines[5]).to.equal('| [AddressBlock](AddressBlock-component.md) | Component | Address Block |  |');
    });

    it('keeps only the items impacting the filtered object and prefixes the links', () => {
      const lines = DocBuilderVisualforce.buildIndexTable('../visualforce/', VISUALFORCE_DESCRIPTIONS, 'Account');

      expect(lines[0]).to.equal('## Related Visualforce');
      expect(lines.filter(line => line.startsWith('| ['))).to.deep.equal([
        '| [AccountSummary](../visualforce/AccountSummary.md) | Page | Account Summary | AccountSummaryController, AccountSummaryExtension |',
      ]);
    });

    it('returns nothing when no item impacts the filtered object', () => {
      expect(DocBuilderVisualforce.buildIndexTable('', VISUALFORCE_DESCRIPTIONS, 'Opportunity')).to.deep.equal([]);
    });
  });

  describe('parseMarkupAttributes()', () => {
    it('reads the attributes of the markup root tag', () => {
      const markup = `<apex:page standardController="Account" extensions="Ext1,Ext2" showHeader="false">
  <c:Other someAttribute="ignored" />
</apex:page>`;

      expect(DocBuilderVisualforce.parseMarkupAttributes(markup, 'apex:page')).to.deep.equal({
        standardController: 'Account',
        extensions: 'Ext1,Ext2',
        showHeader: 'false',
      });
    });

    it('returns an empty object when the markup is missing or has no root tag', () => {
      expect(DocBuilderVisualforce.parseMarkupAttributes('', 'apex:page')).to.deep.equal({});
      expect(DocBuilderVisualforce.parseMarkupAttributes('<div/>', 'apex:page')).to.deep.equal({});
    });
  });

  describe('listApexControllers()', () => {
    it('merges the controller and the extensions, without duplicates', () => {
      expect(DocBuilderVisualforce.listApexControllers({ controller: 'MyController', extensions: 'Ext1, MyController , Ext2' }))
        .to.deep.equal(['MyController', 'Ext1', 'Ext2']);
    });

    it('returns an empty list when the markup declares no Apex', () => {
      expect(DocBuilderVisualforce.listApexControllers({ standardController: 'Account' })).to.deep.equal([]);
    });
  });
});
