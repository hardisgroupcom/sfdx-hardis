/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import {
  getDefaultWhatWillBreakChecks,
  parseWhatWillBreakChecks,
  runWhatWillBreak,
  WHAT_WILL_BREAK_CHECK_KEYS,
  WHAT_WILL_BREAK_MAX_MAIN_ROWS_PER_CHECK,
  writeWhatWillBreakReports,
} from '../../../src/common/whatWillBreak/index.js';
import { getLongestGapDays, isSalesforceEndUserApp } from '../../../src/common/whatWillBreak/authChecks.js';
import { getReleaseUpdateCatalogEntry, RELEASE_UPDATES_CATALOG } from '../../../src/common/whatWillBreak/releaseUpdatesCatalog.js';
import {
  WhatWillBreakCheckKey,
  WhatWillBreakCheckResult,
  WhatWillBreakDetailRow,
  WhatWillBreakMainRow,
  WhatWillBreakResult,
} from '../../../src/common/whatWillBreak/whatWillBreakTypes.js';
import { anonymizeNotifMessage, markRowSensitiveValues, SENSITIVE_VALUES_KEY } from '../../../src/common/utils/anonymizeUtils.js';
import { getUserNotifications, resolveMonitoringCommands } from '../../../src/common/notifProvider/utils/notificationConfig.js';
import { computeHealthScore } from '../../../src/common/monitoring/healthScore.js';
import { WebSocketClient } from '../../../src/common/websocketClient.js';

const TODAY = new Date('2026-11-15T12:00:00Z');

interface CadenceOrg {
  pairs: any[];
  // Answer of the LoginHistory query grouped by user only (past 2000 user and app pairs)
  userGroups: any[];
  days: any[];
  daysThrow: boolean;
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
        if (org.daysThrow) {
          throw new Error('QUERY_TIMEOUT: Your query request was running for too long.');
        }
        return { done: true, records: org.days || [] };
      }
      if (soql.includes('FROM LoginHistory') && soql.endsWith('GROUP BY UserId')) {
        return { done: true, records: org.userGroups || [] };
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

// A finding as the checks build it: its own texts, and its username marked as personal
function finding(key: WhatWillBreakCheckKey, severity: 'error' | 'warning', user: string): WhatWillBreakDetailRow {
  return markRowSensitiveValues<WhatWillBreakDetailRow>(
    {
      Check: key,
      CheckKey: key,
      Severity: severity,
      Deadline: '2026-12-01 (16 days left)',
      Item: user,
      Details: 'details',
      WhatWillBreak: `What breaks for ${user}`,
      LastSeen: '',
      Count: 1,
      Recommendation: `Steps for ${user}`,
      HowToFix: `https://doc#${key}`,
      Article: 'https://help.salesforce.com/article',
    },
    [{ value: user, kind: 'user' }]
  );
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

  describe('progress in the UIs', () => {
    it('shows each check as a progress block, with the steps of the refresh token use check', async () => {
      const originalSendMessage = WebSocketClient.sendMessage;
      const events: any[] = [];
      try {
        WebSocketClient.sendMessage = (data: any) => {
          if (String(data.event).startsWith('progress')) {
            events.push(data);
          }
        };
        await runWhatWillBreak({
          conn: mockConnection({
            pairs: [{ UserId: '005A', Application: 'Monthly Sync' }],
            users: [{ Id: '005A', Username: 'sync@example.com', IsActive: true }],
            days: [refreshDay('005A', 'Monthly Sync', '2026-11-14')],
          }),
          checks: ['refreshTokenCadence', 'releaseUpdates'],
          lookbackDays: 180,
          idleWarningDays: 20,
          ignoreUsers: [],
          today: TODAY,
        });
      } finally {
        WebSocketClient.sendMessage = originalSendMessage;
      }
      expect(events.map((event) => event.event)).to.deep.equal(['progressStart', 'progressStep', 'progressEnd', 'progressStart', 'progressEnd']);
      expect(events[0].title).to.contain('1/2');
      expect(events[1]).to.include({ step: 1, totalSteps: 1 });
      expect(events[3].title).to.contain('2/2');
    });
  });

  describe('refresh token use, edge cases', () => {
    const run = (org: Partial<CadenceOrg>, checks: any[] = ['refreshTokenCadence']) =>
      runWhatWillBreak({ conn: mockConnection(org), checks, lookbackDays: 180, idleWarningDays: 20, ignoreUsers: [], today: TODAY });

    it('lists an app used on one day only: information when recent, warning once its token has expired', async () => {
      const result = await run({
        pairs: [
          { UserId: '005A', Application: 'Semester Sync' },
          { UserId: '005B', Application: 'New Sync' },
        ],
        users: [
          { Id: '005A', Username: 'semester@example.com', IsActive: true },
          { Id: '005B', Username: 'new@example.com', IsActive: true },
        ],
        days: [refreshDay('005A', 'Semester Sync', '2026-09-01'), refreshDay('005B', 'New Sync', '2026-11-10')],
      });
      const rows = result.checks[0].rows;
      expect(rows.map((row) => [row.Item, row.Severity])).to.deep.equal([
        ['New Sync - new@example.com', 'info'],
        ['Semester Sync - semester@example.com', 'warning'],
      ]);
      // A recent single use is not an integration that refreshes too rarely (yet)
      expect(result.metrics.IntegrationsRefreshingTooRarely).to.equal(1);
    });

    it('leaves out the Salesforce CLI, whose expired login only asks the developer to log in again', async () => {
      const result = await run({
        pairs: [{ UserId: '005A', Application: 'Salesforce CLI' }],
        users: [{ Id: '005A', Username: 'dev@example.com', IsActive: true }],
        days: [refreshDay('005A', 'Salesforce CLI', '2026-08-01'), refreshDay('005A', 'Salesforce CLI', '2026-11-14')],
      });
      expect(result.checks[0].status).to.equal('success');
      expect(result.metrics.IntegrationsRefreshingTooRarely).to.equal(0);
    });

    it('still reads every user past 2000 user and app pairs', async () => {
      const result = await run({
        pairs: Array.from({ length: 2000 }, (_, i) => ({ UserId: `005P${i}`, Application: `App ${i}` })),
        userGroups: [{ UserId: '005A' }],
        users: [{ Id: '005A', Username: 'sync@example.com', IsActive: true }],
        days: [refreshDay('005A', 'Monthly Sync', '2026-08-01'), refreshDay('005A', 'Monthly Sync', '2026-11-14')],
      });
      expect(result.checks[0].rows.map((row) => row.Item)).to.deep.equal(['Monthly Sync - sync@example.com']);
    });

    it('reports a check that fails as not checked, and still runs the other checks', async () => {
      const result = await run(
        {
          pairs: [{ UserId: '005A', Application: 'Monthly Sync' }],
          users: [{ Id: '005A', Username: 'sync@example.com', IsActive: true }],
          daysThrow: true,
          releaseUpdates: [],
        } as any,
        ['refreshTokenCadence', 'releaseUpdates']
      );
      expect(result.checks.map((c) => [c.key, c.notChecked === true])).to.deep.equal([
        ['refreshTokenCadence', true],
        ['releaseUpdates', false],
      ]);
      expect(result.checks[0].detail).to.contain('QUERY_TIMEOUT');
      // No metric for a check that did not run
      expect(result.metrics).to.not.have.property('IntegrationsRefreshingTooRarely');
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

    it('explains a known release update in plain words, links its official page, and makes one that cannot break anything information', async () => {
      const result = await runWhatWillBreak({
        conn: mockConnection({
          releaseUpdates: [
            {
              Title: 'Salesforce to Salesforce Retirement',
              DeveloperName: 'SalesforceToSalesforceRetirement',
              StepStage: 'Upcoming',
              Status: 'Info',
              Category: 'Sales',
              DueDate: '2027-02-01',
            },
            {
              Title: 'Optimize Performance for Revenue Management',
              DeveloperName: 'RevenueManagementOptimized',
              StepStage: 'Upcoming',
              Status: 'Info',
              Category: 'Revenue',
              DueDate: '2027-05-01',
            },
          ],
        }),
        checks: ['releaseUpdates'],
        lookbackDays: 180,
        idleWarningDays: 20,
        ignoreUsers: [],
        today: TODAY,
      });
      const [s2s, revenue] = result.checks[0].mainRows!.map((dated) => dated.row);
      expect(s2s['What will break']).to.contain('no longer sent or received');
      expect(s2s['What to do']).to.contain('Partner Cloud');
      expect(s2s['Salesforce announcement']).to.equal(getReleaseUpdateCatalogEntry('SalesforceToSalesforceRetirement')!.articleUrl);
      expect(s2s.Severity).to.equal('warning');
      expect(revenue.Severity).to.equal('info');
    });

    it("shows Salesforce's own description for a release update sfdx-hardis does not know", async () => {
      const result = await runWhatWillBreak({
        conn: mockConnection({
          releaseUpdates: [
            {
              Title: 'Brand New Change',
              DeveloperName: 'BrandNewChange',
              Description: '<p>Starting in Summer &amp; later, <b>widgets</b> are required.</p>',
              StepStage: 'Upcoming',
              Status: 'Info',
              Category: 'Security',
              DueDate: '2027-06-01',
            },
          ],
        }),
        checks: ['releaseUpdates'],
        lookbackDays: 180,
        idleWarningDays: 20,
        ignoreUsers: [],
        today: TODAY,
      });
      const row = result.checks[0].mainRows![0].row;
      expect(row['What will break']).to.equal('Release update "Brand New Change": Starting in Summer & later, widgets are required.');
      expect(row['Salesforce announcement']).to.equal('https://test.my.salesforce.com/lightning/setup/ReleaseUpdates/home');
    });
  });

  describe('release updates catalog', () => {
    const docPage = fs.readFileSync(path.join(process.cwd(), 'docs', 'salesforce-monitoring-what-will-break.md'), 'utf8');
    const locales = ['de', 'en', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt-BR'];
    const translations = Object.fromEntries(
      locales.map((locale) => [locale, JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'i18n', `${locale}.json`), 'utf8'))])
    );
    for (const entry of RELEASE_UPDATES_CATALOG) {
      it(`${entry.developerName}: texts in every language, an official link, and a row of the doc table`, () => {
        for (const locale of locales) {
          expect(translations[locale], `${locale} Impact`).to.have.property(`whatWillBreakRu${entry.developerName}Impact`);
          expect(translations[locale], `${locale} Todo`).to.have.property(`whatWillBreakRu${entry.developerName}Todo`);
        }
        expect(entry.articleUrl).to.match(/^https:\/\/(help|developer)\.salesforce\.com\//);
        expect(docPage).to.contain(`| ${entry.title} |`);
      });
    }
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
          check({
            key: 'usernamePasswordFlow',
            status: 'warning',
            metric: 1,
            rows: [finding('usernamePasswordFlow', 'warning', 'sync@example.com')],
            reportFiles: ['C:/reports/what-will-break-usernamePasswordFlow.csv'],
          }),
          check({
            key: 'soapLoginPermission',
            status: 'error',
            metric: 1,
            rows: [finding('soapLoginPermission', 'error', 'etl@example.com')],
            reportFiles: ['C:/reports/what-will-break-soapLoginPermission.csv'],
          }),
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

    it('makes one row per finding, naming what breaks and what to do for that item, with its user marked for the anonymization', async () => {
      const result: WhatWillBreakResult = {
        isSandbox: false,
        severity: 'warning',
        metrics: {},
        checks: [
          check({
            key: 'usernamePasswordFlow',
            status: 'warning',
            metric: 2,
            rows: [finding('usernamePasswordFlow', 'warning', 'sync@example.com'), finding('usernamePasswordFlow', 'warning', 'etl@example.com')],
          }),
        ],
      };
      const { mainRows } = await writeWhatWillBreakReports(result);
      expect(mainRows.map((row) => row['What will break'])).to.deep.equal([
        'What breaks for sync@example.com',
        'What breaks for etl@example.com',
      ]);
      expect(mainRows[0]['What to do']).to.equal('Steps for sync@example.com');
      expect((mainRows[0] as any)[SENSITIVE_VALUES_KEY]).to.deep.equal([{ value: 'sync@example.com', kind: 'user' }]);
    });

    it('lists the first findings of a check, and points to its detail report for the others', async () => {
      const rows = Array.from({ length: WHAT_WILL_BREAK_MAX_MAIN_ROWS_PER_CHECK + 5 }, (_, i) =>
        finding('soapLoginRetirement', 'warning', `user${i}@example.com`)
      );
      const result: WhatWillBreakResult = {
        isSandbox: false,
        severity: 'warning',
        metrics: {},
        checks: [check({ key: 'soapLoginRetirement', status: 'warning', metric: rows.length, rows, reportFiles: ['C:/reports/soap.csv'] })],
      };
      const { mainRows } = await writeWhatWillBreakReports(result);
      expect(mainRows).to.have.length(WHAT_WILL_BREAK_MAX_MAIN_ROWS_PER_CHECK + 1);
      const last = mainRows[mainRows.length - 1];
      expect(last['What will break']).to.contain('5');
      expect(last['What to do']).to.contain('soap.csv');
    });
  });

  describe('anonymization of what is sent outside', () => {
    it('removes the usernames from the sentences of the rows, the text and the attachments sent to Grafana', async () => {
      const result: WhatWillBreakResult = {
        isSandbox: false,
        severity: 'warning',
        metrics: {},
        checks: [
          check({ key: 'usernamePasswordFlow', status: 'warning', metric: 1, rows: [finding('usernamePasswordFlow', 'warning', 'sync@example.com')] }),
        ],
      };
      const { mainRows } = await writeWhatWillBreakReports(result);
      const sent = anonymizeNotifMessage(
        {
          type: 'WHAT_WILL_BREAK',
          text: 'Something breaks for sync@example.com',
          attachments: [{ text: `${mainRows[0]['What will break']}` }],
          severity: 'warning',
          logElements: mainRows,
          data: {},
          metrics: {},
        } as any,
        'standard',
        'api'
      );
      const serialized = JSON.stringify(sent);
      expect(serialized).to.not.contain('sync@example.com');
      expect(sent.logElements[0]['What will break']).to.match(/user_/);
      expect(sent.logElements[0]['What to do']).to.match(/user_/);
    });
  });

  describe('release updates that enforce the change of another check', () => {
    const deviceFlowReleaseUpdate = {
      Title: 'Restrict the OAuth 2.0 Device Flow to Local External Client Apps',
      DeveloperName: 'OAuthDeviceFlowRestrictionReleaseUpdate',
      DueDate: '2026-11-30',
      StepStage: 'Upcoming',
      Status: 'Info',
      Category: 'Security',
    };
    const otherReleaseUpdate = {
      Title: 'Some Other Change',
      DeveloperName: 'SomeOtherChange',
      DueDate: '2027-01-01',
      StepStage: 'Upcoming',
      Status: 'Info',
      Category: 'Security',
    };
    const run = (pairs: any[]) =>
      runWhatWillBreak({
        conn: mockConnection({
          pairs,
          users: [{ Id: '005A', Username: 'dev@example.com', IsActive: true }],
          releaseUpdates: [deviceFlowReleaseUpdate, otherReleaseUpdate],
        }),
        checks: ['deviceFlow', 'releaseUpdates'],
        lookbackDays: 180,
        idleWarningDays: 20,
        ignoreUsers: [],
        today: TODAY,
      });

    it('merges the release update into the rows of the check that found something: no row of its own', async () => {
      const result = await run([
        {
          UserId: '005A',
          LoginSubType: 'OAuth Device',
          Application: 'Some CLI',
          ApiVersion: '',
          SourceIp: '10.0.0.1',
          Status: 'Success',
          cnt: 3,
          lastLogin: '2026-11-10T10:00:00.000Z',
        },
      ]);
      const deviceFlow = result.checks.find((c) => c.key === 'deviceFlow') as WhatWillBreakCheckResult;
      expect(deviceFlow.rows[0].WhatWillBreak).to.contain('dev@example.com');
      expect(deviceFlow.rows[0].Recommendation).to.contain(deviceFlowReleaseUpdate.Title);
      const { mainRows } = await writeWhatWillBreakReports(result);
      expect(mainRows.filter((row) => row['What will break'].includes(deviceFlowReleaseUpdate.Title))).to.have.length(0);
      // The other release update keeps its own row
      expect(mainRows.filter((row) => row['What will break'].includes(otherReleaseUpdate.Title))).to.have.length(1);
    });

    it('says on the OK row of the check that the release update can be enabled now, with its due date', async () => {
      const result = await run([]);
      const { mainRows } = await writeWhatWillBreakReports(result);
      const deviceFlowRow = mainRows.find((row) => row.CheckKey === 'deviceFlow') as WhatWillBreakMainRow;
      expect(deviceFlowRow.Severity).to.equal('success');
      expect(deviceFlowRow['What to do']).to.contain(deviceFlowReleaseUpdate.Title);
      expect(deviceFlowRow.Date).to.contain('2026-11-30');
      expect(mainRows.filter((row) => row.CheckKey === 'releaseUpdates')).to.have.length(1);
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
