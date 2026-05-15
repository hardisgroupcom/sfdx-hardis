import type {
  MonitoringCommandEntry,
  MonitoringFrequency,
  NotificationCategory,
  NotificationChannel,
  NotificationThreshold,
  NotifMessage,
  NotifMessageType,
  NotifSeverity,
  Weekday,
} from "../notifProvider/types.js";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPE_CATEGORY,
} from "../notifProvider/types.js";
import { notificationDefaults } from "../notifProvider/notificationDefaults.js";
import { isEmailChannelObject } from "../notifProvider/notificationConfig.js";
import { t } from "../utils/i18n.js";

// Default monitoring commands run by hardis:org:monitor:all.
// User entries in .sfdx-hardis.yml monitoringCommands[] are merged by key onto this list at runtime.
// Each key here must also have an entry in notificationDefaults (for routing) and in notifTypeMetadata below
// (for title/description shown in configuration UIs).
export const monitoringCommandsDefault: MonitoringCommandEntry[] = [
  {
    key: "AUDIT_TRAIL",
    title: "Detect suspect setup actions in major org",
    command: "sf hardis:org:diagnose:audittrail",
    frequency: "daily",
  },
  {
    key: "LEGACY_API",
    title: "Detect calls to deprecated API versions",
    command: "sf hardis:org:diagnose:legacyapi",
    frequency: "daily",
  },
  {
    key: "ORG_LIMITS",
    title: "Detect if org limits are close to be reached",
    command: "sf hardis:org:monitor:limits",
    frequency: "daily",
  },
  {
    key: "APEX_FLEX_QUEUE",
    title: "Detect Apex flex queue backlog (AsyncApexJob Holding)",
    command: "sf hardis:org:diagnose:flex-queue",
    frequency: "daily",
  },
  {
    key: "APEX_FLOW_ERRORS",
    title: "Detect Apex and Flow errors",
    command: "sf hardis:org:monitor:errors",
    frequency: "daily",
  },
  {
    key: "UNSECURED_CONNECTED_APPS",
    title: "Detect unsecured Connected Apps in an org",
    command: "sf hardis:org:diagnose:unsecure-connected-apps",
    frequency: "daily",
  },
  {
    key: "DEPLOYMENTS",
    title: "Analyze metadata deployments and validations",
    command: "sf hardis:org:diagnose:deployments --period weekly",
    frequency: "daily",
  },
  {
    key: "LICENSES",
    title: "Extract licenses information",
    command: "sf hardis:org:diagnose:licenses",
    frequency: "weekly",
  },
  {
    key: "LINT_ACCESS",
    title: "Detect custom elements with no access rights defined in permission sets",
    command: "sf hardis:lint:access",
    frequency: "weekly",
  },
  {
    key: "UNUSED_LICENSES",
    title: "Detect permission set licenses that are assigned to users that do not need them",
    command: "sf hardis:org:diagnose:unusedlicenses",
    frequency: "weekly",
  },
  {
    key: "UNUSED_USERS",
    title: "Detect active users without recent logins (All licenses, 6 months)",
    command: "sf hardis:org:diagnose:unusedusers --licensetypes all --days 180",
    frequency: "weekly",
  },
  {
    key: "UNUSED_USERS_CRM_6_MONTHS",
    title: "Detect active users without recent logins (CRM, 6 months)",
    command: "sf hardis:org:diagnose:unusedusers --licensetypes all-crm --days 180",
    frequency: "weekly",
  },
  {
    key: "UNUSED_USERS_EXPERIENCE_6_MONTHS",
    title: "Detect active users without recent logins (Experience, 6 months)",
    command: "sf hardis:org:diagnose:unusedusers --licensetypes experience --days 180",
    frequency: "weekly",
  },
  {
    key: "ACTIVE_USERS_CRM_WEEKLY",
    title: "Detect active users with recent logins (CRM, 1 week)",
    command: "sf hardis:org:diagnose:unusedusers --returnactiveusers --licensetypes all-crm --days 7",
    frequency: "weekly",
  },
  {
    key: "ACTIVE_USERS_EXPERIENCE_MONTHLY",
    title: "Detect active users with recent logins (Experience, 1 month)",
    command: "sf hardis:org:diagnose:unusedusers --returnactiveusers --licensetypes experience --days 30",
    frequency: "weekly",
  },
  {
    key: "ORG_INFO",
    title: "Get org info + SF instance info + next major upgrade date",
    command: "sf hardis:org:diagnose:instanceupgrade",
    frequency: "weekly",
  },
  {
    key: "RELEASE_UPDATES",
    title: "Gather warnings about incoming and overdue Release Updates",
    command: "sf hardis:org:diagnose:releaseupdates",
    frequency: "weekly",
  },
  {
    key: "ORG_HEALTH_CHECK",
    title: "Run Salesforce Security Health Check",
    command: "sf hardis:org:monitor:health-check",
    frequency: "weekly",
  },
  {
    key: "UNUSED_METADATAS",
    title: "Detect custom labels and custom permissions that are not in use",
    command: "sf hardis:lint:unusedmetadatas",
    frequency: "weekly",
  },
  {
    key: "UNUSED_APEX_CLASSES",
    title: "Detect unused Apex classes in an org",
    command: "sf hardis:org:diagnose:unused-apex-classes",
    frequency: "weekly",
  },
  {
    key: "APEX_API_VERSION",
    title: "Detect Apex classes and triggers with deprecated API version",
    command: "sf hardis:org:diagnose:apex-api-version",
    frequency: "weekly",
  },
  {
    key: "CONNECTED_APPS",
    title: "Detect unused Connected Apps in an org",
    command: "sf hardis:org:diagnose:unused-connected-apps",
    frequency: "weekly",
  },
  {
    key: "METADATA_STATUS",
    title: "Detect inactive metadata",
    command: "sf hardis:lint:metadatastatus",
    frequency: "weekly",
  },
  {
    key: "MISSING_ATTRIBUTES",
    title: "Detect missing description on custom field",
    command: "sf hardis:lint:missingattributes",
    frequency: "weekly",
  },
  {
    key: "UNDERUSED_PERMSETS",
    title: "Detect underused permission sets",
    command: "sf hardis:org:diagnose:underusedpermsets",
    frequency: "weekly",
  },
  {
    key: "MINIMAL_PERMSETS",
    title: "Detect permission sets with minimal permissions in project",
    command: "sf hardis:org:diagnose:minimalpermsets",
    frequency: "weekly",
  },
];

// Notification types emitted outside of monitor:all (or in addition to it).
// Listing them here lets the configuration UI render every notification type, not just the monitoring ones.
// Whenever a new value is added to NotifMessage.type, also add it here (if not already a monitoring command key)
// and add matching i18n entries below.
const notificationOnlyTypes: NotifMessage["type"][] = [
  "ACTIVE_USERS",
  "AGENTFORCE_CONVERSATIONS",
  "AGENTFORCE_FEEDBACK",
  "APEX_ERROR",
  "APEX_TESTS",
  "BACKUP",
  "DEPLOYMENT",
  "DORA_REPORT",
  "FLOW_ERROR",
  "MONITORING_SUMMARY",
  "RELEASE_NOTES",
  "SERVICENOW_REPORT",
];

// Converts a key like "AUDIT_TRAIL" or "UNUSED_USERS_CRM_6_MONTHS" to a PascalCase slug suitable for i18n keys.
function toPascalSlug(key: string): string {
  return key
    .split(/[_\s]+/)
    .map((part) => (part.length ? part[0].toUpperCase() + part.slice(1).toLowerCase() : ""))
    .join("");
}

export function getTitleI18nKey(key: string): string {
  return `notifTypeTitle${toPascalSlug(key)}`;
}

export function getDescriptionI18nKey(key: string): string {
  return `notifTypeDesc${toPascalSlug(key)}`;
}

// Converts a category key like "orgActivity" to the PascalCase slug used in i18n keys.
function toCategoryPascalSlug(key: string): string {
  return key.length ? key[0].toUpperCase() + key.slice(1) : "";
}

export function getCategoryTitleI18nKey(key: string): string {
  return `notifCategoryTitle${toCategoryPascalSlug(key)}`;
}

export function getCategoryDescriptionI18nKey(key: string): string {
  return `notifCategoryDesc${toCategoryPascalSlug(key)}`;
}

// Resolves the category for a monitoring command or notification type.
// The single source of truth is NOTIFICATION_TYPE_CATEGORY in notifProvider/types.ts; this wrapper
// adds a runtime guard for monitoring command keys that are NOT in the NotifMessage type union
// (currently APEX_FLOW_ERRORS, which aggregates APEX_ERROR + FLOW_ERROR notifications).
const monitoringOnlyCategoryOverrides: Record<string, NotificationCategory> = {
  APEX_FLOW_ERRORS: "orgActivity",
};

function resolveCategory(key: string): NotificationCategory {
  const override = monitoringOnlyCategoryOverrides[key];
  if (override) {
    return override;
  }
  const category = NOTIFICATION_TYPE_CATEGORY[key as NotifMessageType];
  if (!category) {
    throw new Error(
      `Missing category mapping for monitoring/notification key "${key}". Add it to NOTIFICATION_TYPE_CATEGORY in src/common/notifProvider/types.ts, or to monitoringOnlyCategoryOverrides in src/common/monitoring/monitoringDefaults.ts if the key is not a NotifMessage type.`,
    );
  }
  return category;
}

const FREQUENCIES: MonitoringFrequency[] = ["daily", "weekly", "biweekly", "monthly", "off"];
const FREQUENCY_DAYS: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const SEVERITY_THRESHOLDS: NotificationThreshold[] = [
  "log",
  "success",
  "info",
  "warning",
  "error",
  "critical",
  "off",
];
const CHANNELS: NotificationChannel[] = ["messaging", "email", "api"];

function defaultThreshold(channel: NotificationChannel): NotificationThreshold {
  return channel === "api" ? "log" : "info";
}

function resolveDefaultThresholds(key: string): Record<NotificationChannel, NotificationThreshold> {
  const defaults = notificationDefaults[key as NotifMessage["type"]] ?? {};
  const emailThreshold: NotificationThreshold = isEmailChannelObject(defaults.email)
    ? (defaults.email.threshold ?? defaultThreshold("email"))
    : ((defaults.email as NotifSeverity | "off" | undefined) ?? defaultThreshold("email"));
  return {
    messaging: defaults.messaging ?? defaultThreshold("messaging"),
    email: emailThreshold,
    api: defaults.api ?? defaultThreshold("api"),
  };
}

export interface MonitoringConfigEntry {
  key: string;
  kind: "monitoringCommand" | "notificationType";
  title: string;
  description: string;
  category: NotificationCategory;
  command?: string;
  frequency?: MonitoringFrequency;
  frequencyDay?: Weekday;
  frequencyDayOfMonth?: number;
  notifications: Record<NotificationChannel, NotificationThreshold>;
}

export interface MonitoringConfigCategory {
  key: NotificationCategory;
  title: string;
  description: string;
  order: number;
}

export interface MonitoringConfigDefaultsPayload {
  entries: MonitoringConfigEntry[];
  categories: MonitoringConfigCategory[];
  options: {
    frequencies: MonitoringFrequency[];
    frequencyDays: Weekday[];
    thresholds: NotificationThreshold[];
    channels: NotificationChannel[];
  };
}

export function getMonitoringConfigDefaults(): MonitoringConfigDefaultsPayload {
  const entries: MonitoringConfigEntry[] = [];

  for (const cmd of monitoringCommandsDefault) {
    entries.push({
      key: cmd.key,
      kind: "monitoringCommand",
      title: t(getTitleI18nKey(cmd.key)),
      description: t(getDescriptionI18nKey(cmd.key)),
      category: resolveCategory(cmd.key),
      command: cmd.command,
      frequency: cmd.frequency,
      frequencyDay: cmd.frequencyDay,
      frequencyDayOfMonth: cmd.frequencyDayOfMonth,
      notifications: resolveDefaultThresholds(cmd.key),
    });
  }

  const monitoringKeys = new Set(monitoringCommandsDefault.map((c) => c.key));
  for (const key of notificationOnlyTypes) {
    if (monitoringKeys.has(key)) {
      continue;
    }
    entries.push({
      key,
      kind: "notificationType",
      title: t(getTitleI18nKey(key)),
      description: t(getDescriptionI18nKey(key)),
      category: resolveCategory(key),
      notifications: resolveDefaultThresholds(key),
    });
  }

  const categories: MonitoringConfigCategory[] = NOTIFICATION_CATEGORIES.map((cat) => ({
    key: cat.key,
    title: t(getCategoryTitleI18nKey(cat.key)),
    description: t(getCategoryDescriptionI18nKey(cat.key)),
    order: cat.order,
  }));

  return {
    entries,
    categories,
    options: {
      frequencies: FREQUENCIES,
      frequencyDays: FREQUENCY_DAYS,
      thresholds: SEVERITY_THRESHOLDS,
      channels: CHANNELS,
    },
  };
}
