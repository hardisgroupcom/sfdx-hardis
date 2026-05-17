import { getConfig } from "../../config/index.js";
import type {
  EmailChannelConfig,
  EmailChannelObject,
  MonitoringCommandEntry,
  MonitoringFrequency,
  NotificationChannel,
  NotificationChannelConfig,
  NotificationConfigEntry,
  NotificationThreshold,
  NotifMessageType,
  NotifSeverity,
  Weekday,
} from "./types.js";
import { notificationTypesDefault } from "./types.js";

const WEEKDAY_INDEX: Record<Weekday, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const DEFAULT_WEEKLY_DAY: Weekday = "saturday";
const DEFAULT_MONTHLY_DAY = 1;

const SEVERITY_RANK: Record<NotifSeverity, number> = {
  log: 0,
  success: 1,
  info: 2,
  warning: 3,
  error: 4,
  critical: 5,
};

const DEFAULT_CHANNEL_THRESHOLD: Record<NotificationChannel, NotificationThreshold> = {
  messaging: "info",
  email: "info",
  api: "log",
};

export function severityMeetsThreshold(severity: NotifSeverity, threshold: NotificationThreshold): boolean {
  if (threshold === "off") {
    return false;
  }
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}

// Meaningful thresholds for a notification type: every severity the type can actually be emitted
// with, plus the universal "log" floor ("send every emission, whatever its severity"), sorted from
// most restrictive to least restrictive and followed by "off".
// "log" is always included because it is the conventional "audit everything" value for the api
// channel even when the type never emits a `log`-severity notification. Any threshold outside this
// list is implicitly equivalent to one inside it (e.g. "error" on a type that only emits
// "warning" is equivalent to "off").
export function getAvailableThresholds(notifType: string): NotificationThreshold[] {
  const emitted = notificationTypesDefault[notifType as NotifMessageType]?.emittedSeverities ?? [];
  const severities = new Set<NotifSeverity>(emitted);
  severities.add("log");
  const sorted = Array.from(severities).sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a]);
  return [...sorted, "off"];
}

// Returns the threshold value the user effectively gets at runtime, given the severities the
// notification type can be emitted with. Used to clamp legacy defaults into the available set so
// configuration UIs never show a value that cannot fire.
//
// Rule: pick the smallest emitted severity whose rank is >= the requested threshold rank. If no
// emitted severity is high enough, the channel is effectively silenced -> "off".
export function clampThresholdToAvailable(
  threshold: NotificationThreshold,
  notifType: string,
): NotificationThreshold {
  if (threshold === "off") {
    return "off";
  }
  const available = getAvailableThresholds(notifType);
  if (available.includes(threshold)) {
    return threshold;
  }
  const emitted = notificationTypesDefault[notifType as NotifMessageType]?.emittedSeverities ?? [];
  if (emitted.length === 0) {
    return "log";
  }
  const targetRank = SEVERITY_RANK[threshold as NotifSeverity];
  const ascending = [...emitted].sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b]);
  for (const candidate of ascending) {
    if (SEVERITY_RANK[candidate] >= targetRank) {
      return candidate;
    }
  }
  return "off";
}

export function isEmailChannelObject(value: EmailChannelConfig | undefined): value is EmailChannelObject {
  return typeof value === "object" && value !== null;
}

export function getChannelThreshold(
  config: NotificationChannelConfig,
  channel: NotificationChannel,
): NotificationThreshold {
  if (channel === "email") {
    const emailConfig = config.email;
    if (isEmailChannelObject(emailConfig)) {
      return emailConfig.threshold ?? DEFAULT_CHANNEL_THRESHOLD.email;
    }
    return emailConfig ?? DEFAULT_CHANNEL_THRESHOLD.email;
  }
  return config[channel] ?? DEFAULT_CHANNEL_THRESHOLD[channel];
}

export function getEmailRecipientsConfig(config: NotificationChannelConfig): {
  recipients: string[];
  replace: boolean;
} {
  const emailConfig = config.email;
  if (!isEmailChannelObject(emailConfig)) {
    return { recipients: [], replace: false };
  }
  return {
    recipients: emailConfig.recipients ?? [],
    replace: emailConfig.replaceRecipients === true,
  };
}

export async function getEffectiveNotificationConfig(notifType: string): Promise<NotificationChannelConfig> {
  const defaults = notificationTypesDefault[notifType as NotifMessageType]?.defaults ?? {};
  const userConfig = await getConfig("user");
  const userEntries: NotificationConfigEntry[] = userConfig.notificationConfig ?? [];
  const userEntry = userEntries.find((entry) => entry?.key === notifType);
  const userNotifications = userEntry?.notifications ?? {};
  return mergeNotificationConfig(defaults, userNotifications);
}

export function mergeNotificationConfig(
  base: NotificationChannelConfig,
  override: NotificationChannelConfig,
): NotificationChannelConfig {
  const merged: NotificationChannelConfig = { ...base };
  if (override.messaging !== undefined) {
    merged.messaging = override.messaging;
  }
  if (override.api !== undefined) {
    merged.api = override.api;
  }
  if (override.email !== undefined) {
    if (isEmailChannelObject(override.email)) {
      const baseEmail = base.email;
      const baseEmailObject: EmailChannelObject = isEmailChannelObject(baseEmail)
        ? baseEmail
        : baseEmail !== undefined
          ? { threshold: baseEmail }
          : {};
      merged.email = {
        threshold: override.email.threshold ?? baseEmailObject.threshold,
        recipients: override.email.recipients ?? baseEmailObject.recipients,
        replaceRecipients: override.email.replaceRecipients ?? baseEmailObject.replaceRecipients,
      };
    } else {
      merged.email = override.email;
    }
  }
  return merged;
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// ISO week number, used to anchor biweekly scheduling. Two commands sharing the same frequencyDay
// fire on the same calendar weeks (even ISO weeks) so cadence is predictable.
function getIsoWeek(date: Date): number {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export interface ScheduleEvaluation {
  shouldRun: boolean;
  reasonKey?: "skippedCommandFrequencyOff" | "skippedCommandWeeklyFrequency" | "skippedCommandBiweeklyFrequency" | "skippedCommandMonthlyFrequency";
}

export function shouldRunCommandNow(
  command: { frequency?: MonitoringFrequency; frequencyDay?: Weekday; frequencyDayOfMonth?: number },
  now: Date = new Date(),
): ScheduleEvaluation {
  const frequency: MonitoringFrequency = command.frequency ?? "daily";
  if (frequency === "off") {
    return { shouldRun: false, reasonKey: "skippedCommandFrequencyOff" };
  }
  if (frequency === "daily") {
    return { shouldRun: true };
  }
  if (frequency === "weekly") {
    const targetDay = WEEKDAY_INDEX[command.frequencyDay ?? DEFAULT_WEEKLY_DAY];
    return now.getDay() === targetDay
      ? { shouldRun: true }
      : { shouldRun: false, reasonKey: "skippedCommandWeeklyFrequency" };
  }
  if (frequency === "biweekly") {
    const targetDay = WEEKDAY_INDEX[command.frequencyDay ?? DEFAULT_WEEKLY_DAY];
    const isAnchorWeek = getIsoWeek(now) % 2 === 0;
    return now.getDay() === targetDay && isAnchorWeek
      ? { shouldRun: true }
      : { shouldRun: false, reasonKey: "skippedCommandBiweeklyFrequency" };
  }
  if (frequency === "monthly") {
    const configuredDay = command.frequencyDayOfMonth ?? DEFAULT_MONTHLY_DAY;
    const daysInMonth = getDaysInMonth(now);
    const effectiveDay = Math.min(Math.max(configuredDay, 1), daysInMonth);
    return now.getDate() === effectiveDay
      ? { shouldRun: true }
      : { shouldRun: false, reasonKey: "skippedCommandMonthlyFrequency" };
  }
  return { shouldRun: true };
}

export function resolveMonitoringCommands<T extends MonitoringCommandEntry>(
  defaults: readonly T[],
  userEntries: readonly MonitoringCommandEntry[] | undefined,
): T[] {
  // Merges user overrides into the default monitoring commands by `key`. Only scheduling fields
  // and notificationTypes are merged here; per-channel notification thresholds live on
  // notificationConfig[] (see getEffectiveNotificationConfig).
  const entries = Array.isArray(userEntries) ? userEntries : [];
  const result: T[] = [];
  const seenKeys = new Set<string>();
  for (const def of defaults) {
    const override = entries.find((entry) => entry?.key === def.key);
    if (override) {
      result.push({ ...def, ...override } as T);
    } else {
      result.push(def);
    }
    seenKeys.add(def.key);
  }
  for (const entry of entries) {
    if (entry?.key && !seenKeys.has(entry.key)) {
      result.push(entry as T);
    }
  }
  return result;
}
