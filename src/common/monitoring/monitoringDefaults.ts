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
    command: "sf hardis:org:diagnose:audittrail",
    frequency: "daily",
  },
  {
    key: "LEGACY_API",
    command: "sf hardis:org:diagnose:legacyapi",
    frequency: "daily",
  },
  {
    key: "ORG_LIMITS",
    command: "sf hardis:org:monitor:limits",
    frequency: "daily",
  },
  {
    key: "APEX_FLEX_QUEUE",
    command: "sf hardis:org:diagnose:flex-queue",
    frequency: "daily",
  },
  {
    key: "APEX_FLOW_ERRORS",
    command: "sf hardis:org:monitor:errors",
    frequency: "daily",
  },
  {
    key: "UNSECURED_CONNECTED_APPS",
    command: "sf hardis:org:diagnose:unsecure-connected-apps",
    frequency: "daily",
  },
  {
    key: "DEPLOYMENTS",
    command: "sf hardis:org:diagnose:deployments --period weekly",
    frequency: "daily",
  },
  {
    key: "LICENSES",
    command: "sf hardis:org:diagnose:licenses",
    frequency: "weekly",
  },
  {
    key: "LINT_ACCESS",
    command: "sf hardis:lint:access",
    frequency: "weekly",
  },
  {
    key: "UNUSED_LICENSES",
    command: "sf hardis:org:diagnose:unusedlicenses",
    frequency: "weekly",
  },
  {
    key: "UNUSED_USERS",
    command: "sf hardis:org:diagnose:unusedusers --licensetypes all --days 180",
    frequency: "weekly",
  },
  {
    key: "UNUSED_USERS_CRM_6_MONTHS",
    command: "sf hardis:org:diagnose:unusedusers --licensetypes all-crm --days 180",
    frequency: "weekly",
  },
  {
    key: "UNUSED_USERS_EXPERIENCE_6_MONTHS",
    command: "sf hardis:org:diagnose:unusedusers --licensetypes experience --days 180",
    frequency: "weekly",
  },
  {
    key: "ACTIVE_USERS_CRM_WEEKLY",
    command: "sf hardis:org:diagnose:unusedusers --returnactiveusers --licensetypes all-crm --days 7",
    frequency: "weekly",
  },
  {
    key: "ACTIVE_USERS_EXPERIENCE_MONTHLY",
    command: "sf hardis:org:diagnose:unusedusers --returnactiveusers --licensetypes experience --days 30",
    frequency: "weekly",
  },
  {
    key: "ORG_INFO",
    command: "sf hardis:org:diagnose:instanceupgrade",
    frequency: "weekly",
  },
  {
    key: "RELEASE_UPDATES",
    command: "sf hardis:org:diagnose:releaseupdates",
    frequency: "weekly",
  },
  {
    key: "ORG_HEALTH_CHECK",
    command: "sf hardis:org:monitor:health-check",
    frequency: "weekly",
  },
  {
    key: "UNUSED_METADATAS",
    command: "sf hardis:lint:unusedmetadatas",
    frequency: "weekly",
  },
  {
    key: "UNUSED_APEX_CLASSES",
    command: "sf hardis:org:diagnose:unused-apex-classes",
    frequency: "weekly",
  },
  {
    key: "APEX_API_VERSION",
    command: "sf hardis:org:diagnose:apex-api-version",
    frequency: "weekly",
  },
  {
    key: "CONNECTED_APPS",
    command: "sf hardis:org:diagnose:unused-connected-apps",
    frequency: "weekly",
  },
  {
    key: "METADATA_STATUS",
    command: "sf hardis:lint:metadatastatus",
    frequency: "weekly",
  },
  {
    key: "MISSING_ATTRIBUTES",
    command: "sf hardis:lint:missingattributes",
    frequency: "weekly",
  },
  {
    key: "UNDERUSED_PERMSETS",
    command: "sf hardis:org:diagnose:underusedpermsets",
    frequency: "weekly",
  },
  {
    key: "MINIMAL_PERMSETS",
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
  "critical",
  "error",
  "warning",
  "info",
  "success",
  "log",
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
