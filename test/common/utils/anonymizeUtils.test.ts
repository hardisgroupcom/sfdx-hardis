import { strict as assert } from 'assert';
import {
  anonymizeData,
  anonymizeNotifMessage,
  anonymizeRows,
  buildPseudonym,
  getAnonymizationLevel,
  getChannelAnonymizationLevel,
  markRowSensitiveValues,
  resetAnonymizationCache,
  SENSITIVE_VALUES_KEY,
  stripSensitiveValues,
} from '../../../src/common/utils/anonymizeUtils.js';
import { ApiProvider } from '../../../src/common/notifProvider/apiProvider.js';
import type { NotifMessage } from '../../../src/common/notifProvider/types.js';

const SALT = 'org1';

describe('anonymizeUtils', () => {
  beforeEach(() => {
    resetAnonymizationCache();
  });

  afterEach(() => {
    delete process.env.SFDX_HARDIS_ANONYMIZE;
    delete process.env.NOTIF_API_ANONYMIZE;
    resetAnonymizationCache();
  });

  describe('getAnonymizationLevel', () => {
    it('honors SFDX_HARDIS_ANONYMIZE values', async () => {
      process.env.SFDX_HARDIS_ANONYMIZE = 'off';
      assert.equal(await getAnonymizationLevel(), 'off');
      process.env.SFDX_HARDIS_ANONYMIZE = 'standard';
      assert.equal(await getAnonymizationLevel(), 'standard');
      process.env.SFDX_HARDIS_ANONYMIZE = 'strict';
      assert.equal(await getAnonymizationLevel(), 'strict');
      process.env.SFDX_HARDIS_ANONYMIZE = 'true';
      assert.equal(await getAnonymizationLevel(), 'standard');
      process.env.SFDX_HARDIS_ANONYMIZE = 'false';
      assert.equal(await getAnonymizationLevel(), 'off');
    });

    it('honors the deprecated NOTIF_API_ANONYMIZE alias', async () => {
      process.env.NOTIF_API_ANONYMIZE = 'true';
      assert.equal(await getAnonymizationLevel(), 'standard');
      resetAnonymizationCache();
      process.env.NOTIF_API_ANONYMIZE = 'false';
      assert.equal(await getAnonymizationLevel(), 'off');
    });

    it('gives SFDX_HARDIS_ANONYMIZE priority over the deprecated alias', async () => {
      process.env.SFDX_HARDIS_ANONYMIZE = 'strict';
      process.env.NOTIF_API_ANONYMIZE = 'false';
      assert.equal(await getAnonymizationLevel(), 'strict');
    });

    it('channel level never goes below the global level', async () => {
      process.env.SFDX_HARDIS_ANONYMIZE = 'strict';
      assert.equal(await getChannelAnonymizationLevel('files'), 'strict');
      assert.equal(await getChannelAnonymizationLevel('api'), 'strict');
      assert.equal(await getChannelAnonymizationLevel('email'), 'strict');
      assert.equal(await getChannelAnonymizationLevel('messaging'), 'strict');
    });

    it('defaults to standard in CI and off in local runs', async () => {
      resetAnonymizationCache({});
      assert.equal(await getAnonymizationLevel(true), 'standard');
      assert.equal(await getAnonymizationLevel(false), 'off');
    });

    it('ignores the config file in local runs unless enforceLocally is set', async () => {
      // An admin-committed strict config must not anonymize local logs and reports
      resetAnonymizationCache({ level: 'strict', channels: { email: 'strict' } });
      assert.equal(await getAnonymizationLevel(false), 'off');
      assert.equal(await getChannelAnonymizationLevel('email', false), 'off');
      // The same config applies to CI runs
      assert.equal(await getAnonymizationLevel(true), 'strict');
      // enforceLocally makes local runs behave like CI runs
      resetAnonymizationCache({ level: 'strict', channels: {}, enforceLocally: true });
      assert.equal(await getAnonymizationLevel(false), 'strict');
    });

    it('applies config channel raises in CI', async () => {
      resetAnonymizationCache({ level: 'standard', channels: { email: 'strict' } });
      assert.equal(await getChannelAnonymizationLevel('email', true), 'strict');
      assert.equal(await getChannelAnonymizationLevel('messaging', true), 'standard');
    });

    it('env var off disables everything, including config channel raises', async () => {
      process.env.SFDX_HARDIS_ANONYMIZE = 'off';
      resetAnonymizationCache({ level: 'strict', channels: { email: 'strict' }, enforceLocally: true });
      assert.equal(await getChannelAnonymizationLevel('email', true), 'off');
    });

    it('env var set locally enables anonymization without enforceLocally', async () => {
      process.env.SFDX_HARDIS_ANONYMIZE = 'standard';
      resetAnonymizationCache({ channels: { email: 'strict' } });
      assert.equal(await getAnonymizationLevel(false), 'standard');
      // An explicitly anonymized local run also honors the config channel raises
      assert.equal(await getChannelAnonymizationLevel('email', false), 'strict');
    });
  });

  describe('buildPseudonym', () => {
    it('is stable for the same value and salt', () => {
      assert.equal(buildPseudonym('jane.doe@acme.com', 'user', 'org1'), buildPseudonym('jane.doe@acme.com', 'user', 'org1'));
    });

    it('differs across salts (org-salted)', () => {
      assert.notEqual(buildPseudonym('jane.doe@acme.com', 'user', 'org1'), buildPseudonym('jane.doe@acme.com', 'user', 'org2'));
    });

    it('uses the kind as prefix', () => {
      assert.match(buildPseudonym('jane.doe@acme.com', 'user', SALT), /^user_[0-9a-f]{10}$/);
      assert.match(buildPseudonym('0057Q000001abcd', 'id', SALT), /^id_[0-9a-f]{10}$/);
      assert.match(buildPseudonym('10.20.30.40', 'ip', SALT), /^ip_[0-9a-f]{10}$/);
    });

    it('never re-hashes an existing pseudonym (idempotency guard)', () => {
      const pseudonym = buildPseudonym('jane.doe@acme.com', 'user', SALT);
      assert.equal(buildPseudonym(pseudonym, 'user', SALT), pseudonym);
      assert.equal(buildPseudonym(pseudonym, 'id', SALT), pseudonym);
    });
  });

  describe('anonymizeRows - standard level', () => {
    it('anonymizes user rows (unused users shape) and hashes the 005 user Id', () => {
      const rows = [
        {
          Id: '0057Q000001abcdQAA',
          LastLoginDate: '2026-01-01T00:00:00.000Z',
          LastName: 'Doe',
          FirstName: 'Jane',
          'Profile.UserLicense.Name': 'Salesforce',
          'Profile.Name': 'System Administrator',
          Username: 'jane.doe@acme.com',
          IsActive: 'true',
        },
      ];
      const map = new Map<string, string>();
      const [row] = anonymizeRows(rows, 'standard', map, SALT);
      assert.match(row.Username, /^user_/);
      assert.match(row.LastName, /^user_/);
      assert.match(row.FirstName, /^user_/);
      assert.match(row.Id, /^id_/);
      // Not sensitive
      assert.equal(row.LastLoginDate, '2026-01-01T00:00:00.000Z');
      assert.equal(row['Profile.UserLicense.Name'], 'Salesforce');
      assert.equal(row['Profile.Name'], 'System Administrator');
      // First/Last combos registered for text scrubbing
      assert.ok(map.has('Jane Doe'));
      assert.ok(map.has('Doe Jane'));
      // Input rows are never mutated
      assert.equal(rows[0].Username, 'jane.doe@acme.com');
      assert.equal(rows[0].Id, '0057Q000001abcdQAA');
    });

    it('does not hash non-user Salesforce Ids', () => {
      const rows = [{ Id: '00D7Q0000012345UAA', DeploymentId: '0Af7Q00000Abc12SAC', Status: 'Succeeded' }];
      const [row] = anonymizeRows(rows, 'standard', new Map(), SALT);
      assert.equal(row.Id, '00D7Q0000012345UAA');
      assert.equal(row.DeploymentId, '0Af7Q00000Abc12SAC');
    });

    it('anonymizes legacy API rows: USER_ID, CLIENT_IP and CLIENT_HOSTNAME', () => {
      const rows = [
        {
          USER_ID: '0057Q000001abcd',
          CLIENT_IP: '203.0.113.42',
          CLIENT_HOSTNAME: 'host.acme.com',
          API_VERSION: '20.0',
        },
      ];
      const [row] = anonymizeRows(rows, 'standard', new Map(), SALT);
      assert.match(row.USER_ID, /^id_/);
      assert.match(row.CLIENT_IP, /^ip_/);
      assert.match(row.CLIENT_HOSTNAME, /^ip_/);
      assert.equal(row.API_VERSION, '20.0');
    });

    it('keeps actor fields raw at standard level (audit trail shape)', () => {
      const rows = [
        {
          'CreatedBy.Username': 'admin@acme.com',
          'CreatedBy.Name': 'Alice Admin',
          DelegateUser: 'delegate@acme.com',
          Action: 'changedPassword',
        },
        { DeployedBy: 'Alice Admin', Status: 'Succeeded' },
        { TriggeredBy: 'Alice Admin', Username: 'enduser@acme.com' },
      ];
      const result = anonymizeRows(rows, 'standard', new Map(), SALT);
      assert.equal(result[0]['CreatedBy.Username'], 'admin@acme.com');
      assert.equal(result[0]['CreatedBy.Name'], 'Alice Admin');
      assert.equal(result[0].DelegateUser, 'delegate@acme.com');
      assert.equal(result[1].DeployedBy, 'Alice Admin');
      assert.equal(result[2].TriggeredBy, 'Alice Admin');
      // Non-actor end-user field on the same row is still anonymized
      assert.match(result[2].Username, /^user_/);
    });

    it('does not anonymize a bare Name field on rows without user identity', () => {
      const [row] = anonymizeRows([{ Name: 'My_Flow', Status: 'Draft' }], 'standard', new Map(), SALT);
      assert.equal(row.Name, 'My_Flow');
    });

    it('anonymizes a bare Name field on rows that carry a Username', () => {
      const [row] = anonymizeRows([{ Name: 'Jane Doe', Username: 'jane.doe@acme.com' }], 'standard', new Map(), SALT);
      assert.match(row.Name, /^user_/);
    });

    it('handles nested objects', () => {
      const rows = [{ LastModifiedBy: { Name: 'Bob Admin', Username: 'bob@acme.com' }, Other: { Username: 'x@acme.com' } }];
      const [row] = anonymizeRows(rows, 'standard', new Map(), SALT);
      assert.equal(row.LastModifiedBy.Name, 'Bob Admin');
      assert.equal(row.LastModifiedBy.Username, 'bob@acme.com');
      assert.match(row.Other.Username, /^user_/);
    });
  });

  describe('anonymizeRows - strict level', () => {
    it('anonymizes actor fields too', () => {
      const rows = [
        {
          'CreatedBy.Username': 'admin@acme.com',
          'CreatedBy.Name': 'Alice Admin',
          DelegateUser: 'delegate@acme.com',
          Action: 'changedPassword',
        },
        { DeployedBy: 'Alice Admin', Status: 'Succeeded' },
        { TriggeredBy: 'Alice Admin' },
      ];
      const result = anonymizeRows(rows, 'strict', new Map(), SALT);
      assert.match(result[0]['CreatedBy.Username'], /^user_/);
      assert.match(result[0]['CreatedBy.Name'], /^user_/);
      assert.match(result[0].DelegateUser, /^user_/);
      assert.match(result[1].DeployedBy, /^user_/);
      assert.match(result[2].TriggeredBy, /^user_/);
      assert.equal(result[0].Action, 'changedPassword');
      assert.equal(result[1].Status, 'Succeeded');
    });
  });

  describe('row markers', () => {
    it('replaces marked values in ambiguous columns and inside free text (MFA shape)', () => {
      const rows = [
        markRowSensitiveValues(
          {
            Check: 'MFA bypass users',
            Item: 'jane.doe@acme.com',
            Details: 'Jane Doe has an MFA bypass via permission set Bypass_MFA',
            Recommendation: 'Remove the bypass',
          },
          ['jane.doe@acme.com', 'Jane Doe']
        ),
        {
          Check: 'Org enforcement',
          Item: 'enableSMSIdentity',
          Details: 'Setting is enabled',
          Recommendation: '',
        },
      ];
      const map = new Map<string, string>();
      const result = anonymizeRows(rows, 'standard', map, SALT);
      // Marked row: username and display name pseudonymized everywhere
      assert.match(result[0].Item, /^user_/);
      assert.ok(!result[0].Details.includes('Jane Doe'));
      assert.ok(result[0].Details.includes('Bypass_MFA'));
      // Registered for later free-text scrubbing
      assert.ok(map.has('jane.doe@acme.com'));
      assert.ok(map.has('Jane Doe'));
      // Settings row untouched
      assert.equal(result[1].Item, 'enableSMSIdentity');
      // Marker key never survives
      assert.ok(!(SENSITIVE_VALUES_KEY in result[0]));
      assert.ok(!(SENSITIVE_VALUES_KEY in result[1]));
    });

    it('honors marker kinds', () => {
      const row = markRowSensitiveValues(
        { Item: '0057Q000001abcd', Details: 'Login from 203.0.113.42 without MFA' },
        [
          { value: '0057Q000001abcd', kind: 'id' },
          { value: '203.0.113.42', kind: 'ip' },
        ]
      );
      const [result] = anonymizeRows([row], 'standard', new Map(), SALT);
      assert.match(result.Item, /^id_/);
      assert.ok(!result.Details.includes('203.0.113.42'));
      assert.match(result.Details, /ip_[0-9a-f]{10}/);
    });

    it('level off strips markers but keeps values raw', () => {
      const rows = [markRowSensitiveValues({ Item: 'jane.doe@acme.com', Details: 'x' }, ['jane.doe@acme.com'])];
      const result = anonymizeRows(rows, 'off', new Map(), SALT);
      assert.equal(result[0].Item, 'jane.doe@acme.com');
      assert.ok(!(SENSITIVE_VALUES_KEY in result[0]));
      // Original row keeps its marker (no mutation)
      assert.ok(SENSITIVE_VALUES_KEY in rows[0]);
    });

    it('markRowSensitiveValues skips empty values and stripSensitiveValues removes the key', () => {
      const row = markRowSensitiveValues({ Item: 'x' }, [null, undefined, '', 'jane.doe@acme.com']);
      assert.equal((row as any)[SENSITIVE_VALUES_KEY].length, 1);
      const noMarker = markRowSensitiveValues({ Item: 'y' }, [null, '']);
      assert.ok(!(SENSITIVE_VALUES_KEY in noMarker));
      const stripped = stripSensitiveValues([row, noMarker]);
      assert.ok(!(SENSITIVE_VALUES_KEY in stripped[0]));
      assert.equal(stripped[0].Item, 'x');
    });
  });

  describe('anonymizeData', () => {
    it('walks nested data objects (legacy api summary shape)', () => {
      const data = {
        metric: 3,
        legacyApiSummary: [
          { CLIENT_IP: '203.0.113.42', CLIENT_HOSTNAME: 'host.acme.com', SFDX_HARDIS_COUNT: 12 },
        ],
        _triggeredBy: 'Alice Admin',
      };
      const standard = anonymizeData(data, 'standard', new Map(), SALT);
      assert.match(standard.legacyApiSummary[0].CLIENT_IP, /^ip_/);
      assert.equal(standard.legacyApiSummary[0].SFDX_HARDIS_COUNT, 12);
      // Actor field kept at standard, hashed at strict
      assert.equal(standard._triggeredBy, 'Alice Admin');
      const strict = anonymizeData(data, 'strict', new Map(), SALT);
      assert.match(strict._triggeredBy, /^user_/);
      // Input not mutated
      assert.equal(data.legacyApiSummary[0].CLIENT_IP, '203.0.113.42');
    });
  });

  describe('anonymizeNotifMessage', () => {
    const buildMessage = (): NotifMessage => ({
      type: 'SECURITY_KEY_UNLINK',
      text: 'MFA method unlinked for jane.doe@acme.com\n\nTriggered by Alice Admin',
      attachments: [{ text: '- jane.doe@acme.com: unlinked (Security Key)' }],
      severity: 'warning',
      logElements: [
        { Username: 'jane.doe@acme.com', Status: 'unlinked', TriggeredBy: 'Alice Admin' },
      ],
      metrics: {},
      data: { metric: 1, _triggeredBy: 'Alice Admin' },
    });

    it('anonymizes rows, data and scrubs free texts at standard level', () => {
      const message = buildMessage();
      const result = anonymizeNotifMessage(message, 'standard');
      assert.match(result.logElements[0].Username, /^user_/);
      // Actor kept at standard
      assert.equal(result.logElements[0].TriggeredBy, 'Alice Admin');
      assert.equal(result.data._triggeredBy, 'Alice Admin');
      // Texts scrubbed with the values collected from rows
      assert.ok(!result.text.includes('jane.doe@acme.com'));
      assert.ok(result.text.includes('Alice Admin'));
      assert.ok(!(result.attachments as any[])[0].text.includes('jane.doe@acme.com'));
      // Input message untouched
      assert.equal(message.logElements[0].Username, 'jane.doe@acme.com');
      assert.ok(message.text.includes('jane.doe@acme.com'));
    });

    it('also anonymizes actors at strict level, including in free texts', () => {
      const result = anonymizeNotifMessage(buildMessage(), 'strict');
      assert.match(result.logElements[0].TriggeredBy, /^user_/);
      assert.match(result.data._triggeredBy, /^user_/);
      assert.ok(!result.text.includes('Alice Admin'));
    });

    it('scrubs values at sentence boundaries but not inside identifiers', () => {
      const message: NotifMessage = {
        type: 'APEX_ERROR',
        text: 'Contact jane.doe@acme.com. Assigned to Support. Flow Support_Flow failed, notify Support!',
        severity: 'error',
        logElements: [{ Username: 'jane.doe@acme.com', LastName: 'Support', FirstName: "O'Brien (Admin)" }],
        metrics: {},
        data: {},
      };
      const result = anonymizeNotifMessage(message, 'standard');
      assert.ok(!result.text.includes('jane.doe@acme.com'), result.text);
      assert.ok(!result.text.includes('to Support.'), result.text);
      assert.ok(!result.text.includes('Support!'), result.text);
      // Identifier containing the value as a word part stays intact
      assert.ok(result.text.includes('Support_Flow'), result.text);
      // Regex special characters in values must not throw
      assert.ok(result.logElements[0].FirstName.startsWith('user_'));
    });

    it('level off returns the message with markers stripped from logElements', () => {
      const message: NotifMessage = {
        type: 'MFA_CONFIG',
        text: 'MFA report',
        severity: 'warning',
        logElements: [markRowSensitiveValues({ Item: 'jane.doe@acme.com' }, ['jane.doe@acme.com'])],
        metrics: {},
        data: {},
      };
      const result = anonymizeNotifMessage(message, 'off');
      assert.equal(result.logElements[0].Item, 'jane.doe@acme.com');
      assert.ok(!(SENSITIVE_VALUES_KEY in result.logElements[0]));
    });
  });

  describe('ApiProvider.buildPayload', () => {
    it('does not mutate notifMessage.data (payload fields must not leak to monitoring files)', async () => {
      const message: NotifMessage = {
        type: 'MFA_CONFIG',
        text: 'MFA report',
        severity: 'warning',
        logElements: [{ Item: 'x' }],
        metrics: { MfaBypassUsers: 1 },
        data: { metric: 1 },
      };
      const provider = new ApiProvider();
      await provider.buildPayload(message);
      assert.ok(provider.payload.data._logElements);
      assert.equal((message.data as any)._logElements, undefined);
      assert.equal((message.data as any)._title, undefined);
      assert.equal((message.data as any)._logBodyText, undefined);
    });
  });
});
