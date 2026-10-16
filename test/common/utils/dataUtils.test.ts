import { expect } from 'chai';
import {
  buildDataWorkspaceObjectsSummary,
  getOrgInstanceDomain,
  isSfdmuProductionOrg,
  resolveSfdmuCanModify,
  SfdmuCanModifyDeps,
} from '../../../src/common/utils/dataUtils.js';

const USERNAME = 'admin@acme.com';

// Fake connection answering the Organization query with the given record
function fakeConn(organization: any, instanceUrl = 'https://acme.my.salesforce.com'): any {
  return {
    username: USERNAME,
    instanceUrl,
    query: async () => ({ done: true, records: [organization] }),
  };
}

// Fake environment where questions are allowed: records the questions and gives the answer
function interactiveDeps(answer: boolean): SfdmuCanModifyDeps & { questions: any[] } {
  const questions: any[] = [];
  return {
    questions,
    canPrompt: () => true,
    ask: async (question: any) => {
      questions.push(question);
      return { value: answer };
    },
  };
}

// Fake connection that fails the test if the org is queried
function unqueriedConn(): any {
  return {
    username: USERNAME,
    instanceUrl: 'https://acme.my.salesforce.com',
    query: async () => {
      throw new Error('The org must not be queried');
    },
  };
}

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

  describe('isSfdmuProductionOrg', () => {
    it('is true for a production org', async () => {
      const conn = fakeConn({ IsSandbox: false, OrganizationType: 'Enterprise Edition' });
      expect(await isSfdmuProductionOrg(null, USERNAME, { conn })).to.equal(true);
    });

    it('is false for a sandbox', async () => {
      const conn = fakeConn({ IsSandbox: true, OrganizationType: 'Enterprise Edition' });
      expect(await isSfdmuProductionOrg(null, USERNAME, { conn })).to.equal(false);
    });

    it('is false for a Developer Edition org, as in SFDMU', async () => {
      const conn = fakeConn({ IsSandbox: false, OrganizationType: 'Developer Edition' });
      expect(await isSfdmuProductionOrg(null, USERNAME, { conn })).to.equal(false);
    });
  });

  describe('getOrgInstanceDomain', () => {
    it('returns the lower case host name of the instance URL, the value SFDMU compares --canmodify with', async () => {
      const conn = fakeConn({}, 'https://ACME.my.salesforce.com/');
      expect(await getOrgInstanceDomain(null, USERNAME, { conn })).to.equal('acme.my.salesforce.com');
    });

    it('returns an empty string when the instance URL is not valid', async () => {
      const conn = fakeConn({}, 'not an url');
      expect(await getOrgInstanceDomain(null, USERNAME, { conn })).to.equal('');
    });
  });

  describe('resolveSfdmuCanModify', () => {
    let previousSfdmuCanModify: string | undefined;

    beforeEach(() => {
      previousSfdmuCanModify = process.env.SFDMU_CAN_MODIFY;
      delete process.env.SFDMU_CAN_MODIFY;
    });

    afterEach(() => {
      if (previousSfdmuCanModify === undefined) {
        delete process.env.SFDMU_CAN_MODIFY;
      }
      else {
        process.env.SFDMU_CAN_MODIFY = previousSfdmuCanModify;
      }
    });

    it('returns SFDMU_CAN_MODIFY without querying the org nor prompting', async () => {
      process.env.SFDMU_CAN_MODIFY = 'acme.my.salesforce.com';
      const canModify = await resolveSfdmuCanModify(null, USERNAME, { conn: unqueriedConn(), promptConfirm: true });
      expect(canModify).to.equal('acme.my.salesforce.com');
    });

    it('authorizes nothing without querying the org when prompts are not allowed', async () => {
      const canModify = await resolveSfdmuCanModify(null, USERNAME, { conn: unqueriedConn(), promptConfirm: false });
      expect(canModify).to.equal('');
    });

    it('authorizes nothing without querying the org in CI or agent mode', async () => {
      const deps = { ...interactiveDeps(true), canPrompt: () => false };
      const canModify = await resolveSfdmuCanModify(null, USERNAME, { conn: unqueriedConn(), promptConfirm: true }, undefined, deps);
      expect(canModify).to.equal('');
      expect(deps.questions).to.have.length(0);
    });

    it('returns the instance domain of a production org once the user confirmed', async () => {
      const conn = fakeConn({ IsSandbox: false, OrganizationType: 'Enterprise Edition' }, 'https://ACME.my.salesforce.com');
      const deps = interactiveDeps(true);
      const canModify = await resolveSfdmuCanModify(null, USERNAME, { conn, promptConfirm: true }, undefined, deps);
      expect(canModify).to.equal('acme.my.salesforce.com');
      expect(deps.questions).to.have.length(1);
      expect(deps.questions[0].type).to.equal('confirm');
      expect(deps.questions[0].message).to.include('acme.my.salesforce.com');
      expect(deps.questions[0].description).to.include('acme.my.salesforce.com');
      expect(deps.questions[0].description).to.not.include('{{');
    });

    it('stops the data operation when the user does not confirm', async () => {
      const conn = fakeConn({ IsSandbox: false, OrganizationType: 'Enterprise Edition' });
      const deps = interactiveDeps(false);
      let error: any = null;
      try {
        await resolveSfdmuCanModify(null, USERNAME, { conn, promptConfirm: true }, undefined, deps);
      }
      catch (e) {
        error = e;
      }
      expect(error?.message).to.equal('Data operation cancelled by user');
    });

    it('does not ask anything for a sandbox', async () => {
      const conn = fakeConn({ IsSandbox: true, OrganizationType: 'Enterprise Edition' });
      const deps = interactiveDeps(true);
      const canModify = await resolveSfdmuCanModify(null, USERNAME, { conn, promptConfirm: true }, undefined, deps);
      expect(canModify).to.equal('');
      expect(deps.questions).to.have.length(0);
    });

    it('does not ask anything for a Developer Edition org', async () => {
      const conn = fakeConn({ IsSandbox: false, OrganizationType: 'Developer Edition' });
      const deps = interactiveDeps(true);
      const canModify = await resolveSfdmuCanModify(null, USERNAME, { conn, promptConfirm: true }, undefined, deps);
      expect(canModify).to.equal('');
      expect(deps.questions).to.have.length(0);
    });

    it('does not query the org again when the caller already knows it is not a production org', async () => {
      const deps = interactiveDeps(true);
      const canModify = await resolveSfdmuCanModify(null, USERNAME, { conn: unqueriedConn(), promptConfirm: true }, false, deps);
      expect(canModify).to.equal('');
      expect(deps.questions).to.have.length(0);
    });
  });
});
