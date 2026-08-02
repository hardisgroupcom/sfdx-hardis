import { getConfig, getEnvVar } from "../../config/index.js";

// Cost estimation for consumption-billed Salesforce products.
//
// Salesforce publishes no prices through any API: TenantUsageEntitlement, TenantConsumptionAlert
// and the Agentforce usage model all carry quantities and no rates, and contracted prices live in
// the order form. Every figure here therefore comes from rates the user configures, and is an
// ESTIMATE rather than an invoice. Nothing is costed unless a rate was declared for it, so an
// unpriced resource reports no cost instead of a misleading zero.
//
// Rates are opt-in per resource by design. Plenty of entitlements are hard caps rather than
// meters ("B2B Commerce Total Storefronts: 2 of 5"), and applying a blanket rate to those would
// invent charges that do not exist.

// How consumption converts to money for a given resource.
// - `overage`: the allowance is prepaid, only consumption beyond it is charged (the common case)
// - `total`: every unit consumed is charged (pay-as-you-go)
export type UsageCostModel = "overage" | "total";

export interface UsageCostResourceRate {
  key: string;
  unitPrice: number;
  model?: UsageCostModel;
}

export interface UsageCostConfig {
  // True when at least one rate is configured. When false, callers must emit no cost at all.
  enabled: boolean;
  currency: string;
  flexCreditUnitPrice: number | null;
  resources: Record<string, UsageCostResourceRate>;
}

export const DEFAULT_CURRENCY = "USD";

function toRate(value: any): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

// "setting/force.com/orgValue.MaxCdpProfiles" -> "MaxCdpProfiles"
function trailingToken(key: string): string {
  const lastDot = key.lastIndexOf(".");
  return lastDot >= 0 && lastDot < key.length - 1 ? key.slice(lastDot + 1) : key;
}

export async function resolveUsageCostConfig(): Promise<UsageCostConfig> {
  const config = await getConfig("user");
  const block = config?.usageCost ?? {};

  const resources: Record<string, UsageCostResourceRate> = {};
  for (const entry of block.resources ?? []) {
    const unitPrice = toRate(entry?.unitPrice);
    if (!entry?.key || unitPrice === null) {
      continue;
    }
    const rate: UsageCostResourceRate = {
      key: entry.key,
      unitPrice,
      model: entry.model === "total" ? "total" : "overage",
    };
    // Accept both the full Setting value and its trailing token, like the threshold overrides.
    resources[entry.key] = rate;
    const token = trailingToken(entry.key);
    // Two different Setting values can end in the same token. First declaration wins the
    // shorthand rather than being silently overwritten; the full Setting entry stays exact for
    // both, and lookup tries that first.
    if (token !== entry.key && !(token in resources)) {
      resources[token] = rate;
    }
  }

  const flexCreditUnitPrice =
    toRate(getEnvVar("USAGE_COST_CREDIT_UNIT_PRICE")) ?? toRate(block.flexCredits?.unitPrice);

  return {
    enabled: Object.keys(resources).length > 0 || flexCreditUnitPrice !== null,
    currency: String(getEnvVar("USAGE_COST_CURRENCY") || block.currency || DEFAULT_CURRENCY).toUpperCase(),
    flexCreditUnitPrice,
    resources,
  };
}

// Money rounding, half up. Deliberately not toFixed(2): binary representation makes it round
// 35.985 down to 35.98, which quietly understates every amount that lands on a half cent.
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Estimated cost of a single entitlement. Returns null when no rate was configured for it, or
// when Salesforce reports no consumption, so the caller can distinguish "free" from "unpriced".
export function estimateEntitlementCost(
  row: { settingKey: string; setting: string; amountUsed: number | null; amountAllowed: number | null },
  config: UsageCostConfig,
): number | null {
  // Full Setting first: an exact match always beats the trailing-token shorthand.
  const rate = config.resources[row.setting] ?? config.resources[row.settingKey];
  if (!rate || row.amountUsed === null) {
    return null;
  }
  if (rate.model === "total") {
    return round2(row.amountUsed * rate.unitPrice);
  }
  const allowance = row.amountAllowed ?? 0;
  const overage = Math.max(0, row.amountUsed - allowance);
  return round2(overage * rate.unitPrice);
}

// Flat rate applied to every credit. Flex Credits tier down with volume (to 80%, 40% then 20% of
// the base rate), so a flat rate is an UPPER BOUND: the real charge is at most this. Erring high
// is deliberate, an estimate that understates spend would be worse than useless.
export function estimateCreditCost(credits: number, config: UsageCostConfig): number | null {
  if (config.flexCreditUnitPrice === null) {
    return null;
  }
  return round2(credits * config.flexCreditUnitPrice);
}

export function formatCost(amount: number, config: UsageCostConfig): string {
  return `${amount.toFixed(2)} ${config.currency}`;
}

// Sums the per-row estimates, ignoring unpriced rows. Returns null when nothing could be costed.
export function sumEstimatedCosts(costs: (number | null)[]): number | null {
  const priced = costs.filter((cost): cost is number => cost !== null);
  return priced.length ? round2(priced.reduce((sum, cost) => sum + cost, 0)) : null;
}
