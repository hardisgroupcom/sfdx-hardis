import { Connection } from "@salesforce/core";
import { soqlQuery } from "./apiUtils.js";
import { getSeverityIcon } from "./notifUtils.js";
import { NotifSeverity } from "../notifProvider/types.js";

// TenantConsumptionAlert is labelled "Utilization Alert" in Salesforce. It holds the consumption
// and license-utilization alerts Salesforce itself raises on the org (the same ones surfaced in
// Digital Wallet), which is the only programmatic access to that data: Digital Wallet has no
// public Connect REST API.

// Index signature: rows are serialized straight to CSV, logElements and command output.
export interface ConsumptionAlertRow {
  [key: string]: any;
  name: string;
  alertType: string;
  alertScope: string;
  alertSubScope1: string;
  alertSubScope2: string;
  alertStatus: string;
  triggerValue: number | null;
  triggerType: string;
  notificationSent: boolean;
  alertTimestamp: string | null;
  severity: NotifSeverity;
  severityIcon: string;
}

export interface ConsumptionAlertsResult {
  // False when the org edition does not expose TenantConsumptionAlert at all.
  supported: boolean;
  reason?: string;
  alerts: ConsumptionAlertRow[];
}

// Confirmed against a production org: TriggerType is "ThresholdPercent" and TriggerValue holds
// the percentage crossed (25 / 50 / 75 observed).
//
// Salesforce raises one alert per threshold and leaves the earlier ones Active, so a single
// consumption card that has passed 75% shows up as three rows (25, 50, 75). Counting rows would
// report "3 alerts" for what is really one card at 75%, and would make a card that crossed more
// thresholds look worse than one that crossed fewer. Severity and the headline count are
// therefore driven by the highest threshold reached per scope.
const CRITICAL_TRIGGER_VALUE = 100;
const ERROR_TRIGGER_VALUE = 75;

const CONSUMPTION_ALERT_FIELDS = [
  "Id",
  "Name",
  "AlertType",
  "AlertScope",
  "AlertSubScope1",
  "AlertSubScope2",
  "AlertStatus",
  "TriggerValue",
  "TriggerType",
  "IsNotificationSent",
  "AlertTimestamp",
];

function isUnsupportedObjectError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error).toLowerCase();
  return (
    message.includes("invalid_type") ||
    message.includes("is not supported") ||
    message.includes("sobject type 'tenantconsumptionalert'")
  );
}

export async function queryConsumptionAlerts(conn: Connection): Promise<ConsumptionAlertsResult> {
  const query =
    `SELECT ${CONSUMPTION_ALERT_FIELDS.join(", ")} FROM TenantConsumptionAlert ` +
    `WHERE AlertStatus = 'Active' ORDER BY AlertTimestamp DESC`;
  try {
    const res = await soqlQuery(query, conn);
    const alerts = (res?.records ?? []).map((record: any) => buildConsumptionAlertRow(record));
    return { supported: true, alerts };
  } catch (error: any) {
    if (isUnsupportedObjectError(error)) {
      return {
        supported: false,
        reason: "TenantConsumptionAlert is not available on this org",
        alerts: [],
      };
    }
    throw error;
  }
}

export function buildConsumptionAlertRow(record: any): ConsumptionAlertRow {
  const triggerValue =
    record.TriggerValue === null || record.TriggerValue === undefined ? null : Number(record.TriggerValue);
  const severity: NotifSeverity = severityForTrigger(triggerValue);
  return {
    name: String(record.Name ?? ""),
    alertType: String(record.AlertType ?? ""),
    alertScope: String(record.AlertScope ?? ""),
    alertSubScope1: String(record.AlertSubScope1 ?? ""),
    alertSubScope2: String(record.AlertSubScope2 ?? ""),
    alertStatus: String(record.AlertStatus ?? ""),
    triggerValue,
    triggerType: String(record.TriggerType ?? ""),
    notificationSent: record.IsNotificationSent === true,
    alertTimestamp: record.AlertTimestamp ? String(record.AlertTimestamp) : null,
    severity,
    severityIcon: getSeverityIcon(severity),
  };
}

export interface ConsumptionAlertScope {
  scope: string;
  alertType: string;
  // Highest threshold reached on this scope, which is the one that matters.
  maxTriggerValue: number | null;
  triggerType: string;
  // How many threshold alerts Salesforce raised on this scope (the 25/50/75 ladder).
  alertCount: number;
  latestTimestamp: string | null;
  severity: NotifSeverity;
}

export function scopeKey(alert: ConsumptionAlertRow): string {
  return [alert.alertScope, alert.alertSubScope1, alert.alertSubScope2].filter(Boolean).join(" / ");
}

function severityForTrigger(triggerValue: number | null): NotifSeverity {
  if (triggerValue === null) {
    return "warning";
  }
  if (triggerValue >= CRITICAL_TRIGGER_VALUE) {
    return "critical";
  }
  return triggerValue >= ERROR_TRIGGER_VALUE ? "error" : "warning";
}

// Collapses the per-threshold ladder into one row per consumption scope.
export function groupAlertsByScope(alerts: ConsumptionAlertRow[]): ConsumptionAlertScope[] {
  const byScope = new Map<string, ConsumptionAlertScope>();
  for (const alert of alerts) {
    const key = scopeKey(alert) || alert.alertType || alert.name;
    const existing = byScope.get(key);
    if (!existing) {
      byScope.set(key, {
        scope: key,
        alertType: alert.alertType,
        maxTriggerValue: alert.triggerValue,
        triggerType: alert.triggerType,
        alertCount: 1,
        latestTimestamp: alert.alertTimestamp,
        severity: severityForTrigger(alert.triggerValue),
      });
      continue;
    }
    existing.alertCount++;
    if ((alert.triggerValue ?? -1) > (existing.maxTriggerValue ?? -1)) {
      existing.maxTriggerValue = alert.triggerValue;
      existing.triggerType = alert.triggerType;
      existing.severity = severityForTrigger(alert.triggerValue);
    }
    if (
      alert.alertTimestamp &&
      (!existing.latestTimestamp || alert.alertTimestamp > existing.latestTimestamp)
    ) {
      existing.latestTimestamp = alert.alertTimestamp;
    }
  }
  return [...byScope.values()].sort(
    (a, b) => (b.maxTriggerValue ?? -1) - (a.maxTriggerValue ?? -1) || a.scope.localeCompare(b.scope),
  );
}

export function resolveAlertsSeverity(scopes: ConsumptionAlertScope[]): NotifSeverity {
  if (scopes.length === 0) {
    return "log";
  }
  if (scopes.some((scope) => scope.severity === "critical")) {
    return "critical";
  }
  return scopes.some((scope) => scope.severity === "error") ? "error" : "warning";
}

// Metric-name-safe form of a scope: "PlatformServicesCard / Production / PrePurchased"
// becomes "PlatformServicesCard_Production_PrePurchased".
export function scopeMetricKey(scope: string): string {
  return scope.replace(/\s*\/\s*/g, "_").replace(/[^a-zA-Z0-9_]/g, "_");
}

export function buildConsumptionAlertMetrics(
  alerts: ConsumptionAlertRow[],
  scopes: ConsumptionAlertScope[],
): any {
  const thresholds = scopes
    .map((scope) => scope.maxTriggerValue)
    .filter((value): value is number => value !== null);
  // One series per consumption card, so each can be charted on its own. These are the Digital
  // Wallet cards (Data 360 Segmentation & Activation, Platform Services, ...), which is the only
  // programmatic visibility Salesforce gives into consumption-card burn: the card balances
  // themselves are UI-only. Cards are few, so per-card series carry no cardinality risk.
  const perScope: any = {};
  for (const scope of scopes) {
    if (scope.maxTriggerValue !== null) {
      perScope[`ConsumptionAlertPct_${scopeMetricKey(scope.scope)}`] = scope.maxTriggerValue;
    }
  }
  return {
    ...perScope,
    // Raw alert rows, kept so the ladder itself stays visible.
    ConsumptionAlertsActive: alerts.length,
    // Distinct consumption scopes in alert: the number that reflects reality.
    ConsumptionAlertsScopes: scopes.length,
    // Highest consumption threshold reached across every scope.
    ConsumptionAlertsMaxThreshold: thresholds.length ? Math.max(...thresholds) : 0,
    ConsumptionAlertsCritical: scopes.filter((scope) => scope.severity === "critical").length,
  };
}

export function formatConsumptionAlertScopeLine(scope: ConsumptionAlertScope): string {
  const trigger =
    scope.maxTriggerValue !== null ? ` at **${scope.maxTriggerValue}%**` : "";
  const ladder = scope.alertCount > 1 ? ` (${scope.alertCount} thresholds crossed)` : "";
  return `- ${scope.scope}${trigger}${ladder}`;
}
