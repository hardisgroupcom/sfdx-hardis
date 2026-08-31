import { expect } from 'chai';
import { DocBuilderAura } from '../../../src/common/docBuilder/docBuilderAura.js';

const AURA_DESCRIPTIONS = [
  {
    name: 'accountSummary',
    type: 'Component',
    description: 'Shows a summary of the account',
    apexControllers: ['AccountSummaryController'],
    docPath: 'accountSummary.md',
    impactedObjects: ['Account'],
  },
  {
    name: 'salesConsole',
    type: 'Application',
    description: 'Sales console application',
    apexControllers: [],
    docPath: 'salesConsole.md',
    impactedObjects: [],
  },
];

describe('DocBuilderAura', () => {
  describe('buildIndexTable()', () => {
    it('lists the bundles with their type, description and Apex controllers', () => {
      const lines = DocBuilderAura.buildIndexTable('', AURA_DESCRIPTIONS);

      expect(lines[0]).to.equal('## Aura Components');
      expect(lines[2]).to.equal('| Aura Component | Type | Description | Apex Controllers |');
      expect(lines[4]).to.equal('| [accountSummary](accountSummary.md) | Component | Shows a summary of the account | AccountSummaryController |');
      expect(lines[5]).to.equal('| [salesConsole](salesConsole.md) | Application | Sales console application |  |');
    });

    it('keeps only the bundles impacting the filtered object and prefixes the links', () => {
      const lines = DocBuilderAura.buildIndexTable('../aura/', AURA_DESCRIPTIONS, 'Account');

      expect(lines[0]).to.equal('## Related Aura Components');
      expect(lines.filter(line => line.startsWith('| ['))).to.deep.equal([
        '| [accountSummary](../aura/accountSummary.md) | Component | Shows a summary of the account | AccountSummaryController |',
      ]);
    });

    it('returns nothing when no bundle impacts the filtered object', () => {
      expect(DocBuilderAura.buildIndexTable('', AURA_DESCRIPTIONS, 'Opportunity')).to.deep.equal([]);
    });
  });

  describe('getTypeLabel()', () => {
    it('derives the kind of Aura metadata from the extension of its meta file', () => {
      expect(DocBuilderAura.getTypeLabel('force-app/aura/myCmp/myCmp.cmp-meta.xml')).to.equal('Component');
      expect(DocBuilderAura.getTypeLabel('force-app/aura/myApp/myApp.app-meta.xml')).to.equal('Application');
      expect(DocBuilderAura.getTypeLabel('force-app/aura/myEvt/myEvt.evt-meta.xml')).to.equal('Event');
      expect(DocBuilderAura.getTypeLabel('force-app/aura/myIntf/myIntf.intf-meta.xml')).to.equal('Interface');
      expect(DocBuilderAura.getTypeLabel('force-app/aura/myTokens/myTokens.tokens-meta.xml')).to.equal('Tokens');
    });

    it('falls back to Component for an unknown extension', () => {
      expect(DocBuilderAura.getTypeLabel('force-app/aura/myCmp/myCmp.unknown-meta.xml')).to.equal('Component');
    });
  });
});
