/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  diagnoseAuthRetirements,
  getDeadlineDate,
  getDeadlineLabel,
  getDeadlineSeverity,
  groupLogins,
} from '../../../src/common/utils/authRetirementsDiagnoseUtils.js';

const TODAY = new Date('2026-11-15T12:00:00Z');

interface MockOrg {
  isSandbox?: boolean;
  logins?: any[];
  aggregateThrows?: boolean;
  loginHistoryThrows?: boolean;
  users?: any[];
  tokens?: any[];
  apiOnlyUserIds?: string[];
  useAnyApiAuthUserIds?: string[];
  noUseAnyApiAuthField?: boolean;
  ipRanges?: any[];
  oauthOidc?: any;
  dataSources?: any[];
  dataSourceUnsupported?: boolean;
  queries?: string[];
}

// Answers each query of the diagnose from the given org content
function mockConnection(org: MockOrg): any {
  const query = async (soql: string) => {
    org.queries?.push(soql);
    if (soql.includes('FROM Organization')) {
      return { done: true, records: [{ IsSandbox: org.isSandbox === true }] };
    }
    if (soql.includes('FROM LoginHistory')) {
      if (org.loginHistoryThrows || (org.aggregateThrows && soql.includes('COUNT(Id)'))) {
        throw new Error('INSUFFICIENT_ACCESS');
      }
      return { done: true, records: org.logins || [] };
    }
    if (soql.includes('FROM User WHERE Id IN')) {
      return { done: true, records: org.users || [] };
    }
    if (soql.includes('SELECT count() FROM OauthToken')) {
      return { done: true, totalSize: (org.tokens || []).length, records: [] };
    }
    if (soql.includes('PermissionsApiUserOnly')) {
      return { done: true, records: (org.apiOnlyUserIds || []).map((id) => ({ AssigneeId: id })) };
    }
    if (soql.includes('PermissionsUseAnyApiAuth')) {
      return { done: true, records: (org.useAnyApiAuthUserIds || []).map((id) => ({ AssigneeId: id })) };
    }
    if (soql.includes('FROM ExternalDataSource')) {
      if (org.dataSourceUnsupported) {
        throw new Error("INVALID_TYPE: sObject type 'ExternalDataSource' is not supported.");
      }
      return { done: true, records: org.dataSources || [] };
    }
    throw new Error(`Unexpected query: ${soql}`);
  };
  return {
    instanceUrl: 'https://test.my.salesforce.com',
    query,
    queryMore: async () => ({ done: true, records: [] }),
    bulk2: {
      pollInterval: 0,
      pollTimeout: 0,
      query: async () => ({ on: () => undefined, toArray: async () => org.tokens || [] }),
    },
    tooling: {
      query: async (soql: string) => {
        if (soql.includes('SecuritySettings')) {
          return { records: [{ Metadata: { networkAccess: { ipRanges: org.ipRanges || [] } } }] };
        }
        if (soql.includes('OauthOidcSettings')) {
          return { records: [{ Metadata: org.oauthOidc || {} }] };
        }
        throw new Error(`Unexpected tooling query: ${soql}`);
      },
    },
    sobject: () => ({
      describe: async () => ({ fields: org.noUseAnyApiAuthField ? [] : [{ name: 'PermissionsUseAnyApiAuth' }] }),
    }),
  };
}

function login(userId: string, loginSubType: string, extra: Record<string, any> = {}) {
  return {
    UserId: userId,
    LoginSubType: loginSubType,
    Application: 'My Integration',
    ApiVersion: '58.0',
    SourceIp: '203.0.113.10',
    Status: 'Success',
    cnt: 3,
    lastLogin: '2026-11-10T08:00:00.000+0000',
    ...extra,
  };
}

const USERS = [
  { Id: '005A', Username: 'soap.integration@example.com', IsActive: true },
  { Id: '005B', Username: 'soap.allowed@example.com', IsActive: true },
  { Id: '005C', Username: 'soap.inactive@example.com', IsActive: false },
  { Id: '005D', Username: 'device.user@example.com', IsActive: true },
  { Id: '005E', Username: 'password.flow@example.com', IsActive: true },
  { Id: '005F', Username: 'mobile.user@example.com', IsActive: true },
];

async function runDiagnose(org: MockOrg, ignoreUsers: string[] = []) {
  return diagnoseAuthRetirements({
    conn: mockConnection(org),
    lookbackDays: 180,
    idleWarningDays: 20,
    ignoreUsers,
    today: TODAY,
  });
}

describe('authRetirementsDiagnoseUtils', () => {
  describe('deadlines', () => {
    it('makes a finding an error when its deadline is less than 60 days away', () => {
      expect(getDeadlineSeverity('soapLoginPermission', false, TODAY)).to.equal('error');
      expect(getDeadlineSeverity('deviceFlow', false, TODAY)).to.equal('error');
      expect(getDeadlineSeverity('usernamePasswordFlow', false, TODAY)).to.equal('warning');
      expect(getDeadlineSeverity('soapLoginRetirement', false, TODAY)).to.equal('warning');
    });

    it('makes a finding an error once its deadline has passed', () => {
      expect(getDeadlineSeverity('deviceFlow', false, new Date('2026-12-05T00:00:00Z'))).to.equal('error');
    });

    it('keeps findings of an enforced rolling change as warnings', () => {
      expect(getDeadlineSeverity('idleRefreshTokens', false, TODAY)).to.equal('warning');
    });

    it('uses the sandbox date on a sandbox', () => {
      expect(getDeadlineDate('soapLoginIpRange', true)).to.equal('2026-12-15');
      expect(getDeadlineDate('soapLoginIpRange', false)).to.equal('2027-01-31');
      expect(getDeadlineSeverity('soapLoginIpRange', true, TODAY)).to.equal('error');
      expect(getDeadlineSeverity('soapLoginIpRange', false, TODAY)).to.equal('warning');
    });

    it('labels a deadline with its date, its release, or as enforced', () => {
      expect(getDeadlineLabel('soapLoginPermission', false, TODAY)).to.contain('2026-12-01').and.contain('16');
      expect(getDeadlineLabel('soapLoginRetirement', false, TODAY)).to.equal("Summer '27");
      expect(getDeadlineLabel('idleRefreshTokens', false, TODAY)).to.contain('2026-11-04');
    });
  });

  describe('groupLogins()', () => {
    it('adds the counts of aggregate rows and keeps the last successful login', () => {
      const groups = groupLogins(
        [
          login('005A', 'SOAP API', { cnt: 2, lastLogin: '2026-10-01T00:00:00.000+0000' }),
          login('005A', 'SOAP API', { cnt: 5, lastLogin: '2026-11-01T00:00:00.000+0000' }),
          login('005A', 'SOAP API', { cnt: 4, Status: 'Invalid Password' }),
          login('005D', 'OAuth Device'),
        ],
        new Map([['005A', 'soap.integration@example.com']]),
        ['SOAP API'],
        ['userId']
      );
      expect(groups).to.have.length(1);
      expect(groups[0]).to.include({
        username: 'soap.integration@example.com',
        successCount: 7,
        failedCount: 4,
        lastSuccess: '2026-11-01T00:00:00.000+0000',
      });
    });

    it('counts raw LoginHistory records one by one', () => {
      const groups = groupLogins(
        [
          { UserId: '005A', LoginSubType: 'SOAP API', Status: 'Success', LoginTime: '2026-11-01T00:00:00.000+0000' },
          { UserId: '005A', LoginSubType: 'SOAP API', Status: 'Success', LoginTime: '2026-11-02T00:00:00.000+0000' },
        ],
        new Map(),
        ['SOAP API'],
        ['userId']
      );
      expect(groups[0].successCount).to.equal(2);
      expect(groups[0].lastSuccess).to.equal('2026-11-02T00:00:00.000+0000');
    });
  });

  describe('diagnoseAuthRetirements()', () => {
    it('reports SOAP login() callers without Use Any API Auth as errors, and skips inactive users', async () => {
      const result = await runDiagnose({
        logins: [login('005A', 'SOAP API'), login('005B', 'SOAP API'), login('005C', 'SOAP API')],
        users: USERS,
        useAnyApiAuthUserIds: ['005B'],
      });
      const check = result.checks.find((ck) => ck.key === 'soapLoginPermission')!;
      expect(check.status).to.equal('error');
      expect(check.rows.map((row) => row.Item)).to.deep.equal(['soap.integration@example.com']);
      expect(result.metrics.SoapLoginUsersMissingPermission).to.equal(1);
      // Every active SOAP caller must move to OAuth before Summer '27
      expect(result.metrics.SoapLoginUsers).to.equal(2);
      expect(result.checks.find((ck) => ck.key === 'soapLoginRetirement')!.status).to.equal('warning');
      expect(result.severity).to.equal('error');
    });

    it('keeps failed SOAP logins in the permission check: after enforcement, a caller only fails', async () => {
      const result = await runDiagnose({
        logins: [login('005A', 'SOAP API', { Status: 'Insufficient Access' })],
        users: USERS,
      });
      expect(result.metrics.SoapLoginUsersMissingPermission).to.equal(1);
      // No successful login: not counted as a SOAP login() user any more
      expect(result.metrics.SoapLoginUsers).to.equal(0);
    });

    it('skips ignored users', async () => {
      const result = await runDiagnose(
        { logins: [login('005A', 'SOAP API')], users: USERS },
        ['SOAP.Integration@example.com']
      );
      expect(result.metrics.SoapLoginUsersMissingPermission).to.equal(0);
      expect(result.metrics.SoapLoginUsers).to.equal(0);
    });

    it('reports the device flow and the username-password flow, and the user-agent flows per app as information', async () => {
      const result = await runDiagnose({
        logins: [
          login('005D', 'OAuth Device', { Application: 'Salesforce CLI' }),
          login('005E', 'OAuth Username-Password', { Application: 'Old ETL' }),
          login('005F', 'OAuth User-Agent for Hybrid Apps', { Application: 'Salesforce for iOS' }),
        ],
        users: USERS,
      });
      const deviceFlow = result.checks.find((ck) => ck.key === 'deviceFlow')!;
      expect(deviceFlow.status).to.equal('error');
      expect(result.metrics.DeviceFlowUsers).to.equal(1);
      const usernamePassword = result.checks.find((ck) => ck.key === 'usernamePasswordFlow')!;
      expect(usernamePassword.status).to.equal('warning');
      expect(result.metrics.UsernamePasswordFlowUsers).to.equal(1);
      const userAgentRow = usernamePassword.rows.find((row) => row.Item === 'Salesforce for iOS')!;
      expect(userAgentRow.Severity).to.equal('info');
    });

    it('passes the username-password check when the flow is already blocked', async () => {
      const result = await runDiagnose({ users: USERS, oauthOidc: { blockOAuthUnPwFlow: true } });
      const check = result.checks.find((ck) => ck.key === 'usernamePasswordFlow')!;
      expect(check.status).to.equal('success');
      expect(result.metrics.UsernamePasswordFlowUsers).to.equal(0);
    });

    it('reports SOAP callers only covered by a trusted IP range wider than /8', async () => {
      const result = await runDiagnose({
        logins: [
          login('005A', 'SOAP API', { SourceIp: '20.1.2.3' }),
          login('005B', 'SOAP API', { SourceIp: '192.168.1.10' }),
        ],
        users: USERS,
        useAnyApiAuthUserIds: ['005A', '005B'],
        ipRanges: [
          { start: '0.0.0.0', end: '127.255.255.255', description: 'Too wide' },
          { start: '192.168.0.0', end: '192.168.255.255', description: 'Office' },
          { start: '128.0.0.0', end: '255.255.255.255', description: 'Too wide too' },
        ],
      });
      const check = result.checks.find((ck) => ck.key === 'soapLoginIpRange')!;
      // 192.168.1.10 is also in the narrow Office range: it keeps logging in without token
      expect(result.metrics.SoapLoginUsersNeedingToken).to.equal(1);
      expect(check.status).to.equal('warning');
      expect(check.rows.filter((row) => row.Severity === 'info')).to.have.length(2);
    });

    it('warns when the last SOAP login() call of the org is old, and tells when there is none', async () => {
      const oldCall = await runDiagnose({
        logins: [login('005A', 'SOAP API', { lastLogin: '2026-06-01T00:00:00.000+0000' })],
        users: USERS,
      });
      expect(oldCall.checks.find((ck) => ck.key === 'soapLoginInactivity')!.status).to.equal('warning');
      const noCall = await runDiagnose({ users: USERS });
      const noCallCheck = noCall.checks.find((ck) => ck.key === 'soapLoginInactivity')!;
      expect(noCallCheck.status).to.equal('info');
      expect(noCallCheck.metric).to.be.undefined;
    });

    it('reports refresh tokens of API only users about to expire, the most recent token of each app and user only', async () => {
      const token = (userId: string, appName: string, lastUsedDate: string, username: string) => ({
        Id: `0Cw${userId}${lastUsedDate}`,
        AppName: appName,
        LastUsedDate: lastUsedDate,
        CreatedDate: '2025-01-01T00:00:00.000Z',
        UseCount: '10',
        UserId: userId,
        'User.Username': username,
        'User.IsActive': 'true',
      });
      const result = await runDiagnose({
        users: USERS,
        apiOnlyUserIds: ['005A', '005B'],
        tokens: [
          // 25 days idle: expires in 5 days
          token('005A', 'Nightly Sync', '2026-10-21T12:00:00.000Z', 'soap.integration@example.com'),
          // An older token of the same app and user: the recent one counts
          token('005A', 'Nightly Sync', '2026-01-01T12:00:00.000Z', 'soap.integration@example.com'),
          // Still used: another token of the same app and user is recent
          token('005B', 'Hourly Sync', '2026-11-15T10:00:00.000Z', 'soap.allowed@example.com'),
          token('005B', 'Hourly Sync', '2026-09-01T10:00:00.000Z', 'soap.allowed@example.com'),
          // Not an API only user: counted per app
          token('005F', 'Salesforce for iOS', '2026-10-21T12:00:00.000Z', 'mobile.user@example.com'),
        ],
      });
      const check = result.checks.find((ck) => ck.key === 'idleRefreshTokens')!;
      expect(check.status).to.equal('warning');
      expect(result.metrics.IdleRefreshTokensExpiringSoon).to.equal(1);
      const warningRows = check.rows.filter((row) => row.Severity === 'warning');
      expect(warningRows).to.have.length(1);
      expect(warningRows[0].Item).to.equal('Nightly Sync - soap.integration@example.com');
      expect(warningRows[0].Count).to.equal(20);
      expect(check.rows.find((row) => row.Item === 'Salesforce for iOS')!.Severity).to.equal('info');
    });

    it('reports cross-org data sources without Named Credential', async () => {
      const result = await runDiagnose({
        users: USERS,
        dataSources: [
          { DeveloperName: 'Legacy_Org', MasterLabel: 'Legacy Org', Protocol: 'Password', PrincipalType: 'NamedUser' },
          { DeveloperName: 'Modern_Org', MasterLabel: 'Modern Org', Protocol: 'Oauth', NamedCredentialId: '0XA000' },
        ],
      });
      const check = result.checks.find((ck) => ck.key === 'sfConnectLegacyAuth')!;
      expect(check.status).to.equal('warning');
      expect(check.rows.map((row) => row.Item)).to.deep.equal(['Legacy Org (Legacy_Org)']);
      expect(result.metrics.SfConnectLegacyDataSources).to.equal(1);
    });

    it('does not fail and sends no metric for what the org does not provide', async () => {
      const result = await runDiagnose({
        loginHistoryThrows: true,
        noUseAnyApiAuthField: true,
        dataSourceUnsupported: true,
      });
      for (const key of ['deviceFlow', 'soapLoginPermission', 'soapLoginRetirement', 'sfConnectLegacyAuth']) {
        const check = result.checks.find((ck) => ck.key === key)!;
        expect(check.status, key).to.equal('info');
        expect(check.metric, key).to.be.undefined;
      }
      expect(result.metrics).to.not.have.any.keys('DeviceFlowUsers', 'SoapLoginUsers', 'SfConnectLegacyDataSources');
      expect(result.severity).to.equal('log');
    });

    it('reads the raw logins when the aggregate query fails', async () => {
      const queries: string[] = [];
      const result = await runDiagnose({
        aggregateThrows: true,
        logins: [{ UserId: '005D', LoginSubType: 'OAuth Device', Application: 'CLI', Status: 'Success', LoginTime: '2026-11-01T00:00:00.000+0000' }],
        users: USERS,
        queries,
      });
      expect(queries.filter((q) => q.includes('FROM LoginHistory'))).to.have.length(2);
      expect(result.metrics.DeviceFlowUsers).to.equal(1);
    });
  });
});
