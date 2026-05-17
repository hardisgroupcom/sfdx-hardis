import type {
  MonitoringCommandEntry,
  MonitoringFrequency,
  NotificationCategory,
  NotificationChannel,
  NotificationThreshold,
  NotifMessageType,
  NotifSeverity,
  Weekday,
} from "../notifProvider/types.js";
import { NOTIFICATION_CATEGORIES, notificationTypesDefault } from "../notifProvider/types.js";
import {
  clampThresholdToAvailable,
  getAvailableThresholds,
  isEmailChannelObject,
} from "../notifProvider/notificationConfig.js";
import { t } from "../utils/i18n.js";

// Default monitoring commands run by hardis:org:monitor:all.
// User entries in .sfdx-hardis.yml monitoringCommands[] are merged by key onto this list at runtime.
// Each entry is fully self-contained: it carries its own `category` and `icon` (SLDS) so the
// configuration UI never has to derive them. Per-notification-type metadata still lives on
// `notificationTypesDefault` in src/common/notifProvider/types.ts (see `notificationTypes` for the
// cross-reference).
export const monitoringCommandsDefault: MonitoringCommandEntry[] = [
  {
    key: "AUDIT_TRAIL",
    command: "sf hardis:org:diagnose:audittrail",
    frequency: "daily",
    notificationTypes: ["AUDIT_TRAIL"],
    category: "orgActivity",
    icon: "utility:shield",
  },
  {
    key: "LEGACY_API",
    command: "sf hardis:org:diagnose:legacyapi",
    frequency: "daily",
    notificationTypes: ["LEGACY_API"],
    category: "orgActivity",
    icon: "utility:deprecate",
  },
  {
    key: "ORG_LIMITS",
    command: "sf hardis:org:monitor:limits",
    frequency: "daily",
    notificationTypes: ["ORG_LIMITS"],
    category: "orgInfo",
    icon: "utility:metrics",
  },
  {
    key: "APEX_FLEX_QUEUE",
    command: "sf hardis:org:diagnose:flex-queue",
    frequency: "daily",
    notificationTypes: ["APEX_FLEX_QUEUE"],
    category: "orgActivity",
    icon: "utility:queue",
  },
  {
    key: "APEX_FLOW_ERRORS",
    command: "sf hardis:org:monitor:errors",
    frequency: "daily",
    notificationTypes: ["APEX_ERROR", "FLOW_ERROR"],
    category: "orgActivity",
    icon: "utility:warning",
  },
  {
    key: "UNSECURED_CONNECTED_APPS",
    command: "sf hardis:org:diagnose:unsecure-connected-apps",
    frequency: "daily",
    notificationTypes: ["UNSECURED_CONNECTED_APPS"],
    category: "apexTestsSecurity",
    icon: "utility:lock",
  },
  {
    key: "DEPLOYMENTS",
    command: "sf hardis:org:diagnose:deployments --period weekly",
    frequency: "daily",
    notificationTypes: ["DEPLOYMENTS"],
    category: "orgActivity",
    icon: "utility:upload",
  },
  {
    key: "LICENSES",
    command: "sf hardis:org:diagnose:licenses",
    frequency: "weekly",
    notificationTypes: ["LICENSES"],
    category: "licensesPackages",
    icon: "utility:identity",
  },
  {
    key: "LINT_ACCESS",
    command: "sf hardis:lint:access",
    frequency: "weekly",
    notificationTypes: ["LINT_ACCESS"],
    category: "technicalDebt",
    icon: "utility:key",
  },
  {
    key: "UNUSED_LICENSES",
    command: "sf hardis:org:diagnose:unusedlicenses",
    frequency: "weekly",
    notificationTypes: ["UNUSED_LICENSES"],
    category: "licensesPackages",
    icon: "utility:identity",
  },
  {
    key: "UNUSED_USERS",
    command: "sf hardis:org:diagnose:unusedusers --licensetypes all --days 180",
    frequency: "weekly",
    notificationTypes: ["UNUSED_USERS"],
    category: "userActivity",
    icon: "utility:logout",
  },
  {
    key: "UNUSED_USERS_CRM_6_MONTHS",
    command: "sf hardis:org:diagnose:unusedusers --licensetypes all-crm --days 180",
    frequency: "weekly",
    notificationTypes: ["UNUSED_USERS_CRM_6_MONTHS"],
    category: "userActivity",
    icon: "utility:logout",
  },
  {
    key: "UNUSED_USERS_EXPERIENCE_6_MONTHS",
    command: "sf hardis:org:diagnose:unusedusers --licensetypes experience --days 180",
    frequency: "weekly",
    notificationTypes: ["UNUSED_USERS_EXPERIENCE_6_MONTHS"],
    category: "userActivity",
    icon: "utility:logout",
  },
  {
    key: "ACTIVE_USERS_CRM_WEEKLY",
    command: "sf hardis:org:diagnose:unusedusers --returnactiveusers --licensetypes all-crm --days 7",
    frequency: "weekly",
    notificationTypes: ["ACTIVE_USERS_CRM_WEEKLY"],
    category: "userActivity",
    icon: "utility:user",
  },
  {
    key: "ACTIVE_USERS_EXPERIENCE_MONTHLY",
    command: "sf hardis:org:diagnose:unusedusers --returnactiveusers --licensetypes experience --days 30",
    frequency: "weekly",
    notificationTypes: ["ACTIVE_USERS_EXPERIENCE_MONTHLY"],
    category: "userActivity",
    icon: "utility:user",
  },
  {
    key: "RELEASE_UPDATES",
    command: "sf hardis:org:diagnose:releaseupdates",
    frequency: "weekly",
    notificationTypes: ["RELEASE_UPDATES"],
    category: "orgInfo",
    icon: "utility:date_time",
  },
  {
    key: "ORG_INFO",
    command: "sf hardis:org:diagnose:instanceupgrade",
    frequency: "weekly",
    notificationTypes: ["ORG_INFO"],
    category: "orgInfo",
    icon: "utility:info",
  },
  {
    key: "ORG_HEALTH_CHECK",
    command: "sf hardis:org:monitor:health-check",
    frequency: "weekly",
    notificationTypes: ["ORG_HEALTH_CHECK"],
    category: "apexTestsSecurity",
    icon: "utility:heart",
  },
  {
    key: "UNUSED_METADATAS",
    command: "sf hardis:lint:unusedmetadatas",
    frequency: "weekly",
    notificationTypes: ["UNUSED_METADATAS"],
    category: "technicalDebt",
    icon: "utility:settings",
  },
  {
    key: "UNUSED_APEX_CLASSES",
    command: "sf hardis:org:diagnose:unused-apex-classes",
    frequency: "weekly",
    notificationTypes: ["UNUSED_APEX_CLASSES"],
    category: "technicalDebt",
    icon: "utility:apex",
  },
  {
    key: "APEX_API_VERSION",
    command: "sf hardis:org:diagnose:apex-api-version",
    frequency: "weekly",
    notificationTypes: ["APEX_API_VERSION"],
    category: "technicalDebt",
    icon: "utility:apex",
  },
  {
    key: "CONNECTED_APPS",
    command: "sf hardis:org:diagnose:unused-connected-apps",
    frequency: "weekly",
    notificationTypes: ["CONNECTED_APPS"],
    category: "technicalDebt",
    icon: "utility:apps",
  },
  {
    key: "METADATA_STATUS",
    command: "sf hardis:lint:metadatastatus",
    frequency: "weekly",
    notificationTypes: ["METADATA_STATUS"],
    category: "technicalDebt",
    icon: "utility:settings",
  },
  {
    key: "MISSING_ATTRIBUTES",
    command: "sf hardis:lint:missingattributes",
    frequency: "weekly",
    notificationTypes: ["MISSING_ATTRIBUTES"],
    category: "technicalDebt",
    icon: "utility:question",
  },
  {
    key: "UNDERUSED_PERMSETS",
    command: "sf hardis:org:diagnose:underusedpermsets",
    frequency: "weekly",
    notificationTypes: ["UNDERUSED_PERMSETS"],
    category: "licensesPackages",
    icon: "utility:key",
  },
  {
    key: "MINIMAL_PERMSETS",
    command: "sf hardis:org:diagnose:minimalpermsets",
    frequency: "weekly",
    notificationTypes: ["MINIMAL_PERMSETS"],
    category: "licensesPackages",
    icon: "utility:key",
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

// Each built-in command in monitoringCommandsDefault carries its own `category` and `icon`. The
// resolvers below exist only as a safety net for user-defined custom commands declared via
// .sfdx-hardis.yml monitoringCommands[] -- those entries can legally omit category/icon, in
// which case we inherit from the first notification type the command emits.

function resolveNotificationTypeIcon(key: string): string {
  return notificationTypesDefault[key as NotifMessageType]?.icon ?? "";
}

function resolveMonitoringCommandIcon(cmd: MonitoringCommandEntry): string {
  if (cmd.icon) {
    return cmd.icon;
  }
  const firstType = cmd.notificationTypes?.[0];
  return notificationTypesDefault[firstType as NotifMessageType]?.icon ?? "";
}

function resolveNotificationTypeCategory(key: string): NotificationCategory {
  const category = notificationTypesDefault[key as NotifMessageType]?.category;
  if (!category) {
    throw new Error(
      `Missing notificationTypesDefault entry for notification type "${key}". Add one to src/common/notifProvider/types.ts.`,
    );
  }
  return category;
}

function resolveMonitoringCommandCategory(cmd: MonitoringCommandEntry): NotificationCategory {
  if (cmd.category) {
    return cmd.category;
  }
  const firstType = cmd.notificationTypes?.[0];
  const category = notificationTypesDefault[firstType as NotifMessageType]?.category;
  if (category) {
    return category;
  }
  throw new Error(
    `Cannot resolve a category for monitoring command "${cmd.key}". Declare a \`category\` on the command entry, or add an entry to notificationTypesDefault for one of its notificationTypes.`,
  );
}

// Index NOTIFICATION_CATEGORIES by key for O(1) lookups when resolving per-category fallbacks
// (icon and colorClass).
const NOTIFICATION_CATEGORIES_BY_KEY: Record<NotificationCategory, (typeof NOTIFICATION_CATEGORIES)[number]> =
  NOTIFICATION_CATEGORIES.reduce(
    (acc, cat) => {
      acc[cat.key] = cat;
      return acc;
    },
    {} as Record<NotificationCategory, (typeof NOTIFICATION_CATEGORIES)[number]>,
  );

function resolveCategoryColorClass(category: NotificationCategory): string {
  return NOTIFICATION_CATEGORIES_BY_KEY[category]?.colorClass ?? NOTIFICATION_CATEGORIES_BY_KEY.other.colorClass;
}

function resolveNotificationTypeColorClass(key: string): string {
  const def = notificationTypesDefault[key as NotifMessageType];
  if (def?.colorClass) {
    return def.colorClass;
  }
  if (def?.category) {
    return resolveCategoryColorClass(def.category);
  }
  return resolveCategoryColorClass("other");
}

function resolveMonitoringCommandColorClass(
  cmd: MonitoringCommandEntry,
  category: NotificationCategory,
): string {
  if (cmd.colorClass) {
    return cmd.colorClass;
  }
  const firstType = cmd.notificationTypes?.[0];
  if (firstType) {
    const firstColor = notificationTypesDefault[firstType as NotifMessageType]?.colorClass;
    if (firstColor) {
      return firstColor;
    }
  }
  return resolveCategoryColorClass(category);
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
  const defaults = notificationTypesDefault[key as NotifMessageType]?.defaults ?? {};
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
  // SLDS icon name in `<category>:<name>` form, inherited from the first notification type the
  // command emits (or from the entry's own optional `icon` field for aggregate commands).
  // Empty string when no mapping exists; the UI is expected to fall back to a generic glyph.
  icon: string;
  // CSS class hint used by configuration UIs to color the command badge. Derived from
  // `category` so it stays in sync; configuration UIs can read this directly instead of
  // maintaining their own category-to-color mapping.
  colorClass: string;
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
  // SLDS icon name in `<category>:<name>` form (https://www.salesforceicons.com/), e.g.
  // "utility:dashboard", "standard:report", "action:approval". Empty string when no mapping
  // exists; the UI is expected to fall back to a generic glyph in that case.
  icon: string;
  // CSS class hint used by configuration UIs to color the notification badge. Derived from
  // `category` so it stays in sync; configuration UIs can read this directly instead of
  // maintaining their own category-to-color mapping.
  colorClass: string;
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
  // Default SLDS icon for the category section header (`<category>:<name>`,
  // e.g. "utility:refresh"). UIs that render emojis instead of SLDS icons may keep a local
  // emoji mapping; the CLI standardizes on SLDS to stay consistent with per-type / per-command icons.
  icon: string;
  // CSS class hint used by configuration UIs to color the category section / icon container.
  // Stable across releases so downstream UIs can rely on it for theming.
  colorClass: string;
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
  const monitoringCommands: MonitoringCommandDefaultEntry[] = monitoringCommandsDefault.map((cmd) => {
    const category = resolveMonitoringCommandCategory(cmd);
    return {
      key: cmd.key,
      title: t(getTitleI18nKey(cmd.key)),
      description: t(getDescriptionI18nKey(cmd.key)),
      category,
      icon: resolveMonitoringCommandIcon(cmd),
      colorClass: resolveMonitoringCommandColorClass(cmd, category),
      command: cmd.command,
      frequency: cmd.frequency,
      frequencyDay: cmd.frequencyDay,
      frequencyDayOfMonth: cmd.frequencyDayOfMonth,
      notificationTypes: cmd.notificationTypes ?? [],
    };
  });

  // Build notificationConfig[] from every entry in notificationTypesDefault so the catalog covers
  // every notification type the CLI can emit, whether or not a scheduled command emits it.
  const notificationConfig: NotificationConfigDefaultEntry[] = (
    Object.keys(notificationTypesDefault) as NotifMessageType[]
  ).map((key) => {
    const category = resolveNotificationTypeCategory(key);
    return {
      key,
      title: t(getTitleI18nKey(key)),
      description: t(getDescriptionI18nKey(key)),
      category,
      icon: resolveNotificationTypeIcon(key),
      colorClass: resolveNotificationTypeColorClass(key),
      notifications: resolveDefaultThresholds(key),
      availableThresholds: getAvailableThresholds(key),
    };
  });

  const categories: MonitoringConfigCategory[] = NOTIFICATION_CATEGORIES.map((cat) => ({
    key: cat.key,
    title: t(getCategoryTitleI18nKey(cat.key)),
    description: t(getCategoryDescriptionI18nKey(cat.key)),
    order: cat.order,
    icon: cat.icon,
    colorClass: cat.colorClass,
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
