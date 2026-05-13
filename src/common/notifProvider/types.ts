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

export interface NotifMessage {
  text: string;
  // Whenever a new type is added here, also add it to:
  //   - src/common/notifProvider/notificationDefaults.ts (routing defaults: messaging/email/api thresholds)
  //   - config/sfdx-hardis.jsonschema.json definitions.enum_notification_types
  // If the new type is emitted by a new monitoring sub-command, also add an entry to:
  //   - MonitorAll.monitoringCommandsDefault in src/commands/hardis/org/monitor/all.ts
  //   - config/sfdx-hardis.jsonschema.json definitions.enum_monitoring_commands
  // Existing installations pick up new types automatically as long as users have not explicitly
  // overridden the same key in their .sfdx-hardis.yml monitoringCommands array.
  type:
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
