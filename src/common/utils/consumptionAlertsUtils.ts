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

// TriggerValue is an int and the Digital Wallet threshold alerts are expressed in percent, so a
// value at or above 100 means the allowance itself was reached rather than a warning threshold.
// Isolated here so it is a one-line change if a real org shows different semantics.
const CRITICAL_TRIGGER_VALUE = 100;

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
  const severity: NotifSeverity =
    triggerValue !== null && triggerValue >= CRITICAL_TRIGGER_VALUE ? "error" : "warning";
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

export function resolveAlertsSeverity(alerts: ConsumptionAlertRow[]): NotifSeverity {
  if (alerts.length === 0) {
    return "log";
  }
  return alerts.some((alert) => alert.severity === "error") ? "error" : "warning";
}

export function buildConsumptionAlertMetrics(alerts: ConsumptionAlertRow[]): any {
  return {
    ConsumptionAlertsActive: alerts.length,
    ConsumptionAlertsCritical: alerts.filter((alert) => alert.severity === "error").length,
  };
}

export function formatConsumptionAlertLine(alert: ConsumptionAlertRow): string {
  const scope = [alert.alertScope, alert.alertSubScope1, alert.alertSubScope2].filter(Boolean).join(" / ");
  const trigger = alert.triggerValue !== null ? ` (**${alert.triggerValue}** ${alert.triggerType})` : "";
  return `- ${alert.alertType || alert.name}${scope ? `: ${scope}` : ""}${trigger}`;
}
