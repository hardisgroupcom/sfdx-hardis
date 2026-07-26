import { strict as assert } from 'assert';
import {
  anonymizeApiPayloadData,
  buildPseudonym,
  shouldAnonymizeApiData,
} from '../../../src/common/notifProvider/apiAnonymizer.js';

describe('apiAnonymizer', () => {
  afterEach(() => {
    delete process.env.NOTIF_API_ANONYMIZE;
  });

  describe('shouldAnonymizeApiData', () => {
    it('is forced on with NOTIF_API_ANONYMIZE=true', () => {
      process.env.NOTIF_API_ANONYMIZE = 'true';
      assert.equal(shouldAnonymizeApiData(), true);
    });

    it('is forced off with NOTIF_API_ANONYMIZE=false', () => {
      process.env.NOTIF_API_ANONYMIZE = 'false';
      assert.equal(shouldAnonymizeApiData(), false);
    });
  });

  describe('buildPseudonym', () => {
    it('is stable for the same value and org', () => {
      assert.equal(buildPseudonym('jane.doe@acme.com', 'org1'), buildPseudonym('jane.doe@acme.com', 'org1'));
    });

    it('differs across orgs (org-salted)', () => {
      assert.notEqual(buildPseudonym('jane.doe@acme.com', 'org1'), buildPseudonym('jane.doe@acme.com', 'org2'));
    });

    it('has the expected user_ prefix and length', () => {
      const pseudonym = buildPseudonym('jane.doe@acme.com', 'org1');
      assert.match(pseudonym, /^user_[0-9a-f]{10}$/);
    });
  });

  describe('anonymizeApiPayloadData', () => {
    it('anonymizes user rows (unused users shape) but keeps LastLoginDate and profile fields', () => {
      const data = {
        metric: 1,
        _logElements: [
          {
            Id: '0050600000AAAA',
            LastLoginDate: '2026-01-01T00:00:00.000Z',
            LastName: 'Doe',
            FirstName: 'Jane',
            'Profile.UserLicense.Name': 'Salesforce',
            'Profile.Name': 'System Administrator',
            Username: 'jane.doe@acme.com',
            IsActive: 'true',
          },
        ],
        _title: 'Inactive users',
        _logBodyText: 'User jane.doe@acme.com (Jane Doe) has not logged in',
      };
      const result = anonymizeApiPayloadData(data, 'org1');
      const row = result._logElements[0];
      assert.match(row.Username, /^user_/);
      assert.match(row.LastName, /^user_/);
      assert.match(row.FirstName, /^user_/);
      // Not sensitive
      assert.equal(row.LastLoginDate, '2026-01-01T00:00:00.000Z');
      assert.equal(row['Profile.UserLicense.Name'], 'Salesforce');
      assert.equal(row['Profile.Name'], 'System Administrator');
      assert.equal(row.Id, '0050600000AAAA');
      // Text scrubbing
      assert.ok(!result._logBodyText.includes('jane.doe@acme.com'));
      assert.ok(!result._logBodyText.includes('Jane Doe'));
      // Stable mapping between rows and text
      assert.ok(result._logBodyText.includes(row.Username));
    });

    it('keeps actor fields raw (audit trail shape)', () => {
      const data = {
        _logElements: [
          {
            'CreatedBy.Username': 'admin@acme.com',
            'CreatedBy.Name': 'Alice Admin',
            DelegateUser: 'delegate@acme.com',
            Action: 'changedPassword',
            Section: 'Manage Users',
          },
        ],
        _logBodyText: 'Suspect action by Alice Admin',
      };
      const result = anonymizeApiPayloadData(data, 'org1');
      const row = result._logElements[0];
      assert.equal(row['CreatedBy.Username'], 'admin@acme.com');
      assert.equal(row['CreatedBy.Name'], 'Alice Admin');
      assert.equal(row.DelegateUser, 'delegate@acme.com');
      assert.equal(result._logBodyText, 'Suspect action by Alice Admin');
    });

    it('anonymizes end-user fields on error rows (apex/flow errors shape)', () => {
      const data = {
        _logElements: [
          {
            Source: 'FlowInterview',
            Operation: 'My Flow',
            UserName: 'enduser@acme.com',
            UserEmail: 'enduser@acme.com',
            Exception: 'Some error',
          },
        ],
      };
      const result = anonymizeApiPayloadData(data, 'org1');
      const row = result._logElements[0];
      assert.match(row.UserName, /^user_/);
      assert.match(row.UserEmail, /^user_/);
      assert.equal(row.Operation, 'My Flow');
    });

    it('does not anonymize a bare Name field on rows without user identity (flow lists)', () => {
      const data = {
        _logElements: [{ Name: 'My_Flow', Status: 'Draft' }],
      };
      const result = anonymizeApiPayloadData(data, 'org1');
      assert.equal(result._logElements[0].Name, 'My_Flow');
    });

    it('anonymizes a bare Name field on rows that carry a Username', () => {
      const data = {
        _logElements: [{ Name: 'Jane Doe', Username: 'jane.doe@acme.com' }],
      };
      const result = anonymizeApiPayloadData(data, 'org1');
      assert.match(result._logElements[0].Name, /^user_/);
    });

    it('leaves data without _logElements untouched', () => {
      const data = { metric: 5, _title: 'Some title' };
      const result = anonymizeApiPayloadData(data, 'org1');
      assert.deepEqual(result, data);
    });

    it('handles nested objects in log elements', () => {
      const data = {
        _logElements: [{ LastModifiedBy: { Name: 'Bob Admin', Username: 'bob@acme.com' }, Other: { Username: 'x@acme.com' } }],
      };
      const result = anonymizeApiPayloadData(data, 'org1');
      // Actor path stays raw
      assert.equal(result._logElements[0].LastModifiedBy.Name, 'Bob Admin');
      assert.equal(result._logElements[0].LastModifiedBy.Username, 'bob@acme.com');
      // Non-actor nested username is anonymized
      assert.match(result._logElements[0].Other.Username, /^user_/);
    });
  });
});
