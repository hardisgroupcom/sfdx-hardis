import { expect } from 'chai';
import {
  buildConsumptionAlertMetrics,
  buildConsumptionAlertRow,
  groupAlertsByScope,
  resolveAlertsSeverity,
} from '../../../src/common/utils/consumptionAlertsUtils.js';

// Rows captured from a production org. Salesforce raises one alert per threshold and leaves the
// earlier ones Active, so a single card that has passed 75% arrives as a 25/50/75 ladder.
const REAL_ALERTS = [
  {
    Name: 'TCA-00000004',
    AlertType: 'sf__ConsumptionThreshold',
    AlertScope: 'PlatformServicesCard',
    AlertSubScope1: 'Production',
    AlertSubScope2: 'PrePurchased',
    AlertStatus: 'Active',
    TriggerValue: 75,
    TriggerType: 'ThresholdPercent',
    IsNotificationSent: true,
    AlertTimestamp: '2026-04-26T22:03:45.000+0000',
  },
  {
    Name: 'TCA-00000003',
    AlertType: 'sf__ConsumptionThreshold',
    AlertScope: 'PlatformServicesCard',
    AlertSubScope1: 'Production',
    AlertSubScope2: 'PrePurchased',
    AlertStatus: 'Active',
    TriggerValue: 50,
    TriggerType: 'ThresholdPercent',
    IsNotificationSent: true,
    AlertTimestamp: '2025-11-07T23:04:01.000+0000',
  },
  {
    Name: 'TCA-00000002',
    AlertType: 'sf__ConsumptionThreshold',
    AlertScope: 'PlatformServicesCard',
    AlertSubScope1: 'Production',
    AlertSubScope2: 'PrePurchased',
    AlertStatus: 'Active',
    TriggerValue: 25,
    TriggerType: 'ThresholdPercent',
    IsNotificationSent: true,
    AlertTimestamp: '2025-09-29T22:06:14.000+0000',
  },
  {
    Name: 'TCA-00000001',
    AlertType: 'sf__ConsumptionThreshold',
    AlertScope: 'SegmentationsActivations',
    AlertSubScope1: 'Production',
    AlertSubScope2: 'PrePurchased',
    AlertStatus: 'Active',
    TriggerValue: 50,
    TriggerType: 'ThresholdPercent',
    IsNotificationSent: true,
    AlertTimestamp: '2025-09-29T22:04:01.000+0000',
  },
].map(buildConsumptionAlertRow);

describe('consumptionAlertsUtils', () => {
  describe('groupAlertsByScope', () => {
    const scopes = groupAlertsByScope(REAL_ALERTS);

    it('collapses the threshold ladder into one row per consumption card', () => {
      expect(scopes.length).to.equal(2);
    });

    it('keeps the highest threshold reached on each card', () => {
      expect(scopes[0].scope).to.equal('PlatformServicesCard / Production / PrePurchased');
      expect(scopes[0].maxTriggerValue).to.equal(75);
      expect(scopes[0].alertCount).to.equal(3);
      expect(scopes[1].maxTriggerValue).to.equal(50);
    });

    it('sorts the most consumed card first', () => {
      expect(scopes.map((s) => s.maxTriggerValue)).to.deep.equal([75, 50]);
    });

    it('keeps the most recent timestamp of the ladder', () => {
      expect(scopes[0].latestTimestamp).to.equal('2026-04-26T22:03:45.000+0000');
    });
  });

  describe('resolveAlertsSeverity', () => {
    it('is log when nothing is active', () => {
      expect(resolveAlertsSeverity([])).to.equal('log');
    });

    it('is error at the 75% threshold', () => {
      expect(resolveAlertsSeverity(groupAlertsByScope(REAL_ALERTS))).to.equal('error');
    });

    it('is warning below 75%', () => {
      const lowOnly = groupAlertsByScope(REAL_ALERTS.filter((a) => (a.triggerValue ?? 0) < 75));
      expect(resolveAlertsSeverity(lowOnly)).to.equal('warning');
    });

    it('is critical once the full allowance is reached', () => {
      const maxed = groupAlertsByScope([
        buildConsumptionAlertRow({
          AlertScope: 'PlatformServicesCard',
          AlertStatus: 'Active',
          TriggerValue: 100,
          TriggerType: 'ThresholdPercent',
        }),
      ]);
      expect(resolveAlertsSeverity(maxed)).to.equal('critical');
    });
  });

  describe('buildConsumptionAlertMetrics', () => {
    it('reports scopes and the highest threshold, not just the raw alert count', () => {
      const scopes = groupAlertsByScope(REAL_ALERTS);
      const metrics = buildConsumptionAlertMetrics(REAL_ALERTS, scopes);
      expect(metrics.ConsumptionAlertsActive).to.equal(4);
      expect(metrics.ConsumptionAlertsScopes).to.equal(2);
      expect(metrics.ConsumptionAlertsMaxThreshold).to.equal(75);
      expect(metrics.ConsumptionAlertsCritical).to.equal(0);
    });

    // Digital Wallet consumption cards are the only programmatic view of Data 360 credit burn,
    // so each card needs its own series to be chartable over time.
    it('emits one series per consumption card', () => {
      const metrics = buildConsumptionAlertMetrics(REAL_ALERTS, groupAlertsByScope(REAL_ALERTS));
      expect(metrics.ConsumptionAlertPct_PlatformServicesCard_Production_PrePurchased).to.equal(75);
      expect(metrics.ConsumptionAlertPct_SegmentationsActivations_Production_PrePurchased).to.equal(50);
    });

    it('reports zeroes when nothing is active', () => {
      const metrics = buildConsumptionAlertMetrics([], []);
      expect(metrics.ConsumptionAlertsScopes).to.equal(0);
      expect(metrics.ConsumptionAlertsMaxThreshold).to.equal(0);
    });
  });
});
