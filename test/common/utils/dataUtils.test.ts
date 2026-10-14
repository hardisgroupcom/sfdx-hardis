import { expect } from 'chai';
import { buildDataWorkspaceObjectsSummary } from '../../../src/common/utils/dataUtils.js';

describe('dataUtils', () => {
  describe('buildDataWorkspaceObjectsSummary', () => {
    it('summarizes what sfdmu will do with each object', () => {
      const summary = buildDataWorkspaceObjectsSummary({
        objects: [
          {
            query: 'SELECT Id, Name, Email__c FROM Account',
            operation: 'Update',
            externalId: 'Id',
            updateWithMockData: true,
            mockFields: [{ name: 'Email__c', pattern: 'email' }, { name: 'Certified_email_PEC__c', pattern: 'email' }],
          },
          {
            query: "SELECT Id, Name FROM Case WHERE Status = 'Closed' AND IsDeleted = false ORDER BY CreatedDate",
            operation: 'Insert',
            externalId: 'Name',
          },
          { query: 'SELECT Id FROM Contact', deleteFromSource: true },
        ],
      });

      expect(summary).to.deep.equal([
        {
          Object: 'Account',
          Operation: 'Update',
          'External Id': 'Id',
          Filter: '',
          'Mock fields': 'Email__c, Certified_email_PEC__c',
        },
        {
          Object: 'Case',
          Operation: 'Insert',
          'External Id': 'Name',
          Filter: "Status = 'Closed' AND IsDeleted = false",
          'Mock fields': '',
        },
        { Object: 'Contact', Operation: 'DeleteSource', 'External Id': '', Filter: '', 'Mock fields': '' },
      ]);
    });

    it('truncates long filters and defaults the operation to Readonly', () => {
      const longFilter = `Name LIKE '%${'a'.repeat(80)}%'`;
      const summary = buildDataWorkspaceObjectsSummary({
        objects: [{ query: `SELECT Id FROM Opportunity WHERE ${longFilter}` }],
      });
      expect(summary[0].Operation).to.equal('Readonly');
      expect(summary[0].Filter).to.have.lengthOf(60);
      expect(summary[0].Filter.endsWith('...')).to.equal(true);
    });

    it('returns an empty list when the workspace has no object', () => {
      expect(buildDataWorkspaceObjectsSummary({})).to.deep.equal([]);
      expect(buildDataWorkspaceObjectsSummary(null)).to.deep.equal([]);
    });
  });
});
