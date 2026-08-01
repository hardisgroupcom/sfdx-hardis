import { expect } from 'chai';
import {
  buildUsageEntitlementMetrics,
  buildUsageEntitlementRow,
  computeDaysRemaining,
  computePercentPeriodElapsed,
  computeProjection,
  parseSettingKey,
  resolveEntitlementPeriod,
  resolveEntitlementSeverity,
  sortUsageEntitlementRows,
  toNumberOrNull,
  UsageEntitlementsConfig,
} from '../../../src/common/utils/usageEntitlementsUtils.js';

const baseConfig: UsageEntitlementsConfig = {
  projectionThresholdWarning: 120,
  projectionThresholdError: 150,
  percentThresholdWarning: 50,
  percentThresholdError: 75,
  resources: {},
};

const NOW = new Date('2026-08-01T00:00:00.000Z');

describe('usageEntitlementsUtils', () => {
  // getEnvVar() returns null for an unset variable and Number(null) is 0, which is finite.
  // Treating that as a configured value silently set every threshold to 0 and flagged any
  // entitlement above 0% consumption as an error on a real org.
  describe('toNumberOrNull', () => {
    it('treats an unset env var (null) as absent, not as zero', () => {
      expect(toNumberOrNull(null)).to.equal(null);
    });

    it('treats undefined and empty string as absent', () => {
      expect(toNumberOrNull(undefined)).to.equal(null);
      expect(toNumberOrNull('')).to.equal(null);
    });

    it('parses real numeric values, including numeric strings', () => {
      expect(toNumberOrNull(120)).to.equal(120);
      expect(toNumberOrNull('150')).to.equal(150);
      expect(toNumberOrNull(0)).to.equal(0);
    });

    it('rejects non-numeric values', () => {
      expect(toNumberOrNull('abc')).to.equal(null);
      expect(toNumberOrNull({})).to.equal(null);
    });
  });

  describe('parseSettingKey', () => {
    it('extracts the trailing token of a Setting value', () => {
      expect(parseSettingKey('setting/force.com/orgValue.MaxCdpProfiles')).to.equal('MaxCdpProfiles');
    });

    it('returns the input when there is no dot', () => {
      expect(parseSettingKey('MaxCdpProfiles')).to.equal('MaxCdpProfiles');
    });

    it('returns an empty string for null or undefined', () => {
      expect(parseSettingKey(null)).to.equal('');
      expect(parseSettingKey(undefined)).to.equal('');
    });
  });

  describe('resolveEntitlementPeriod', () => {
    // EndDate is the contract expiry, not the end of the current billing window. Real orgs
    // carry rows like Frequency "Daily" with EndDate three years out; treating that as the
    // period would flatten every projection to the raw consumption percentage.
    it('ignores a far-future EndDate and keeps the recurring window', () => {
      const period = resolveEntitlementPeriod(
        { StartDate: '2024-02-11', EndDate: '2027-02-11', Frequency: 'Daily' },
        NOW
      );
      expect(period?.start.toISOString().slice(0, 10)).to.equal('2026-08-01');
      expect(period?.end.toISOString().slice(0, 10)).to.equal('2026-08-02');
    });

    it('keeps the monthly window when EndDate is the contract expiry years away', () => {
      const period = resolveEntitlementPeriod(
        { StartDate: '2019-02-28', EndDate: '2027-02-11', Frequency: 'Monthly' },
        NOW
      );
      expect(period?.start.toISOString().slice(0, 10)).to.equal('2026-07-28');
      expect(period?.end.toISOString().slice(0, 10)).to.equal('2026-08-28');
    });

    it('clamps the window when the contract ends partway through the current cycle', () => {
      // Cycle would run 2026-07-05 -> 2026-08-05, but the contract stops on 2026-07-20
      const period = resolveEntitlementPeriod(
        { StartDate: '2026-01-05', EndDate: '2026-07-20', Frequency: 'Monthly' },
        NOW
      );
      expect(period?.start.toISOString().slice(0, 10)).to.equal('2026-07-05');
      expect(period?.end.toISOString().slice(0, 10)).to.equal('2026-07-20');
    });

    it('leaves the window intact when the contract ends after the current cycle', () => {
      const period = resolveEntitlementPeriod(
        { StartDate: '2026-01-05', EndDate: '2026-08-10', Frequency: 'Monthly' },
        NOW
      );
      expect(period?.start.toISOString().slice(0, 10)).to.equal('2026-07-05');
      expect(period?.end.toISOString().slice(0, 10)).to.equal('2026-08-05');
    });

    it('returns null when the contract has already expired', () => {
      const period = resolveEntitlementPeriod(
        { StartDate: '2016-06-05', EndDate: '2026-01-05', Frequency: 'Monthly' },
        NOW
      );
      expect(period).to.equal(null);
    });

    it('returns null for Once even when a contract window is present', () => {
      const period = resolveEntitlementPeriod(
        { StartDate: '2020-02-11', EndDate: '2024-02-11', Frequency: 'Once' },
        NOW
      );
      expect(period).to.equal(null);
    });

    it('rolls a monthly period forward to the window containing today', () => {
      const period = resolveEntitlementPeriod({ StartDate: '2020-02-17', Frequency: 'Monthly' }, NOW);
      expect(period?.start.toISOString().slice(0, 10)).to.equal('2026-07-17');
      expect(period?.end.toISOString().slice(0, 10)).to.equal('2026-08-17');
    });

    it('rolls a yearly period forward', () => {
      const period = resolveEntitlementPeriod({ StartDate: '2022-04-08', Frequency: 'Yearly' }, NOW);
      expect(period?.start.toISOString().slice(0, 10)).to.equal('2026-04-08');
      expect(period?.end.toISOString().slice(0, 10)).to.equal('2027-04-08');
    });

    it('rolls a quarterly period forward', () => {
      const period = resolveEntitlementPeriod({ StartDate: '2026-01-15', Frequency: 'Quarterly' }, NOW);
      expect(period?.start.toISOString().slice(0, 10)).to.equal('2026-07-15');
      expect(period?.end.toISOString().slice(0, 10)).to.equal('2026-10-15');
    });

    it('handles daily, weekly and fortnightly frequencies', () => {
      expect(
        resolveEntitlementPeriod({ StartDate: '2026-07-31', Frequency: 'Daily' }, NOW)?.start
          .toISOString()
          .slice(0, 10)
      ).to.equal('2026-08-01');
      expect(
        resolveEntitlementPeriod({ StartDate: '2026-07-25', Frequency: 'Weekly' }, NOW)?.end
          .toISOString()
          .slice(0, 10)
      ).to.equal('2026-08-08');
      expect(
        resolveEntitlementPeriod({ StartDate: '2026-07-25', Frequency: 'Fortnightly' }, NOW)?.end
          .toISOString()
          .slice(0, 10)
      ).to.equal('2026-08-08');
    });

    it('clamps to the last day of shorter months', () => {
      // Jan 31 + 1 month must land on Feb 28, not spill into March
      const period = resolveEntitlementPeriod(
        { StartDate: '2026-01-31', Frequency: 'Monthly' },
        new Date('2026-02-10T00:00:00.000Z')
      );
      expect(period?.start.toISOString().slice(0, 10)).to.equal('2026-01-31');
      expect(period?.end.toISOString().slice(0, 10)).to.equal('2026-02-28');
    });

    it('returns null for a Once frequency (flat capacity, no period)', () => {
      expect(resolveEntitlementPeriod({ StartDate: '2025-02-12', Frequency: 'Once' }, NOW)).to.equal(null);
    });

    it('returns null when StartDate is missing', () => {
      expect(resolveEntitlementPeriod({ StartDate: null, Frequency: 'Monthly' }, NOW)).to.equal(null);
    });

    it('returns null when StartDate is in the future', () => {
      expect(resolveEntitlementPeriod({ StartDate: '2027-01-01', Frequency: 'Monthly' }, NOW)).to.equal(null);
    });

    it('returns null for an unknown frequency', () => {
      expect(resolveEntitlementPeriod({ StartDate: '2020-01-01', Frequency: 'Hourly' }, NOW)).to.equal(null);
    });
  });

  describe('computePercentPeriodElapsed', () => {
    it('computes the elapsed share of the window', () => {
      const period = { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-08-11T00:00:00Z') };
      expect(computePercentPeriodElapsed(period, new Date('2026-08-03T00:00:00Z'))).to.equal(20);
    });

    it('returns null without a period', () => {
      expect(computePercentPeriodElapsed(null, NOW)).to.equal(null);
    });

    it('clamps between 0 and 100', () => {
      const period = { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-08-11T00:00:00Z') };
      expect(computePercentPeriodElapsed(period, new Date('2027-01-01T00:00:00Z'))).to.equal(100);
      expect(computePercentPeriodElapsed(period, new Date('2026-01-01T00:00:00Z'))).to.equal(0);
    });
  });

  describe('computeDaysRemaining', () => {
    it('counts whole days to the end of the period', () => {
      const period = { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-08-11T00:00:00Z') };
      expect(computeDaysRemaining(period, new Date('2026-08-03T00:00:00Z'))).to.equal(8);
    });

    it('never goes negative', () => {
      const period = { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-08-11T00:00:00Z') };
      expect(computeDaysRemaining(period, new Date('2026-09-01T00:00:00Z'))).to.equal(0);
    });
  });

  describe('computeProjection', () => {
    it('projects consumption to the end of the period', () => {
      // 60% consumed with 30% of the period elapsed projects to 200%
      expect(computeProjection(60, 30)).to.equal(200);
    });

    it('returns null when too little of the period has elapsed', () => {
      expect(computeProjection(50, 4)).to.equal(null);
    });

    it('returns null when too little of the allowance is consumed', () => {
      expect(computeProjection(9, 50)).to.equal(null);
    });

    it('returns null when either input is null', () => {
      expect(computeProjection(null, 50)).to.equal(null);
      expect(computeProjection(50, null)).to.equal(null);
    });
  });

  describe('resolveEntitlementSeverity', () => {
    it('stays at log for any non-ok status', () => {
      expect(
        resolveEntitlementSeverity({ percentUsed: 99, projectedPercent: 400, status: 'not-metered' }, baseConfig)
      ).to.equal('log');
      expect(
        resolveEntitlementSeverity({ percentUsed: 99, projectedPercent: 400, status: 'muted' }, baseConfig)
      ).to.equal('log');
    });

    it('returns success below every threshold', () => {
      expect(resolveEntitlementSeverity({ percentUsed: 10, projectedPercent: 90, status: 'ok' }, baseConfig)).to.equal(
        'success'
      );
    });

    it('warns on projection alone while consumption is still low', () => {
      expect(resolveEntitlementSeverity({ percentUsed: 30, projectedPercent: 130, status: 'ok' }, baseConfig)).to.equal(
        'warning'
      );
    });

    it('errors on a projection above the error threshold', () => {
      expect(resolveEntitlementSeverity({ percentUsed: 30, projectedPercent: 160, status: 'ok' }, baseConfig)).to.equal(
        'error'
      );
    });

    it('uses flat consumption as a floor when no projection exists', () => {
      expect(resolveEntitlementSeverity({ percentUsed: 80, projectedPercent: null, status: 'ok' }, baseConfig)).to.equal(
        'error'
      );
      expect(resolveEntitlementSeverity({ percentUsed: 60, projectedPercent: null, status: 'ok' }, baseConfig)).to.equal(
        'warning'
      );
    });

    it('honours per-resource threshold overrides', () => {
      const severity = resolveEntitlementSeverity(
        { percentUsed: 30, projectedPercent: 115, status: 'ok' },
        baseConfig,
        { key: 'MaxCdpProfiles', projectionThresholdWarning: 110 }
      );
      expect(severity).to.equal('warning');
    });
  });

  describe('buildUsageEntitlementRow', () => {
    it('marks a row with no AmountUsed as not-metered and never as zero', () => {
      const row = buildUsageEntitlementRow(
        {
          Setting: 'setting/force.com/orgValue.MaxCdpProfiles',
          MasterLabel: 'Data Cloud Maximum Number of Known Profiles',
          CurrentAmountAllowed: 45000,
          AmountUsed: null,
          StartDate: '2025-02-12',
          EndDate: null,
          Frequency: 'Once',
          IsPersistentResource: true,
        },
        baseConfig,
        NOW
      );
      expect(row.status).to.equal('not-metered');
      expect(row.amountUsed).to.equal(null);
      expect(row.percentUsed).to.equal(null);
      expect(row.severity).to.equal('log');
    });

    it('marks a row with a zero or null allowance as no-allowance', () => {
      const row = buildUsageEntitlementRow(
        { Setting: 'setting/force.com/orgValue.RevOrderUsageAmount', CurrentAmountAllowed: 0, AmountUsed: 5 },
        baseConfig,
        NOW
      );
      expect(row.status).to.equal('no-allowance');
      expect(row.percentUsed).to.equal(null);
    });

    it('computes consumption and projection for a metered monthly entitlement', () => {
      const row = buildUsageEntitlementRow(
        {
          Setting: 'setting/force.com/orgValue.Provisioned30DayApiRequests',
          MasterLabel: 'API Request Limit per Month',
          CurrentAmountAllowed: 1000,
          AmountUsed: 600,
          StartDate: '2026-07-01',
          Frequency: 'Monthly',
        },
        baseConfig,
        new Date('2026-07-10T00:00:00.000Z')
      );
      expect(row.settingKey).to.equal('Provisioned30DayApiRequests');
      expect(row.status).to.equal('ok');
      expect(row.percentUsed).to.equal(60);
      expect(row.projectedPercent).to.be.greaterThan(150);
      expect(row.severity).to.equal('error');
    });

    it('mutes a resource configured with mute true', () => {
      const config: UsageEntitlementsConfig = {
        ...baseConfig,
        resources: { MaxCdpProfiles: { key: 'MaxCdpProfiles', mute: true } },
      };
      const row = buildUsageEntitlementRow(
        {
          Setting: 'setting/force.com/orgValue.MaxCdpProfiles',
          CurrentAmountAllowed: 100,
          AmountUsed: 99,
          StartDate: '2026-07-01',
          Frequency: 'Monthly',
        },
        config,
        NOW
      );
      expect(row.status).to.equal('muted');
      expect(row.severity).to.equal('log');
    });
  });

  describe('buildUsageEntitlementMetrics', () => {
    it('emits no per-resource metric for unmetered rows', () => {
      const rows = [
        buildUsageEntitlementRow(
          { Setting: 'setting/force.com/orgValue.MaxCdpProfiles', CurrentAmountAllowed: 100, AmountUsed: null },
          baseConfig,
          NOW
        ),
        buildUsageEntitlementRow(
          {
            Setting: 'setting/force.com/orgValue.MaxFlowUiExecutions',
            CurrentAmountAllowed: 1000,
            AmountUsed: 900,
            StartDate: '2026-07-01',
            Frequency: 'Monthly',
          },
          baseConfig,
          new Date('2026-07-20T00:00:00.000Z')
        ),
      ];
      const metrics = buildUsageEntitlementMetrics(rows);
      expect(metrics.UsageEnt_MaxCdpProfiles).to.equal(undefined);
      expect(metrics.UsageEnt_MaxFlowUiExecutions.value).to.equal(900);
      expect(metrics.UsageEnt_MaxFlowUiExecutions.percent).to.equal(90);
      expect(metrics.UsageEntitlementsMetered).to.equal(1);
      expect(metrics.UsageEntitlementsTotal).to.equal(2);
      expect(metrics.UsageEntitlementsAtRisk).to.equal(1);
    });
  });

  describe('sortUsageEntitlementRows', () => {
    it('puts the most at-risk rows first and unmetered rows last', () => {
      const rows = [
        { label: 'A', percentUsed: 10, projectedPercent: null },
        { label: 'B', percentUsed: null, projectedPercent: null },
        { label: 'C', percentUsed: 40, projectedPercent: 300 },
      ] as any[];
      const sorted = sortUsageEntitlementRows(rows);
      expect(sorted.map((row) => row.label)).to.deep.equal(['C', 'A', 'B']);
    });
  });
});
