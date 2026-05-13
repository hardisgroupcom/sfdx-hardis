import type { NotifMessage, NotificationChannelConfig } from "./types.js";

// Hardcoded per-notification-type routing defaults.
// User configuration (monitoringCommands[].notifications) overrides these per key.
// When a type is missing from this map, fallback thresholds in notificationConfig.ts apply
// (messaging: info, email: info, api: log).
//
// Whenever a new value is added to NotifMessage.type, add a matching entry here.
export const notificationDefaults: Record<NotifMessage["type"], NotificationChannelConfig> = {
  // Security & compliance: alert via messaging on warning+, email on error+
  AUDIT_TRAIL: { messaging: "warning", email: "error", api: "log" },
  UNSECURED_CONNECTED_APPS: { messaging: "warning", email: "error", api: "log" },
  CONNECTED_APPS: { messaging: "info", email: "warning", api: "log" },
  ORG_HEALTH_CHECK: { messaging: "warning", email: "error", api: "log" },

  // Runtime errors and platform health
  APEX_ERROR: { messaging: "warning", email: "error", api: "log" },
  FLOW_ERROR: { messaging: "warning", email: "error", api: "log" },
  APEX_FLEX_QUEUE: { messaging: "warning", email: "error", api: "log" },
  APEX_TESTS: { messaging: "warning", email: "error", api: "log" },
  ORG_LIMITS: { messaging: "warning", email: "error", api: "log" },

  // API and metadata hygiene
  LEGACY_API: { messaging: "warning", email: "error", api: "log" },
  APEX_API_VERSION: { messaging: "warning", email: "error", api: "log" },
  RELEASE_UPDATES: { messaging: "info", email: "warning", api: "log" },

  // Permissions & licenses
  LICENSES: { messaging: "info", email: "warning", api: "log" },
  UNUSED_LICENSES: { messaging: "info", email: "warning", api: "log" },
  LINT_ACCESS: { messaging: "warning", email: "error", api: "log" },
  UNDERUSED_PERMSETS: { messaging: "info", email: "warning", api: "log" },
  MINIMAL_PERMSETS: { messaging: "info", email: "warning", api: "log" },

  // Users
  ACTIVE_USERS: { messaging: "info", email: "warning", api: "log" },
  ACTIVE_USERS_CRM_WEEKLY: { messaging: "info", email: "warning", api: "log" },
  ACTIVE_USERS_EXPERIENCE_MONTHLY: { messaging: "info", email: "warning", api: "log" },
  UNUSED_USERS: { messaging: "info", email: "warning", api: "log" },
  UNUSED_USERS_CRM_6_MONTHS: { messaging: "info", email: "warning", api: "log" },
  UNUSED_USERS_EXPERIENCE_6_MONTHS: { messaging: "info", email: "warning", api: "log" },

  // Code & metadata quality
  UNUSED_METADATAS: { messaging: "info", email: "warning", api: "log" },
  METADATA_STATUS: { messaging: "info", email: "warning", api: "log" },
  MISSING_ATTRIBUTES: { messaging: "info", email: "warning", api: "log" },
  UNUSED_APEX_CLASSES: { messaging: "info", email: "warning", api: "log" },

  // Operational reports & summaries
  ORG_INFO: { messaging: "info", email: "info", api: "log" },
  BACKUP: { messaging: "info", email: "warning", api: "log" },
  DEPLOYMENT: { messaging: "info", email: "warning", api: "log" },
  DEPLOYMENTS: { messaging: "info", email: "warning", api: "log" },
  DORA_REPORT: { messaging: "info", email: "info", api: "log" },
  MONITORING_SUMMARY: { messaging: "info", email: "info", api: "log" },
  RELEASE_NOTES: { messaging: "info", email: "info", api: "log" },

  // Integrations
  SERVICENOW_REPORT: { messaging: "info", email: "warning", api: "log" },
  AGENTFORCE_CONVERSATIONS: { messaging: "info", email: "warning", api: "log" },
  AGENTFORCE_FEEDBACK: { messaging: "info", email: "warning", api: "log" },
};
