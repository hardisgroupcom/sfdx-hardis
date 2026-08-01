import { Connection } from "@salesforce/core";
import c from "chalk";
import { soqlQuery } from "./apiUtils.js";
import { uxLog } from "./index.js";
import { getSeverityIcon } from "./notifUtils.js";
import { getConfig, getEnvVar } from "../../config/index.js";
import { NotifSeverity } from "../notifProvider/types.js";

// Usage-based entitlements are the contractual consumption meters shown in
// Setup > Company Information > Usage-Based Entitlements. Unlike `sf org limits list`
// (daily/hourly throttling), these are what Salesforce actually bills on.
//
// Field notes gathered from a live org (API 67.0):
// - ResourceGroupKey is the literal "(tenant)" on every row: it cannot be used as a key.
//   `Setting` (e.g. "setting/force.com/orgValue.MaxCdpProfiles") is the stable identifier.
// - MasterLabel is sortable=false / filterable=false: it must never appear in ORDER BY or WHERE.
// - EndDate is usually null, so the current period has to be derived from StartDate + Frequency.
// - AmountUsed is null when the resource is not metered yet. Null must never be read as zero.

export type EntitlementFrequency =
  | "Daily"
  | "Weekly"
  | "Fortnightly"
  | "Monthly"
  | "Once"
  | "Quarterly"
  | "Yearly";

// `not-metered`: Salesforce reports no AmountUsed for this resource.
// `no-allowance`: CurrentAmountAllowed is null or <= 0, so no percentage can be computed.
// `muted`: the user switched this resource off in .sfdx-hardis.yml.
export type EntitlementStatus = "ok" | "not-metered" | "no-allowance" | "muted";

// Index signature: these rows are serialized straight to CSV, logElements and command output,
// so they must be assignable to AnyJson.
export interface UsageEntitlementRow {
  [key: string]: any;
  settingKey: string;
  setting: string;
  label: string;
  amountUsed: number | null;
  amountAllowed: number | null;
  percentUsed: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  percentPeriodElapsed: number | null;
  projectedPercent: number | null;
  daysRemaining: number | null;
  frequency: EntitlementFrequency | string;
  hasRollover: boolean;
  overageGrace: number | null;
  isPersistentResource: boolean;
  status: EntitlementStatus;
  severity: NotifSeverity;
  severityIcon: string;
}

export interface UsageEntitlementResourceConfig {
  key: string;
  projectionThresholdWarning?: number;
  projectionThresholdError?: number;
  percentThresholdWarning?: number;
  percentThresholdError?: number;
  mute?: boolean;
}

export interface UsageEntitlementsConfig {
  projectionThresholdWarning: number;
  projectionThresholdError: number;
  percentThresholdWarning: number;
  percentThresholdError: number;
  resources: Record<string, UsageEntitlementResourceConfig>;
}

export const DEFAULT_PROJECTION_THRESHOLD_WARNING = 120;
export const DEFAULT_PROJECTION_THRESHOLD_ERROR = 150;

// A projection is only meaningful once enough of the period has elapsed AND enough of the
// allowance has been consumed. Without these guards, a single unit consumed on day one of a
// monthly period projects to an absurd multiple and floods the notification with noise.
const MIN_PERCENT_ELAPSED = 5;
const MIN_PERCENT_USED = 10;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const USAGE_ENTITLEMENT_FIELDS = [
  "Id",
  "MasterLabel",
  "ResourceGroupKey",
  "Setting",
  "CurrentAmountAllowed",
  "AmountUsed",
  "StartDate",
  "EndDate",
  "Frequency",
  "HasRollover",
  "OverageGrace",
  "IsPersistentResource",
  "UsageDate",
];

// No ORDER BY: MasterLabel is not sortable and Salesforce rejects the query. Sorting is done
// client-side once projections are computed.
export async function queryUsageEntitlements(conn: Connection): Promise<any[]> {
  const query = `SELECT ${USAGE_ENTITLEMENT_FIELDS.join(", ")} FROM TenantUsageEntitlement`;
  const res = await soqlQuery(query, conn);
  return res?.records ?? [];
}

// "setting/force.com/orgValue.MaxCdpProfiles" -> "MaxCdpProfiles"
export function parseSettingKey(setting: string | null | undefined): string {
  if (!setting) {
    return "";
  }
  const lastDot = setting.lastIndexOf(".");
  return lastDot >= 0 && lastDot < setting.length - 1 ? setting.slice(lastDot + 1) : setting;
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  // Salesforce date fields come back as YYYY-MM-DD. Anchor at UTC midnight so period
  // arithmetic never drifts with the runner's timezone.
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const targetDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  // Clamp to the last day of the target month (e.g. Jan 31 + 1 month -> Feb 28/29)
  const daysInTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(targetDay, daysInTargetMonth));
  return result;
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export interface EntitlementPeriod {
  start: Date;
  end: Date;
}

// Rolls the entitlement window forward from StartDate until it contains `now`.
// Returns null when no period applies (Frequency "Once", missing StartDate, or a future StartDate).
export function resolveEntitlementPeriod(
  record: { StartDate?: string | null; EndDate?: string | null; Frequency?: string | null },
  now: Date = new Date(),
): EntitlementPeriod | null {
  const start = parseDateOnly(record.StartDate);
  if (!start) {
    return null;
  }
  const explicitEnd = parseDateOnly(record.EndDate);
  if (explicitEnd) {
    return explicitEnd > start ? { start, end: explicitEnd } : null;
  }
  if (start > now) {
    return null;
  }

  const frequency = String(record.Frequency || "");
  const dayStep: Record<string, number> = { Daily: 1, Weekly: 7, Fortnightly: 14 };
  const monthStep: Record<string, number> = { Monthly: 1, Quarterly: 3, Yearly: 12 };

  if (dayStep[frequency]) {
    const step = dayStep[frequency];
    const elapsedPeriods = Math.floor((now.getTime() - start.getTime()) / (step * MS_PER_DAY));
    const periodStart = addDaysUtc(start, elapsedPeriods * step);
    return { start: periodStart, end: addDaysUtc(periodStart, step) };
  }

  if (monthStep[frequency]) {
    const step = monthStep[frequency];
    // Walk forward month-by-month rather than estimating, so month lengths stay exact.
    let periodStart = start;
    let periodEnd = addMonthsUtc(periodStart, step);
    let guard = 0;
    while (periodEnd <= now && guard < 5000) {
      periodStart = periodEnd;
      periodEnd = addMonthsUtc(periodStart, step);
      guard++;
    }
    return { start: periodStart, end: periodEnd };
  }

  // "Once" and any unknown frequency: flat capacity, no period.
  return null;
}

export function computePercentPeriodElapsed(
  period: EntitlementPeriod | null,
  now: Date = new Date(),
): number | null {
  if (!period) {
    return null;
  }
  const total = period.end.getTime() - period.start.getTime();
  if (total <= 0) {
    return null;
  }
  const elapsed = now.getTime() - period.start.getTime();
  const percent = (100 * elapsed) / total;
  return Math.min(100, Math.max(0, roundTo(percent, 2)));
}

export function computeDaysRemaining(
  period: EntitlementPeriod | null,
  now: Date = new Date(),
): number | null {
  if (!period) {
    return null;
  }
  return Math.max(0, Math.ceil((period.end.getTime() - now.getTime()) / MS_PER_DAY));
}

// Projected end-of-period consumption, expressed as a percentage of the allowance.
// 143 means "at this rate, 143% of the allowance will be consumed before the period ends".
export function computeProjection(
  percentUsed: number | null,
  percentPeriodElapsed: number | null,
): number | null {
  if (percentUsed === null || percentPeriodElapsed === null) {
    return null;
  }
  if (percentPeriodElapsed < MIN_PERCENT_ELAPSED || percentUsed < MIN_PERCENT_USED) {
    return null;
  }
  return roundTo((percentUsed / percentPeriodElapsed) * 100, 2);
}

function roundTo(value: number, decimals: number): number {
  return parseFloat(value.toFixed(decimals));
}

const SEVERITY_RANK: Record<string, number> = { log: 0, success: 1, info: 2, warning: 3, error: 4, critical: 5 };

function maxSeverity(a: NotifSeverity, b: NotifSeverity): NotifSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function toPositiveNumber(value: any): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Reads the `usageEntitlements` block of .sfdx-hardis.yml, then lets env vars win over it so a
// pipeline can tighten thresholds without editing the repo config.
export async function resolveUsageEntitlementsConfig(): Promise<UsageEntitlementsConfig> {
  const config = await getConfig("user");
  const block = config?.usageEntitlements ?? {};

  const resources: Record<string, UsageEntitlementResourceConfig> = {};
  for (const resource of block.resources ?? []) {
    if (!resource?.key) {
      continue;
    }
    // Index by both the trailing token and the full Setting string so either form works in YAML.
    resources[resource.key] = resource;
    resources[parseSettingKey(resource.key)] = resource;
  }

  return {
    projectionThresholdWarning:
      toPositiveNumber(getEnvVar("USAGE_PROJECTION_THRESHOLD_WARNING")) ??
      toPositiveNumber(block.projectionThresholdWarning) ??
      DEFAULT_PROJECTION_THRESHOLD_WARNING,
    projectionThresholdError:
      toPositiveNumber(getEnvVar("USAGE_PROJECTION_THRESHOLD_ERROR")) ??
      toPositiveNumber(block.projectionThresholdError) ??
      DEFAULT_PROJECTION_THRESHOLD_ERROR,
    // Reuse the org-limits thresholds so both limit-style commands stay consistent.
    percentThresholdWarning:
      toPositiveNumber(getEnvVar("LIMIT_THRESHOLD_WARNING")) ??
      toPositiveNumber(block.percentThresholdWarning) ??
      50,
    percentThresholdError:
      toPositiveNumber(getEnvVar("LIMIT_THRESHOLD_ERROR")) ??
      toPositiveNumber(block.percentThresholdError) ??
      75,
    resources,
  };
}

export function resolveEntitlementSeverity(
  row: Pick<UsageEntitlementRow, "percentUsed" | "projectedPercent" | "status">,
  config: UsageEntitlementsConfig,
  resourceConfig?: UsageEntitlementResourceConfig,
): NotifSeverity {
  if (row.status !== "ok") {
    return "log";
  }

  const percentWarning = resourceConfig?.percentThresholdWarning ?? config.percentThresholdWarning;
  const percentError = resourceConfig?.percentThresholdError ?? config.percentThresholdError;
  const projectionWarning =
    resourceConfig?.projectionThresholdWarning ?? config.projectionThresholdWarning;
  const projectionError = resourceConfig?.projectionThresholdError ?? config.projectionThresholdError;

  let severity: NotifSeverity = "success";

  if (row.percentUsed !== null) {
    if (row.percentUsed > percentError) {
      severity = maxSeverity(severity, "error");
    } else if (row.percentUsed > percentWarning) {
      severity = maxSeverity(severity, "warning");
    }
  }

  if (row.projectedPercent !== null) {
    if (row.projectedPercent >= projectionError) {
      severity = maxSeverity(severity, "error");
    } else if (row.projectedPercent >= projectionWarning) {
      severity = maxSeverity(severity, "warning");
    }
  }

  return severity;
}

export function buildUsageEntitlementRow(
  record: any,
  config: UsageEntitlementsConfig,
  now: Date = new Date(),
): UsageEntitlementRow {
  const setting = String(record.Setting ?? "");
  const settingKey = parseSettingKey(setting);
  const resourceConfig = config.resources[settingKey] ?? config.resources[setting];

  const amountUsed = record.AmountUsed === null || record.AmountUsed === undefined ? null : Number(record.AmountUsed);
  const amountAllowed =
    record.CurrentAmountAllowed === null || record.CurrentAmountAllowed === undefined
      ? null
      : Number(record.CurrentAmountAllowed);

  let status: EntitlementStatus = "ok";
  if (resourceConfig?.mute === true) {
    status = "muted";
  } else if (amountUsed === null) {
    status = "not-metered";
  } else if (amountAllowed === null || amountAllowed <= 0) {
    status = "no-allowance";
  }

  const percentUsed =
    status === "ok" && amountUsed !== null && amountAllowed
      ? roundTo((100 * amountUsed) / amountAllowed, 2)
      : null;

  const period = resolveEntitlementPeriod(record, now);
  const percentPeriodElapsed = computePercentPeriodElapsed(period, now);
  const projectedPercent = status === "ok" ? computeProjection(percentUsed, percentPeriodElapsed) : null;

  const partialRow = { percentUsed, projectedPercent, status };
  const severity = resolveEntitlementSeverity(partialRow, config, resourceConfig);

  return {
    settingKey,
    setting,
    label: String(record.MasterLabel ?? settingKey),
    amountUsed,
    amountAllowed,
    percentUsed,
    periodStart: period ? period.start.toISOString().slice(0, 10) : null,
    periodEnd: period ? period.end.toISOString().slice(0, 10) : null,
    percentPeriodElapsed,
    projectedPercent,
    daysRemaining: computeDaysRemaining(period, now),
    frequency: String(record.Frequency ?? ""),
    hasRollover: record.HasRollover === true,
    overageGrace: record.OverageGrace === null || record.OverageGrace === undefined ? null : Number(record.OverageGrace),
    isPersistentResource: record.IsPersistentResource === true,
    status,
    severity,
    severityIcon: getSeverityIcon(severity),
  };
}

// Most at-risk first: rows with a projection, then rows with a percentage, then the rest.
export function sortUsageEntitlementRows(rows: UsageEntitlementRow[]): UsageEntitlementRow[] {
  return [...rows].sort((a, b) => {
    const aScore = a.projectedPercent ?? a.percentUsed ?? -1;
    const bScore = b.projectedPercent ?? b.percentUsed ?? -1;
    if (aScore !== bScore) {
      return bScore - aScore;
    }
    return a.label.localeCompare(b.label);
  });
}

// Metric names are prefixed so they are self-describing in Prometheus and cannot be confused
// with the org-limits series. Not-metered rows emit nothing, so no fake zero ever lands.
export function buildUsageEntitlementMetrics(rows: UsageEntitlementRow[]): any {
  const metrics: any = {};
  let metered = 0;
  let atRisk = 0;

  for (const row of rows) {
    if (row.status !== "ok" || row.amountUsed === null) {
      continue;
    }
    metered++;
    if (row.severity === "warning" || row.severity === "error") {
      atRisk++;
    }
    const safeKey = row.settingKey.replace(/[^a-zA-Z0-9_]/g, "_");
    metrics[`UsageEnt_${safeKey}`] = {
      value: row.amountUsed,
      max: row.amountAllowed ?? 0,
      percent: row.percentUsed ?? 0,
    };
    if (row.projectedPercent !== null) {
      metrics[`UsageEntProjected_${safeKey}`] = row.projectedPercent;
    }
  }

  metrics.UsageEntitlementsAtRisk = atRisk;
  metrics.UsageEntitlementsMetered = metered;
  metrics.UsageEntitlementsTotal = rows.length;
  return metrics;
}

export function formatUsageEntitlementLine(row: UsageEntitlementRow): string {
  const used = row.percentUsed !== null ? `${row.percentUsed}% used` : "usage unknown";
  const projected =
    row.projectedPercent !== null ? `, projected **${row.projectedPercent}%** at period end` : "";
  return `- ${row.label}: ${used}${projected}`;
}

export function logUsageEntitlementSummary(commandThis: any, rows: UsageEntitlementRow[]): void {
  const notMetered = rows.filter((row) => row.status === "not-metered").length;
  const muted = rows.filter((row) => row.status === "muted").length;
  if (notMetered > 0) {
    uxLog(
      "log",
      commandThis,
      c.grey(`${notMetered} entitlement(s) report no usage data and are excluded from alerting`),
    );
  }
  if (muted > 0) {
    uxLog("log", commandThis, c.grey(`${muted} entitlement(s) muted by configuration`));
  }
}
