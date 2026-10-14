import { expect } from 'chai';
import {
  estimateCreditCost,
  estimateEntitlementCost,
  formatCost,
  sumEstimatedCosts,
  UsageCostConfig,
} from '../../../src/common/utils/usageCostUtils.js';

const rate = (key: string, unitPrice: number, model: 'overage' | 'total' = 'overage') => ({
  key,
  unitPrice,
  model,
});

const config: UsageCostConfig = {
  enabled: true,
  currency: 'EUR',
  flexCreditUnitPrice: 0.005,
  resources: {
    MaxCustomerNetworkLogins: rate('MaxCustomerNetworkLogins', 0.12),
    'setting/force.com/orgValue.MaxCustomerNetworkLogins': rate('MaxCustomerNetworkLogins', 0.12),
    MaxFlowUiExecutions: rate('MaxFlowUiExecutions', 0.001, 'total'),
  },
};

describe('usageCostUtils', () => {
  describe('estimateEntitlementCost', () => {
    // Reference org: 828 logins consumed against an allowance of 600 -> 228 over.
    it('charges only the overage by default', () => {
      const cost = estimateEntitlementCost(
        {
          settingKey: 'MaxCustomerNetworkLogins',
          setting: 'setting/force.com/orgValue.MaxCustomerNetworkLogins',
          amountUsed: 828,
          amountAllowed: 600,
        },
        config
      );
      expect(cost).to.equal(27.36);
    });

    it('charges nothing when consumption is within the allowance', () => {
      const cost = estimateEntitlementCost(
        { settingKey: 'MaxCustomerNetworkLogins', setting: '', amountUsed: 400, amountAllowed: 600 },
        config
      );
      expect(cost).to.equal(0);
    });

    it('charges every unit under the total model', () => {
      const cost = estimateEntitlementCost(
        { settingKey: 'MaxFlowUiExecutions', setting: '', amountUsed: 23925, amountAllowed: 20071400 },
        config
      );
      expect(cost).to.equal(23.93);
    });

    // Unpriced must stay distinguishable from free: a zero would read as "this costs nothing".
    it('returns null for a resource with no configured rate', () => {
      const cost = estimateEntitlementCost(
        { settingKey: 'B2bcommPkgActiveStorefronts', setting: '', amountUsed: 2, amountAllowed: 5 },
        config
      );
      expect(cost).to.equal(null);
    });

    it('returns null when Salesforce reports no consumption', () => {
      const cost = estimateEntitlementCost(
        { settingKey: 'MaxCustomerNetworkLogins', setting: '', amountUsed: null, amountAllowed: 600 },
        config
      );
      expect(cost).to.equal(null);
    });

    // Two different Settings can share a trailing token, so an exact match must win.
    it('prefers the rate keyed by the full Setting over the trailing-token shorthand', () => {
      const collidingConfig: UsageCostConfig = {
        ...config,
        resources: {
          MaxLimit: rate('MaxLimit', 1),
          'setting/force.com/orgValue.MaxLimit': rate('setting/force.com/orgValue.MaxLimit', 10),
        },
      };
      const cost = estimateEntitlementCost(
        {
          settingKey: 'MaxLimit',
          setting: 'setting/force.com/orgValue.MaxLimit',
          amountUsed: 12,
          amountAllowed: 10,
        },
        collidingConfig
      );
      // 2 over the allowance at the exact rate of 10, not the shorthand rate of 1.
      expect(cost).to.equal(20);
    });

    it('resolves a rate by the full Setting value as well as the trailing token', () => {
      const cost = estimateEntitlementCost(
        {
          settingKey: 'Unknown',
          setting: 'setting/force.com/orgValue.MaxCustomerNetworkLogins',
          amountUsed: 700,
          amountAllowed: 600,
        },
        config
      );
      expect(cost).to.equal(12);
    });
  });

  describe('estimateCreditCost', () => {
    it('applies the flat credit rate', () => {
      expect(estimateCreditCost(7197, config)).to.equal(35.99);
    });

    // toFixed(2) rounds 35.985 down to 35.98 because of binary representation; money must round
    // half up or every half-cent amount is quietly understated.
    it('rounds half cents up rather than down', () => {
      expect(estimateCreditCost(7197, config)).to.equal(35.99);
      expect(estimateCreditCost(201, { ...config, flexCreditUnitPrice: 0.005 })).to.equal(1.01);
    });

    it('returns null when no credit rate is configured', () => {
      expect(estimateCreditCost(7197, { ...config, flexCreditUnitPrice: null })).to.equal(null);
    });
  });

  describe('sumEstimatedCosts', () => {
    it('ignores unpriced rows', () => {
      expect(sumEstimatedCosts([12.5, null, 7.25, null])).to.equal(19.75);
    });

    it('returns null when nothing could be costed', () => {
      expect(sumEstimatedCosts([null, null])).to.equal(null);
    });

    it('returns zero when everything priced is free', () => {
      expect(sumEstimatedCosts([0, null, 0])).to.equal(0);
    });
  });

  describe('formatCost', () => {
    it('renders the amount with the configured currency', () => {
      expect(formatCost(35.9876, config)).to.equal('35.99 EUR');
    });
  });
});
