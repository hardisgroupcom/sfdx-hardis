import type { NotifMessage, NotificationChannelConfig } from "./types.js";

// Hardcoded per-notification-type routing defaults.
// User configuration (notificationConfig[]) overrides these per key.
// When a type is missing from this map, fallback thresholds in notificationConfig.ts apply
// (messaging: info, email: info, api: log).
//
// Each per-channel threshold MUST be a value in the type's `availableThresholds` list (see
// getAvailableThresholds() in notificationConfig.ts) -- that is: one of the severities the type
// can be emitted with, or "log" (universal "send every emission" floor), or "off". Any other
// value is implicitly equivalent to one of these (e.g. "error" on a type that only emits
// "warning" never fires -> "off"). The monitoring-defaults catalog clamps every entry below
// through clampThresholdToAvailable() as a safety net, but keep this file aligned so the source
// of truth matches the catalog output.
//
// Convention: api channel defaults to "log" for every type ("audit everything to the API"). Only
// override that when there is a specific reason -- the API/Grafana provider is expected to receive
// every emission.
//
// Whenever a new value is added to NotifMessage.type, add a matching entry here.
export const notificationDefaults: Record<NotifMessage["type"], NotificationChannelConfig> = {
  // Security & compliance
  AUDIT_TRAIL: { messaging: "warning", email: "off", api: "log" },
  UNSECURED_CONNECTED_APPS: { messaging: "error", email: "error", api: "log" },
  CONNECTED_APPS: { messaging: "warning", email: "warning", api: "log" },
  ORG_HEALTH_CHECK: { messaging: "warning", email: "error", api: "log" },

  // Runtime errors and platform health
  APEX_ERROR: { messaging: "error", email: "error", api: "log" },
  FLOW_ERROR: { messaging: "error", email: "error", api: "log" },
  APEX_FLEX_QUEUE: { messaging: "warning", email: "off", api: "log" },
  APEX_TESTS: { messaging: "error", email: "error", api: "log" },
  ORG_LIMITS: { messaging: "warning", email: "error", api: "log" },

  // API and metadata hygiene
  LEGACY_API: { messaging: "error", email: "error", api: "log" },
  APEX_API_VERSION: { messaging: "warning", email: "off", api: "log" },
  RELEASE_UPDATES: { messaging: "warning", email: "warning", api: "log" },

  // Permissions & licenses
  LICENSES: { messaging: "off", email: "off", api: "log" },
  UNUSED_LICENSES: { messaging: "warning", email: "warning", api: "log" },
  LINT_ACCESS: { messaging: "warning", email: "off", api: "log" },
  UNDERUSED_PERMSETS: { messaging: "warning", email: "warning", api: "log" },
  MINIMAL_PERMSETS: { messaging: "warning", email: "warning", api: "log" },

  // Users (informational reports - no actionable severity emitted)
  ACTIVE_USERS: { messaging: "off", email: "off", api: "log" },
  ACTIVE_USERS_CRM_WEEKLY: { messaging: "off", email: "off", api: "log" },
  ACTIVE_USERS_EXPERIENCE_MONTHLY: { messaging: "off", email: "off", api: "log" },
  UNUSED_USERS: { messaging: "off", email: "off", api: "log" },
  UNUSED_USERS_CRM_6_MONTHS: { messaging: "off", email: "off", api: "log" },
  UNUSED_USERS_EXPERIENCE_6_MONTHS: { messaging: "off", email: "off", api: "log" },

  // Code & metadata quality
  UNUSED_METADATAS: { messaging: "warning", email: "warning", api: "log" },
  METADATA_STATUS: { messaging: "warning", email: "warning", api: "log" },
  MISSING_ATTRIBUTES: { messaging: "warning", email: "warning", api: "log" },
  UNUSED_APEX_CLASSES: { messaging: "warning", email: "warning", api: "log" },

  // Operational reports & summaries
  ORG_INFO: { messaging: "off", email: "off", api: "log" },
  BACKUP: { messaging: "info", email: "off", api: "log" },
  DEPLOYMENT: { messaging: "info", email: "warning", api: "log" },
  DEPLOYMENTS: { messaging: "warning", email: "warning", api: "log" },
  DORA_REPORT: { messaging: "info", email: "info", api: "log" },
  MONITORING_SUMMARY: { messaging: "info", email: "info", api: "log" },
  RELEASE_NOTES: { messaging: "info", email: "info", api: "log" },

  // Integrations
  SERVICENOW_REPORT: { messaging: "off", email: "off", api: "log" },
  AGENTFORCE_CONVERSATIONS: { messaging: "off", email: "off", api: "log" },
  AGENTFORCE_FEEDBACK: { messaging: "warning", email: "warning", api: "log" },
};
