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
import {
  clampThresholdToAvailable,
  getAvailableThresholds,
  isEmailChannelObject,
} from "../notifProvider/notificationConfig.js";
import { t } from "../utils/i18n.js";

// Default monitoring commands run by hardis:org:monitor:all.
// User entries in .sfdx-hardis.yml monitoringCommands[] are merged by key onto this list at runtime.
// Each key here must also have an entry in notifTypeMetadata below (for title/description shown in
// configuration UIs). Each command declares which notification type keys it can emit via
// notificationTypes; routing thresholds for those types are owned by notificationDefaults and can
// be overridden by users under the top-level notificationConfig[] key.
export const monitoringCommandsDefault: MonitoringCommandEntry[] = [
  {
    key: "AUDIT_TRAIL",
    command: "sf hardis:org:diagnose:audittrail",
    frequency: "daily",
    notificationTypes: ["AUDIT_TRAIL"],
  },
  {
    key: "LEGACY_API",
    command: "sf hardis:org:diagnose:legacyapi",
    frequency: "daily",
    notificationTypes: ["LEGACY_API"],
  },
  {
    key: "ORG_LIMITS",
    command: "sf hardis:org:monitor:limits",
    frequency: "daily",
    notificationTypes: ["ORG_LIMITS"],
  },
  {
    key: "APEX_FLEX_QUEUE",
    command: "sf hardis:org:diagnose:flex-queue",
    frequency: "daily",
    notificationTypes: ["APEX_FLEX_QUEUE"],
  },
  {
    key: "APEX_FLOW_ERRORS",
    command: "sf hardis:org:monitor:errors",
    frequency: "daily",
    notificationTypes: ["APEX_ERROR", "FLOW_ERROR"],
  },
  {
    key: "UNSECURED_CONNECTED_APPS",
    command: "sf hardis:org:diagnose:unsecure-connected-apps",
    frequency: "daily",
    notificationTypes: ["UNSECURED_CONNECTED_APPS"],
  },
  {
    key: "DEPLOYMENTS",
    command: "sf hardis:org:diagnose:deployments --period weekly",
    frequency: "daily",
    notificationTypes: ["DEPLOYMENTS"],
  },
  {
    key: "LICENSES",
    command: "sf hardis:org:diagnose:licenses",
    frequency: "weekly",
    notificationTypes: ["LICENSES"],
  },
  {
    key: "LINT_ACCESS",
    command: "sf hardis:lint:access",
    frequency: "weekly",
    notificationTypes: ["LINT_ACCESS"],
  },
  {
    key: "UNUSED_LICENSES",
    command: "sf hardis:org:diagnose:unusedlicenses",
    frequency: "weekly",
    notificationTypes: ["UNUSED_LICENSES"],
  },
  {
    key: "UNUSED_USERS",
    command: "sf hardis:org:diagnose:unusedusers --licensetypes all --days 180",
    frequency: "weekly",
    notificationTypes: ["UNUSED_USERS"],
  },
  {
    key: "UNUSED_USERS_CRM_6_MONTHS",
    command: "sf hardis:org:diagnose:unusedusers --licensetypes all-crm --days 180",
    frequency: "weekly",
    notificationTypes: ["UNUSED_USERS_CRM_6_MONTHS"],
  },
  {
    key: "UNUSED_USERS_EXPERIENCE_6_MONTHS",
    command: "sf hardis:org:diagnose:unusedusers --licensetypes experience --days 180",
    frequency: "weekly",
    notificationTypes: ["UNUSED_USERS_EXPERIENCE_6_MONTHS"],
  },
  {
    key: "ACTIVE_USERS_CRM_WEEKLY",
    command: "sf hardis:org:diagnose:unusedusers --returnactiveusers --licensetypes all-crm --days 7",
    frequency: "weekly",
    notificationTypes: ["ACTIVE_USERS_CRM_WEEKLY"],
  },
  {
    key: "ACTIVE_USERS_EXPERIENCE_MONTHLY",
    command: "sf hardis:org:diagnose:unusedusers --returnactiveusers --licensetypes experience --days 30",
    frequency: "weekly",
    notificationTypes: ["ACTIVE_USERS_EXPERIENCE_MONTHLY"],
  },
  {
    key: "ORG_INFO",
    command: "sf hardis:org:diagnose:instanceupgrade",
    frequency: "weekly",
    notificationTypes: ["ORG_INFO"],
  },
  {
    key: "RELEASE_UPDATES",
    command: "sf hardis:org:diagnose:releaseupdates",
    frequency: "weekly",
    notificationTypes: ["RELEASE_UPDATES"],
  },
  {
    key: "ORG_HEALTH_CHECK",
    command: "sf hardis:org:monitor:health-check",
    frequency: "weekly",
    notificationTypes: ["ORG_HEALTH_CHECK"],
  },
  {
    key: "UNUSED_METADATAS",
    command: "sf hardis:lint:unusedmetadatas",
    frequency: "weekly",
    notificationTypes: ["UNUSED_METADATAS"],
  },
  {
    key: "UNUSED_APEX_CLASSES",
    command: "sf hardis:org:diagnose:unused-apex-classes",
    frequency: "weekly",
    notificationTypes: ["UNUSED_APEX_CLASSES"],
  },
  {
    key: "APEX_API_VERSION",
    command: "sf hardis:org:diagnose:apex-api-version",
    frequency: "weekly",
    notificationTypes: ["APEX_API_VERSION"],
  },
  {
    key: "CONNECTED_APPS",
    command: "sf hardis:org:diagnose:unused-connected-apps",
    frequency: "weekly",
    notificationTypes: ["CONNECTED_APPS"],
  },
  {
    key: "METADATA_STATUS",
    command: "sf hardis:lint:metadatastatus",
    frequency: "weekly",
    notificationTypes: ["METADATA_STATUS"],
  },
  {
    key: "MISSING_ATTRIBUTES",
    command: "sf hardis:lint:missingattributes",
    frequency: "weekly",
    notificationTypes: ["MISSING_ATTRIBUTES"],
  },
  {
    key: "UNDERUSED_PERMSETS",
    command: "sf hardis:org:diagnose:underusedpermsets",
    frequency: "weekly",
    notificationTypes: ["UNDERUSED_PERMSETS"],
  },
  {
    key: "MINIMAL_PERMSETS",
    command: "sf hardis:org:diagnose:minimalpermsets",
    frequency: "weekly",
    notificationTypes: ["MINIMAL_PERMSETS"],
  },
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

// Resolves the category for a notification type. The single source of truth is
// NOTIFICATION_TYPE_CATEGORY in notifProvider/types.ts. Monitoring command keys are NOT in that
// mapping (the relationship is now via notificationTypes[]) -- monitoringOnlyCategoryOverrides
// gives them a category for display in configuration UIs that still want to group commands.
const monitoringOnlyCategoryOverrides: Record<string, NotificationCategory> = {
  APEX_FLOW_ERRORS: "orgActivity",
};

function resolveNotificationTypeCategory(key: string): NotificationCategory {
  const category = NOTIFICATION_TYPE_CATEGORY[key as NotifMessageType];
  if (!category) {
    throw new Error(
      `Missing category mapping for notification type "${key}". Add it to NOTIFICATION_TYPE_CATEGORY in src/common/notifProvider/types.ts.`,
    );
  }
  return category;
}

function resolveMonitoringCommandCategory(cmd: MonitoringCommandEntry): NotificationCategory {
  const override = monitoringOnlyCategoryOverrides[cmd.key];
  if (override) {
    return override;
  }
  // Derive category from the first notification type the command emits.
  const firstType = cmd.notificationTypes?.[0];
  if (firstType) {
    const category = NOTIFICATION_TYPE_CATEGORY[firstType as NotifMessageType];
    if (category) {
      return category;
    }
  }
  // Last-resort fallback: try the command key itself.
  const fallback = NOTIFICATION_TYPE_CATEGORY[cmd.key as NotifMessageType];
  if (fallback) {
    return fallback;
  }
  throw new Error(
    `Cannot resolve a category for monitoring command "${cmd.key}". Either add an entry to NOTIFICATION_TYPE_CATEGORY for one of its notificationTypes, or to monitoringOnlyCategoryOverrides.`,
  );
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
  // Clamp each per-channel default to the thresholds the notification type can actually be
  // emitted with, so the catalog never reports a value the channel cannot honour at runtime.
  return {
    messaging: clampThresholdToAvailable(defaults.messaging ?? defaultThreshold("messaging"), key),
    email: clampThresholdToAvailable(emailThreshold, key),
    api: clampThresholdToAvailable(defaults.api ?? defaultThreshold("api"), key),
  };
}

export interface MonitoringCommandDefaultEntry {
  key: string;
  title: string;
  description: string;
  category: NotificationCategory;
  command?: string;
  frequency?: MonitoringFrequency;
  frequencyDay?: Weekday;
  frequencyDayOfMonth?: number;
  // Notification type keys this command can emit. Cross-reference into notificationConfig[].
  notificationTypes: string[];
}

export interface NotificationConfigDefaultEntry {
  key: string;
  title: string;
  description: string;
  category: NotificationCategory;
  notifications: Record<NotificationChannel, NotificationThreshold>;
  // Thresholds that can actually fire for this notification type, sorted from most restrictive
  // (e.g. "critical") to least restrictive ("log") and terminated by "off". Configuration UIs
  // should populate the per-channel threshold selector from this list rather than from the
  // global `options.thresholds` array. Any value not in this list is implicitly equivalent to
  // one that is.
  availableThresholds: NotificationThreshold[];
}

export interface MonitoringConfigCategory {
  key: NotificationCategory;
  title: string;
  description: string;
  order: number;
}

export interface MonitoringConfigDefaultsPayload {
  monitoringCommands: MonitoringCommandDefaultEntry[];
  notificationConfig: NotificationConfigDefaultEntry[];
  categories: MonitoringConfigCategory[];
  options: {
    frequencies: MonitoringFrequency[];
    frequencyDays: Weekday[];
    thresholds: NotificationThreshold[];
    channels: NotificationChannel[];
  };
}

export function getMonitoringConfigDefaults(): MonitoringConfigDefaultsPayload {
  const monitoringCommands: MonitoringCommandDefaultEntry[] = monitoringCommandsDefault.map((cmd) => ({
    key: cmd.key,
    title: t(getTitleI18nKey(cmd.key)),
    description: t(getDescriptionI18nKey(cmd.key)),
    category: resolveMonitoringCommandCategory(cmd),
    command: cmd.command,
    frequency: cmd.frequency,
    frequencyDay: cmd.frequencyDay,
    frequencyDayOfMonth: cmd.frequencyDayOfMonth,
    notificationTypes: cmd.notificationTypes ?? [],
  }));

  // Build notificationConfig[] from every entry in NOTIFICATION_TYPE_CATEGORY so the catalog covers
  // every notification type the CLI can emit, whether or not a scheduled command emits it.
  const notificationConfig: NotificationConfigDefaultEntry[] = (
    Object.keys(NOTIFICATION_TYPE_CATEGORY) as NotifMessageType[]
  ).map((key) => ({
    key,
    title: t(getTitleI18nKey(key)),
    description: t(getDescriptionI18nKey(key)),
    category: resolveNotificationTypeCategory(key),
    notifications: resolveDefaultThresholds(key),
    availableThresholds: getAvailableThresholds(key),
  }));

  const categories: MonitoringConfigCategory[] = NOTIFICATION_CATEGORIES.map((cat) => ({
    key: cat.key,
    title: t(getCategoryTitleI18nKey(cat.key)),
    description: t(getCategoryDescriptionI18nKey(cat.key)),
    order: cat.order,
  }));

  return {
    monitoringCommands,
    notificationConfig,
    categories,
    options: {
      frequencies: FREQUENCIES,
      frequencyDays: FREQUENCY_DAYS,
      thresholds: SEVERITY_THRESHOLDS,
      channels: CHANNELS,
    },
  };
}
