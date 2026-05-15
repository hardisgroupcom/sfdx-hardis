export type NotifSeverity = "critical" | "error" | "warning" | "info" | "success" | "log";

export type NotificationChannel = "messaging" | "email" | "api";

export type NotificationThreshold = NotifSeverity | "off";

export interface EmailChannelObject {
  threshold?: NotificationThreshold;
  recipients?: string[];
  replaceRecipients?: boolean;
}

export type EmailChannelConfig = NotificationThreshold | EmailChannelObject;

export interface NotificationChannelConfig {
  messaging?: NotificationThreshold;
  email?: EmailChannelConfig;
  api?: NotificationThreshold;
}

export type MonitoringFrequency = "daily" | "weekly" | "biweekly" | "monthly" | "off";

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface MonitoringCommandEntry {
  key: string;
  title?: string;
  command?: string;
  frequency?: MonitoringFrequency;
  // Used when frequency is "weekly" or "biweekly". Defaults to "saturday".
  frequencyDay?: Weekday;
  // Used when frequency is "monthly". Day of month (1-31). Defaults to 1.
  // When the configured day does not exist in the current month (e.g. 31 in February), the command runs on the last day of the month.
  frequencyDayOfMonth?: number;
  notifications?: NotificationChannelConfig;
}

export interface NotifButton {
  text: string;
  url?: string;
  style?: "primary" | "danger";
}

// Notification type union: every member must also have an entry in NOTIFICATION_TYPE_CATEGORY below.
export type NotifMessageType =
  | "ACTIVE_USERS"
  | "ACTIVE_USERS_CRM_WEEKLY"
  | "ACTIVE_USERS_EXPERIENCE_MONTHLY"
  | "UNUSED_USERS"
  | "UNUSED_USERS_CRM_6_MONTHS"
  | "UNUSED_USERS_EXPERIENCE_6_MONTHS"
  | "AUDIT_TRAIL"
  | "APEX_TESTS"
  | "BACKUP"
  | "DEPLOYMENT"
  | "LEGACY_API"
  | "LICENSES"
  | "LINT_ACCESS"
  | "UNUSED_METADATAS"
  | "METADATA_STATUS"
  | "MISSING_ATTRIBUTES"
  | "SERVICENOW_REPORT"
  | "UNUSED_LICENSES"
  | "UNDERUSED_PERMSETS"
  | "MINIMAL_PERMSETS"
  | "UNUSED_APEX_CLASSES"
  | "APEX_API_VERSION"
  | "APEX_FLEX_QUEUE"
  | "CONNECTED_APPS"
  | "UNSECURED_CONNECTED_APPS"
  | "ORG_HEALTH_CHECK"
  | "ORG_INFO"
  | "ORG_LIMITS"
  | "RELEASE_UPDATES"
  | "AGENTFORCE_CONVERSATIONS"
  | "AGENTFORCE_FEEDBACK"
  | "APEX_ERROR"
  | "FLOW_ERROR"
  | "DEPLOYMENTS"
  | "DORA_REPORT"
  | "MONITORING_SUMMARY"
  | "RELEASE_NOTES";

// Categories used to group notification types in configuration UIs.
// Order here drives the rendering order in the monitoring-defaults payload.
export type NotificationCategory =
  | "orgActivity"
  | "userActivity"
  | "apexTestsSecurity"
  | "orgInfo"
  | "technicalDebt"
  | "licensesPackages"
  | "other";

export const NOTIFICATION_CATEGORIES: { key: NotificationCategory; order: number }[] = [
  { key: "orgActivity", order: 1 },
  { key: "userActivity", order: 2 },
  { key: "apexTestsSecurity", order: 3 },
  { key: "orgInfo", order: 4 },
  { key: "technicalDebt", order: 5 },
  { key: "licensesPackages", order: 6 },
  { key: "other", order: 7 },
];

// Maps every notification type to its category. Typing as Record<NotifMessageType, NotificationCategory>
// makes this exhaustive: adding a new type to NotifMessageType without an entry here is a compile error.
export const NOTIFICATION_TYPE_CATEGORY: Record<NotifMessageType, NotificationCategory> = {
  // orgActivity
  AUDIT_TRAIL: "orgActivity",
  LEGACY_API: "orgActivity",
  APEX_FLEX_QUEUE: "orgActivity",
  APEX_ERROR: "orgActivity",
  FLOW_ERROR: "orgActivity",
  BACKUP: "orgActivity",
  DEPLOYMENT: "orgActivity",
  DEPLOYMENTS: "orgActivity",
  // userActivity
  ACTIVE_USERS: "userActivity",
  ACTIVE_USERS_CRM_WEEKLY: "userActivity",
  ACTIVE_USERS_EXPERIENCE_MONTHLY: "userActivity",
  UNUSED_USERS: "userActivity",
  UNUSED_USERS_CRM_6_MONTHS: "userActivity",
  UNUSED_USERS_EXPERIENCE_6_MONTHS: "userActivity",
  // apexTestsSecurity
  APEX_TESTS: "apexTestsSecurity",
  ORG_HEALTH_CHECK: "apexTestsSecurity",
  UNSECURED_CONNECTED_APPS: "apexTestsSecurity",
  // orgInfo
  ORG_INFO: "orgInfo",
  ORG_LIMITS: "orgInfo",
  RELEASE_UPDATES: "orgInfo",
  // technicalDebt
  APEX_API_VERSION: "technicalDebt",
  CONNECTED_APPS: "technicalDebt",
  LINT_ACCESS: "technicalDebt",
  METADATA_STATUS: "technicalDebt",
  MISSING_ATTRIBUTES: "technicalDebt",
  UNUSED_APEX_CLASSES: "technicalDebt",
  UNUSED_METADATAS: "technicalDebt",
  // licensesPackages
  LICENSES: "licensesPackages",
  UNUSED_LICENSES: "licensesPackages",
  UNDERUSED_PERMSETS: "licensesPackages",
  MINIMAL_PERMSETS: "licensesPackages",
  // other
  AGENTFORCE_CONVERSATIONS: "other",
  AGENTFORCE_FEEDBACK: "other",
  DORA_REPORT: "other",
  MONITORING_SUMMARY: "other",
  RELEASE_NOTES: "other",
  SERVICENOW_REPORT: "other",
};

export interface NotifMessage {
  text: string;
  // Adding a new notification type? The .claude/skills/monitoring-notifications/SKILL.md file
  // lists every place that needs to change. Quick summary:
  //   - src/common/notifProvider/types.ts -- add to NotifMessageType union AND NOTIFICATION_TYPE_CATEGORY mapping
  //   - src/common/notifProvider/notificationDefaults.ts -- routing defaults (messaging/email/api thresholds)
  //   - src/common/monitoring/monitoringDefaults.ts -- notificationOnlyTypes (if NOT a monitoring command key)
  //                                                    or monitoringCommandsDefault (if it IS a command)
  //   - src/i18n/*.json -- notifTypeTitle<PascalCaseKey> + notifTypeDesc<PascalCaseKey> in ALL 9 locales
  //   - config/sfdx-hardis.jsonschema.json -- enum_notification_types (always) and enum_monitoring_commands (if a command)
  // Existing installations pick up new types automatically except for fields a user has explicitly
  // overridden in their .sfdx-hardis.yml monitoringCommands array.
  type: NotifMessageType;
  buttons?: NotifButton[];
  attachments?: any[];
  severity: NotifSeverity;
  sideImage?: string;
  attachedFiles?: string[];
  logElements: any[];
  metrics: any;
  data: any;
  alwaysSend?: boolean;
}
