/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  getDefaultWhatWillBreakChecks,
  parseWhatWillBreakChecks,
  runWhatWillBreak,
  WHAT_WILL_BREAK_CHECK_KEYS,
  writeWhatWillBreakReports,
} from '../../../src/common/whatWillBreak/index.js';
import { getLongestGapDays, isSalesforceEndUserApp } from '../../../src/common/whatWillBreak/authChecks.js';
import { WhatWillBreakCheckResult, WhatWillBreakResult } from '../../../src/common/whatWillBreak/whatWillBreakTypes.js';
import { getUserNotifications, resolveMonitoringCommands } from '../../../src/common/notifProvider/utils/notificationConfig.js';
import { computeHealthScore } from '../../../src/common/monitoring/healthScore.js';

const TODAY = new Date('2026-11-15T12:00:00Z');

interface CadenceOrg {
  pairs: any[];
  days: any[];
  users: any[];
}

// Answers the queries of the refresh token use check, and the release updates (Tooling API)
function mockConnection(org: Partial<CadenceOrg> & { releaseUpdates?: any[]; releaseUpdatesThrow?: boolean }): any {
  return {
    instanceUrl: 'https://test.my.salesforce.com',
    getApiVersion: () => '65.0',
    query: async (soql: string) => {
      if (soql.includes('FROM Organization')) {
        return { done: true, records: [{ IsSandbox: false }] };
      }
      if (soql.includes('DAY_ONLY(LoginTime)')) {
        return { done: true, records: org.days || [] };
      }
      if (soql.includes('FROM LoginHistory')) {
        return { done: true, records: org.pairs || [] };
      }
      if (soql.includes('FROM User WHERE Id IN')) {
        return { done: true, records: org.users || [] };
      }
      throw new Error(`Unexpected query: ${soql}`);
    },
    queryMore: async () => ({ done: true, records: [] }),
    request: async () => {
      if (org.releaseUpdatesThrow) {
        throw new Error("INVALID_TYPE: sObject type 'ReleaseUpdate' is not supported.");
      }
      return { done: true, records: org.releaseUpdates || [] };
    },
  };
}

function refreshDay(userId: string, application: string, day: string, status = 'Success') {
  return { UserId: userId, Application: application, Status: status, d: day, cnt: 1 };
}

function check(values: Partial<WhatWillBreakCheckResult> & Pick<WhatWillBreakCheckResult, 'key' | 'status'>): WhatWillBreakCheckResult {
  return {
    title: values.key,
    detail: 'detail',
    deadline: '2027-02-20 (97 days left)',
    howToFixUrl: `https://doc#${values.key}`,
    rows: [],
    ...values,
  };
}

describe('whatWillBreak', () => {
  describe('parseWhatWillBreakChecks()', () => {
    it('keeps the catalog order and ignores spaces', () => {
      expect(parseWhatWillBreakChecks('releaseUpdates, idleRefreshTokens')).to.deep.equal(['idleRefreshTokens', 'releaseUpdates']);
    });

    it('fails on an unknown check, so a typo never skips a check silently', () => {
      expect(() => parseWhatWillBreakChecks('idleRefreshTokens,legacyApi')).to.throw('legacyApi');
    });
  });

  describe('getDefaultWhatWillBreakChecks()', () => {
    it('runs every check by default', () => {
      expect(getDefaultWhatWillBreakChecks({})).to.deep.equal(WHAT_WILL_BREAK_CHECK_KEYS);
    });

    it('skips the checks whose former monitoring command the user turned off', () => {
      const checks = getDefaultWhatWillBreakChecks({
        monitoringDisable: ['LEGACY_API'],
        monitoringCommands: [{ key: 'RELEASE_UPDATES', frequency: 'off' }],
      });
      expect(checks).to.not.include('legacyApiVersions');
      expect(checks).to.not.include('releaseUpdates');
      expect(checks).to.include('idleRefreshTokens');
    });
  });

  describe('refresh token use', () => {
    it('measures the longest gap between two days of use', () => {
      expect(getLongestGapDays(['2026-06-01', '2026-06-02', '2026-07-15', '2026-07-20'])).to.equal(43);
      expect(getLongestGapDays(['2026-06-01'])).to.equal(0);
    });

    it("recognizes Salesforce's own end-user apps", () => {
      expect(isSalesforceEndUserApp('Salesforce for iOS')).to.be.true;
      expect(isSalesforceEndUserApp('Monthly Sync')).to.be.false;
      expect(isSalesforceEndUserApp('Dataloader Bulk')).to.be.false;
    });

    it('reports an integration that goes 30 days or more without using its refresh token, whatever the user', async () => {
      const result = await runWhatWillBreak({
        conn: mockConnection({
          pairs: [
            { UserId: '005A', Application: 'Monthly Sync' },
            { UserId: '005B', Application: 'Daily Sync' },
            { UserId: '005C', Application: 'Salesforce for iOS' },
          ],
          users: [
            { Id: '005A', Username: 'sync@example.com', IsActive: true },
            { Id: '005B', Username: 'daily@example.com', IsActive: true },
          ],
          days: [
            refreshDay('005A', 'Monthly Sync', '2026-08-01'),
            refreshDay('005A', 'Monthly Sync', '2026-09-05'),
            refreshDay('005A', 'Monthly Sync', '2026-11-14'),
            refreshDay('005A', 'Monthly Sync', '2026-10-01', 'Failed: Expired access/refresh token'),
            refreshDay('005B', 'Daily Sync', '2026-11-13'),
            refreshDay('005B', 'Daily Sync', '2026-11-14'),
            refreshDay('005C', 'Salesforce for iOS', '2026-06-01'),
            refreshDay('005C', 'Salesforce for iOS', '2026-11-01'),
          ],
        }),
        checks: ['refreshTokenCadence'],
        lookbackDays: 180,
        idleWarningDays: 20,
        ignoreUsers: [],
        today: TODAY,
      });
      const cadence = result.checks[0];
      expect(cadence.status).to.equal('warning');
      expect(cadence.rows.map((row) => row.Item)).to.deep.equal(['Monthly Sync - sync@example.com']);
      // The failed refresh of October is not a use: the longest gap is from September 5 to November 14
      expect(cadence.rows[0].Details).to.contain('70');
      expect(result.metrics.IntegrationsRefreshingTooRarely).to.equal(1);
    });
  });

  describe('release updates', () => {
    it('makes one main report row per release update, an overdue one being an error', async () => {
      const result = await runWhatWillBreak({
        conn: mockConnection({
          releaseUpdates: [
            { Title: 'Enforce A', StepStage: 'OverDue', Status: 'Pending', Category: 'Security', DueDate: '2026-11-01' },
            { Title: 'Enforce B', StepStage: 'Upcoming', Status: 'Pending', Category: 'Security', DueDate: '2027-06-01' },
          ],
        }),
        checks: ['releaseUpdates'],
        lookbackDays: 180,
        idleWarningDays: 20,
        ignoreUsers: [],
        today: TODAY,
      });
      const releaseUpdates = result.checks[0];
      expect(releaseUpdates.status).to.equal('error');
      expect(releaseUpdates.mainRows!.map((dated) => dated.row.Severity)).to.deep.equal(['error', 'warning']);
      expect(releaseUpdates.mainRows![0].row['Salesforce announcement']).to.equal(
        'https://test.my.salesforce.com/lightning/setup/ReleaseUpdates/home'
      );
      expect(result.metrics.ReleaseUpdates).to.equal(2);
    });

    it('reports the check as not run, with no metric, when the org has no release updates object', async () => {
      const result = await runWhatWillBreak({
        conn: mockConnection({ releaseUpdatesThrow: true }),
        checks: ['releaseUpdates'],
        lookbackDays: 180,
        idleWarningDays: 20,
        ignoreUsers: [],
        today: TODAY,
      });
      expect(result.checks[0].notChecked).to.be.true;
      expect(result.metrics).to.not.have.property('ReleaseUpdates');
    });
  });

  describe('writeWhatWillBreakReports()', () => {
    it('lists what will break first, then checks not run, then a confirmation row per check that found nothing', async () => {
      const result: WhatWillBreakResult = {
        isSandbox: false,
        severity: 'error',
        metrics: {},
        checks: [
          check({ key: 'deviceFlow', status: 'success', metric: 0 }),
          check({ key: 'sfConnectLegacyAuth', status: 'info', notChecked: true, detail: 'Not available on this org' }),
          check({ key: 'usernamePasswordFlow', status: 'warning', metric: 3, reportFiles: ['C:/reports/what-will-break-usernamePasswordFlow.csv'] }),
          check({ key: 'soapLoginPermission', status: 'error', metric: 2, reportFiles: ['C:/reports/what-will-break-soapLoginPermission.csv'] }),
        ],
      };
      const { mainRows } = await writeWhatWillBreakReports(result);
      expect(mainRows.map((row) => row.CheckKey)).to.deep.equal([
        'soapLoginPermission',
        'usernamePasswordFlow',
        'sfConnectLegacyAuth',
        'deviceFlow',
      ]);
      expect(mainRows[0]['Detail report']).to.equal('what-will-break-soapLoginPermission.csv');
      expect(mainRows[0]['Salesforce announcement']).to.contain('help.salesforce.com');
      // A check that did not run is never shown as OK
      expect(mainRows[2].Severity).to.equal('notChecked');
      expect(mainRows[2]['What will break']).to.equal('Not available on this org');
      expect(mainRows[3].Severity).to.equal('success');
      expect(mainRows[3].Status).to.contain('✅');
    });
  });

  describe('monitoring settings of the replaced commands', () => {
    it('gives WHAT_WILL_BREAK the lowest threshold the user set on LEGACY_API and RELEASE_UPDATES', () => {
      const notifications = getUserNotifications(
        [
          { key: 'LEGACY_API', notifications: { messaging: 'error', email: 'off' } },
          { key: 'RELEASE_UPDATES', notifications: { messaging: 'warning' } },
        ] as any,
        'WHAT_WILL_BREAK'
      );
      expect(notifications).to.deep.equal({ messaging: 'warning', email: 'off' });
    });

    it('keeps the settings the user gave WHAT_WILL_BREAK itself', () => {
      const notifications = getUserNotifications(
        [
          { key: 'LEGACY_API', notifications: { messaging: 'log' } },
          { key: 'WHAT_WILL_BREAK', notifications: { messaging: 'error' } },
        ] as any,
        'WHAT_WILL_BREAK'
      );
      expect(notifications).to.deep.equal({ messaging: 'error' });
    });

    it('does not turn a setting of a replaced command into a custom command with nothing to run', () => {
      const resolved = resolveMonitoringCommands(
        [{ key: 'WHAT_WILL_BREAK', command: 'sf hardis:org:diagnose:what-will-break', frequency: 'daily', notificationTypes: ['WHAT_WILL_BREAK'] }] as any,
        [{ key: 'LEGACY_API', frequency: 'weekly' }, { key: 'MY_CHECK', command: 'sf my:check', frequency: 'daily' }] as any
      );
      expect(resolved.map((entry) => entry.key)).to.deep.equal(['WHAT_WILL_BREAK', 'MY_CHECK']);
    });

    it('counts the legacy API calls of WHAT_WILL_BREAK in the health score', () => {
      const result = computeHealthScore([
        { type: 'WHAT_WILL_BREAK', metrics: { LegacyApiCalls: 12 } },
        { type: 'ORG_HEALTH_CHECK', metrics: { Score: 80 } },
      ] as any);
      expect(result!.subScores.security).to.equal(70);
    });
  });
});
