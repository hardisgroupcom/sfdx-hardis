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
  // Notification type keys this command can emit. A single command may emit multiple types
  // (e.g. APEX_FLOW_ERRORS aggregates APEX_ERROR + FLOW_ERROR). Per-channel routing
  // thresholds live on NotificationConfigEntry (notificationConfig), not here.
  notificationTypes?: string[];
  // Optional category override for the monitoring-defaults catalog. Useful for aggregate
  // commands like APEX_FLOW_ERRORS that emit multiple notification types and would otherwise
  // inherit only the first emitted type's category. When omitted, the resolver falls back to
  // the category of the first key in `notificationTypes`.
  category?: NotificationCategory;
  // Optional SLDS icon (`<category>:<name>`, e.g. "utility:warning") for the monitoring-defaults
  // catalog. Same fallback semantics as `category` above: when omitted the resolver inherits
  // the first notification type's icon.
  icon?: string;
  // Optional CSS class hint used by configuration UIs (notably the VS Code sfdx-hardis
  // extension) to color the command badge. Same fallback semantics as `category` / `icon`:
  // when omitted the resolver inherits the first notification type's colorClass, then the
  // category's colorClass as a last resort.
  colorClass?: string;
}

// Per-notification-type routing configuration. User overrides live under the top-level
// `notificationConfig:` key in .sfdx-hardis.yml and are merged by `key` onto the `defaults`
// blocks declared in `notificationTypesDefault` (see below).
export interface NotificationConfigEntry {
  key: string;
  notifications?: NotificationChannelConfig;
}

export interface NotifButton {
  text: string;
  url?: string;
  style?: "primary" | "danger";
}

// Notification type union: every member must also have an entry in notificationTypesDefault below
// (compile-time enforced via Record<NotifMessageType, NotificationTypeDefault>).
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

// Per-category metadata: order, default SLDS icon, and CSS class hint for configuration UIs.
// Single source of truth for category-level theming; downstream UIs (e.g. the VS Code sfdx-hardis
// extension) read these values directly from the monitoring-defaults catalog.
export interface NotificationCategoryDefault {
  key: NotificationCategory;
  order: number;
  // Default SLDS icon for the category section header (`<category>:<name>`,
  // e.g. "utility:refresh"). UIs that render emojis instead of SLDS icons may keep a local
  // emoji mapping; the CLI standardizes on SLDS to stay consistent with per-type / per-command icons.
  icon: string;
  // CSS class hint used by configuration UIs to color the category section / icon container.
  // Per-notification-type and per-command entries also carry their own `colorClass` for finer
  // theming; this value is the category-level fallback.
  colorClass: string;
}

export const NOTIFICATION_CATEGORIES: NotificationCategoryDefault[] = [
  { key: "orgActivity", order: 1, icon: "utility:refresh", colorClass: "tests" },
  { key: "apexTestsSecurity", order: 2, icon: "utility:shield", colorClass: "security" },
  { key: "userActivity", order: 3, icon: "utility:user", colorClass: "users" },
  { key: "technicalDebt", order: 4, icon: "utility:warning", colorClass: "limits" },
  { key: "orgInfo", order: 5, icon: "utility:info", colorClass: "health" },
  { key: "licensesPackages", order: 6, icon: "utility:package", colorClass: "licenses" },
  { key: "other", order: 7, icon: "utility:apps", colorClass: "legacy" },
];

// Per-notification-type metadata: category, icon, emitted severities, channel routing defaults.
//
// SINGLE SOURCE OF TRUTH for every static fact about a notification type. Whenever you add or
// change a type, edit one entry here -- the monitoring-defaults catalog, threshold clamping,
// availableThresholds derivation, and per-channel default routing all read directly from this
// object.
//
// Fields:
//
// - `category`: NotificationCategory the type belongs to. Drives grouping in configuration UIs.
//
// - `icon`: SLDS icon name in `<category>:<name>` form (see https://www.salesforceicons.com/),
//   e.g. `utility:dashboard`, `standard:report`, `action:approval`. Surfaced on the catalog so
//   configuration UIs can render a glyph next to each row.
//
// - `emittedSeverities`: severities this type can actually be emitted with. Derived from the
//   source code of the commands that emit each type. Drives the `availableThresholds` list (so a
//   threshold selector only offers values that can actually fire, plus "off"). When a type is not
//   emitted anywhere yet (placeholder/reserved), list all severities so UIs do not lock users in.
//   Severity order (low to high): log < success < info < warning < error < critical.
//
// - `defaults`: per-channel routing thresholds applied when the user has not overridden them.
//   Each value MUST belong to the type's available thresholds (= emittedSeverities ∪ {"log"} ∪
//   {"off"}); otherwise the catalog clamps it to the nearest meaningful value at runtime.
//   Convention: `api: "log"` for every type (audit everything to the API).
//
// Typing as `Record<NotifMessageType, NotificationTypeDefault>` makes this exhaustive: adding a
// new type to NotifMessageType without an entry here is a compile error.
export interface NotificationTypeDefault {
  category: NotificationCategory;
  icon: string;
  // CSS class hint used by configuration UIs (notably the VS Code sfdx-hardis extension) to
  // color the notification / command badge. Categories also expose a colorClass; per-type
  // values override the category one for finer-grained theming (e.g. AUDIT_TRAIL is
  // "audit" while its category "orgActivity" is "tests").
  colorClass: string;
  emittedSeverities: NotifSeverity[];
  defaults: NotificationChannelConfig;
}

export const notificationTypesDefault: Record<NotifMessageType, NotificationTypeDefault> = {
  // orgActivity
  AUDIT_TRAIL: {
    category: "orgActivity",
    icon: "utility:shield",
    colorClass: "audit",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "off", api: "log" },
  },
  LEGACY_API: {
    category: "orgActivity",
    icon: "utility:variation",
    colorClass: "legacy",
    emittedSeverities: ["error", "log"],
    defaults: { messaging: "error", email: "error", api: "log" },
  },
  APEX_FLEX_QUEUE: {
    category: "orgActivity",
    icon: "utility:queue",
    colorClass: "tests",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "off", api: "log" },
  },
  APEX_ERROR: {
    category: "orgActivity",
    icon: "utility:bug",
    colorClass: "alerts",
    emittedSeverities: ["error", "success"],
    defaults: { messaging: "error", email: "error", api: "log" },
  },
  FLOW_ERROR: {
    category: "orgActivity",
    icon: "utility:flow",
    colorClass: "alerts",
    emittedSeverities: ["error", "success"],
    defaults: { messaging: "error", email: "error", api: "log" },
  },
  BACKUP: {
    category: "orgActivity",
    icon: "utility:archive",
    colorClass: "backup",
    emittedSeverities: ["info", "log"],
    defaults: { messaging: "info", email: "off", api: "log" },
  },
  // Reserved/placeholder - not currently emitted; expose every severity so UIs do not lock users in.
  DEPLOYMENT: {
    category: "orgActivity",
    icon: "utility:upload",
    colorClass: "audit",
    emittedSeverities: ["critical", "error", "warning", "info", "success", "log"],
    defaults: { messaging: "info", email: "warning", api: "log" },
  },
  DEPLOYMENTS: {
    category: "orgActivity",
    icon: "utility:upload",
    colorClass: "audit",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "warning", api: "log" },
  },

  // userActivity
  ACTIVE_USERS: {
    category: "userActivity",
    icon: "utility:user",
    colorClass: "users",
    emittedSeverities: ["log"],
    defaults: { messaging: "off", email: "off", api: "log" },
  },
  ACTIVE_USERS_CRM_WEEKLY: {
    category: "userActivity",
    icon: "utility:user",
    colorClass: "tests",
    emittedSeverities: ["log"],
    defaults: { messaging: "off", email: "off", api: "log" },
  },
  ACTIVE_USERS_EXPERIENCE_MONTHLY: {
    category: "userActivity",
    icon: "utility:user",
    colorClass: "tests",
    emittedSeverities: ["log"],
    defaults: { messaging: "off", email: "off", api: "log" },
  },
  UNUSED_USERS: {
    category: "userActivity",
    icon: "utility:logout",
    colorClass: "users",
    emittedSeverities: ["log"],
    defaults: { messaging: "off", email: "off", api: "log" },
  },
  UNUSED_USERS_CRM_6_MONTHS: {
    category: "userActivity",
    icon: "utility:logout",
    colorClass: "users",
    emittedSeverities: ["log"],
    defaults: { messaging: "off", email: "off", api: "log" },
  },
  UNUSED_USERS_EXPERIENCE_6_MONTHS: {
    category: "userActivity",
    icon: "utility:logout",
    colorClass: "users",
    emittedSeverities: ["log"],
    defaults: { messaging: "off", email: "off", api: "log" },
  },

  // apexTestsSecurity
  APEX_TESTS: {
    category: "apexTestsSecurity",
    icon: "utility:check",
    colorClass: "tests",
    emittedSeverities: ["error", "log"],
    defaults: { messaging: "error", email: "error", api: "log" },
  },
  ORG_HEALTH_CHECK: {
    category: "apexTestsSecurity",
    icon: "utility:health_check",
    colorClass: "health",
    emittedSeverities: ["error", "warning", "success"],
    defaults: { messaging: "warning", email: "error", api: "log" },
  },
  UNSECURED_CONNECTED_APPS: {
    category: "apexTestsSecurity",
    icon: "utility:lock",
    colorClass: "security",
    emittedSeverities: ["error", "log"],
    defaults: { messaging: "error", email: "error", api: "log" },
  },

  // orgInfo
  ORG_LIMITS: {
    category: "orgInfo",
    icon: "utility:gauge",
    colorClass: "limits",
    emittedSeverities: ["error", "warning", "log"],
    defaults: { messaging: "warning", email: "error", api: "log" },
  },
  RELEASE_UPDATES: {
    category: "orgInfo",
    icon: "utility:date_time",
    colorClass: "updates",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "warning", api: "log" },
  },
  ORG_INFO: {
    category: "orgInfo",
    icon: "utility:info",
    colorClass: "health",
    emittedSeverities: ["log"],
    defaults: { messaging: "off", email: "off", api: "log" },
  },

  // technicalDebt
  APEX_API_VERSION: {
    category: "technicalDebt",
    icon: "utility:apex",
    colorClass: "legacy",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "off", api: "log" },
  },
  CONNECTED_APPS: {
    category: "technicalDebt",
    icon: "utility:apps",
    colorClass: "connected-apps",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "warning", api: "log" },
  },
  LINT_ACCESS: {
    category: "technicalDebt",
    icon: "utility:key",
    colorClass: "metadata-access",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "off", api: "log" },
  },
  METADATA_STATUS: {
    category: "technicalDebt",
    icon: "utility:settings",
    colorClass: "legacy",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "warning", api: "log" },
  },
  MISSING_ATTRIBUTES: {
    category: "technicalDebt",
    icon: "utility:question",
    colorClass: "metadata-access",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "warning", api: "log" },
  },
  UNUSED_APEX_CLASSES: {
    category: "technicalDebt",
    icon: "utility:apex",
    colorClass: "apex",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "warning", api: "log" },
  },
  UNUSED_METADATAS: {
    category: "technicalDebt",
    icon: "utility:settings",
    colorClass: "unused-metadata",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "warning", api: "log" },
  },

  // licensesPackages
  LICENSES: {
    category: "licensesPackages",
    icon: "utility:identity",
    colorClass: "licenses",
    emittedSeverities: ["log"],
    defaults: { messaging: "off", email: "off", api: "log" },
  },
  UNUSED_LICENSES: {
    category: "licensesPackages",
    icon: "utility:identity",
    colorClass: "licenses",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "warning", api: "log" },
  },
  UNDERUSED_PERMSETS: {
    category: "licensesPackages",
    icon: "utility:key",
    colorClass: "licenses",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "warning", api: "log" },
  },
  MINIMAL_PERMSETS: {
    category: "licensesPackages",
    icon: "utility:key",
    colorClass: "metadata-access",
    emittedSeverities: ["error", "warning", "log"],
    defaults: { messaging: "warning", email: "warning", api: "log" },
  },

  // other
  AGENTFORCE_CONVERSATIONS: {
    category: "other",
    icon: "utility:einstein",
    colorClass: "tests",
    emittedSeverities: ["log"],
    defaults: { messaging: "off", email: "off", api: "log" },
  },
  AGENTFORCE_FEEDBACK: {
    category: "other",
    icon: "utility:feedback",
    colorClass: "tests",
    emittedSeverities: ["warning", "log"],
    defaults: { messaging: "warning", email: "warning", api: "log" },
  },
  DORA_REPORT: {
    category: "other",
    icon: "utility:trending",
    colorClass: "health",
    emittedSeverities: ["warning", "info", "success"],
    defaults: { messaging: "info", email: "info", api: "log" },
  },
  MONITORING_SUMMARY: {
    category: "other",
    icon: "utility:dashboard",
    colorClass: "backup",
    emittedSeverities: ["info"],
    defaults: { messaging: "info", email: "info", api: "log" },
  },
  // Reserved/placeholder - not currently emitted; expose every severity.
  RELEASE_NOTES: {
    category: "other",
    icon: "utility:note",
    colorClass: "updates",
    emittedSeverities: ["critical", "error", "warning", "info", "success", "log"],
    defaults: { messaging: "info", email: "info", api: "log" },
  },
  SERVICENOW_REPORT: {
    category: "other",
    icon: "utility:case",
    colorClass: "backup",
    emittedSeverities: ["log"],
    defaults: { messaging: "off", email: "off", api: "log" },
  },
};


export interface NotifMessage {
  text: string;
  // Adding a new notification type? The .claude/skills/monitoring-notifications/SKILL.md file
  // lists every place that needs to change. Quick summary:
  //   - src/common/notifProvider/types.ts -- add to NotifMessageType union AND add a matching
  //                                          entry to notificationTypesDefault (category, icon,
  //                                          emittedSeverities, channel defaults all in one place)
  //   - src/common/monitoring/monitoringDefaults.ts -- monitoringCommandsDefault (only if the
  //                                                    type is bound to a scheduled command)
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
