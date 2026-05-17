---
name: monitoring-notifications
description: How sfdx-hardis monitoring commands, notification types, frequency, and per-channel routing fit together. Use when adding a new monitoring command, adding a new notification type, changing default routing thresholds, or wiring a new channel.
user-invocable: false
---

# Monitoring and Notifications

This skill documents the moving parts of the monitoring + notification pipeline and lists exactly which files must be touched when adding or modifying a command, notification type, channel, or default.

## Mental model

- **Monitoring command** = a sub-command run by `hardis:org:monitor:all`. Has a `key`, `command`, `frequency`, and a `notificationTypes: string[]` declaring which notification type keys it can emit. Listed in `monitoringCommandsDefault`. Routing thresholds are NOT stored here.
- **Notification type** = a value of `NotifMessage.type`. Every notification dispatched through `NotifProvider.postNotifications` has one. Listed in the `NotifMessage.type` union. Its per-channel routing thresholds live in `notificationDefaults`.
- **Channel** = a logical bucket of providers. Three exist: `messaging` (Slack + Teams), `email`, `api`. Providers declare their channel via `getChannel()`.
- **Threshold** = the minimum severity required to deliver a notification on a channel. Order, low to high: `log < success < info < warning < error < critical`. The sentinel `off` disables the channel.

Most monitoring commands emit a single notification type whose key matches the command key (e.g. `AUDIT_TRAIL` command emits `AUDIT_TRAIL`). The exception is `APEX_FLOW_ERRORS`, which emits two distinct types via `notificationTypes: ['APEX_ERROR', 'FLOW_ERROR']`.

## Source of truth for defaults

| What                                                 | Where                                                                        | Notes                                                                                                                                                                        |
|------------------------------------------------------|------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Monitoring commands (key, command, frequency, notif refs) | `src/common/monitoring/monitoringDefaults.ts` -> `monitoringCommandsDefault` | Array of `MonitoringCommandEntry`. Iterated by `monitor:all` on every run. Each entry has `notificationTypes: string[]`.                                              |
| Per-channel routing defaults                         | `src/common/notifProvider/notificationDefaults.ts` -> `notificationDefaults` | Keyed by `NotifMessage.type`. Per-key map of `{ messaging?, email?, api? }` thresholds. Missing channels fall back to `messaging: info`, `email: info`, `api: log`.          |
| Notification type union                              | `src/common/notifProvider/types.ts` -> `NotifMessageType`                    | The TypeScript union. Maintainer comment in `NotifMessage` lists everywhere to update.                                                                                       |
| Notification type -> category mapping                | `src/common/notifProvider/types.ts` -> `NOTIFICATION_TYPE_CATEGORY`          | `Record<NotifMessageType, NotificationCategory>` -- exhaustive, so a new union member without a category is a compile error.                                                 |
| Notification type -> severities it can be emitted with | `src/common/notifProvider/types.ts` -> `NOTIFICATION_TYPE_EMITTED_SEVERITIES` | `Record<NotifMessageType, NotifSeverity[]>` -- drives the `availableThresholds` array surfaced by the monitoring-defaults catalog and the `clampThresholdToAvailable()` helper. Whenever you add or change a `severity:` value on a `NotifProvider.postNotifications` call, update the matching entry. |
| Category list (titles + order)                       | `src/common/notifProvider/types.ts` -> `NOTIFICATION_CATEGORIES`             | The 7 categories rendered as sections in the configuration UI (`orgActivity`, `userActivity`, `apexTestsSecurity`, `orgInfo`, `technicalDebt`, `licensesPackages`, `other`). |

## User override model

The user `.sfdx-hardis.yml` has **two independent top-level keys**, each merged by `key` onto its respective defaults list:

- `monitoringCommands:` -- scheduling overrides. `monitor:all` calls `resolveMonitoringCommands(monitoringCommandsDefault, userEntries)` from `src/common/notifProvider/notificationConfig.ts`. Each user entry is shallow-merged on top of the matching default; user-only entries (new keys) are appended as custom commands.
- `notificationConfig:` -- per-notification-type routing overrides. `NotifProvider.postNotifications` calls `getEffectiveNotificationConfig(notifType)` from the same file. It reads `notificationDefaults[type]` and merges the user's `notificationConfig[i].notifications` block on top, field-by-field.

Net effect: **fields the user did not set automatically pick up new defaults the next time you ship**. Fields the user explicitly set keep their value (user intent wins).

This is a breaking change from the previous shape, where thresholds lived on `monitoringCommands[].notifications`. Old user YAML must be migrated; see CHANGELOG for the migration note.

## Frequency model

Implemented in `shouldRunCommandNow()` in `notificationConfig.ts`. Each entry's `frequency` is one of:

- `daily` -- runs every time.
- `weekly` -- runs on `frequencyDay` (default `saturday`).
- `biweekly` -- runs on `frequencyDay` of even ISO weeks (anchored, predictable).
- `monthly` -- runs on `frequencyDayOfMonth` (default `1`, clamped to last day for short months).
- `off` -- never runs unless `--force-all` or env var `MONITORING_IGNORE_FREQUENCY=true`.

## Adding a new monitoring command

Touch these files, in this order. The new command will be picked up on every existing installation automatically (as long as the user has not overridden the same key).

1. **`src/common/monitoring/monitoringDefaults.ts`** -- append an entry to `monitoringCommandsDefault`:
   ```ts
   {
     key: 'YOUR_NEW_COMMAND',
     command: 'sf hardis:your:new:command',
     frequency: 'weekly',
     notificationTypes: ['YOUR_NEW_COMMAND'], // most commands list their own key; APEX_FLOW_ERRORS-style aggregates list 2+ different keys
     // frequencyDay: 'monday',           // optional
     // frequencyDayOfMonth: 1,           // optional, monthly only
   }
   ```
   Do not set a hardcoded `title` -- the title is resolved at runtime from the `notifTypeTitle<PascalCaseKey>` i18n key (see step 5).

2. **`src/common/notifProvider/types.ts`** -- add the notification type emitted by the command (typically the same key as the command, but it can differ) to the `NotifMessageType` union **and** add a matching entry to `NOTIFICATION_TYPE_CATEGORY` assigning it to one of the seven categories. The record is typed `Record<NotifMessageType, NotificationCategory>` so the compiler enforces this. If the command aggregates multiple notification types (like `APEX_FLOW_ERRORS` -> `APEX_ERROR` + `FLOW_ERROR`), add the command key itself to `monitoringOnlyCategoryOverrides` in `monitoringDefaults.ts` to pin a category for the command row in configuration UIs.

3. **`src/common/notifProvider/notificationDefaults.ts`** -- add a `notificationDefaults['YOUR_NEW_COMMAND']` entry with the default per-channel thresholds. Default pattern: `{ messaging: 'warning', email: 'error', api: 'log' }` for issues to act on; `{ messaging: 'info', email: 'warning', api: 'log' }` for informational reports. Always include `api: 'log'` unless there's a reason not to (the API/Grafana provider expects to receive everything). Each per-channel threshold MUST be one of the severities the type can actually be emitted with (see `NOTIFICATION_TYPE_EMITTED_SEVERITIES` in `types.ts`) or `'off'` -- the catalog clamps any out-of-range value, so a mismatch silently downgrades to `'off'` or to the nearest emitted severity.

   Also add an entry to `NOTIFICATION_TYPE_EMITTED_SEVERITIES` in `src/common/notifProvider/types.ts` listing every `severity:` value your command may pass to `NotifProvider.postNotifications`.

4. **`config/sfdx-hardis.jsonschema.json`** -- add the key to **both** `definitions.enum_monitoring_commands.enum`/`enumNames` **and** `definitions.enum_notification_types.enum`/`enumNames`. Keep both arrays alphabetically sorted.

5. **i18n** -- add two keys per locale, all 9 of them (`en, de, es, fr, it, ja, nl, pl, pt-BR`). Naming follows the pattern emitted by the helpers in `monitoringDefaults.ts`:
   - `notifTypeTitle<PascalCaseKey>` -- short label shown in the configuration UI.
   - `notifTypeDesc<PascalCaseKey>` -- one-line explanation.
   - PascalCase conversion: `YOUR_NEW_COMMAND` -> `YourNewCommand`; `UNUSED_USERS_CRM_6_MONTHS` -> `UnusedUsersCrm6Months`.
   - `notifTypeTitle...` is the single source of truth for the title (the docs table generator in `monitor:all` resolves it via `t(getTitleI18nKey(cmd.key))`). Write a short imperative phrase, and wrap the most informative noun phrase in `**...**` so it stands out in UIs that render markdown (e.g. `"Detect if **org limits** are close to be reached"`).
   - Follow `.claude/rules/translations.md` for the other 8 locales. Each locale file has its own sort convention (see existing entries); `pt-BR.json` uses case-insensitive ordering, the others use case-sensitive.

6. **In the new command's source file** -- when calling `NotifProvider.postNotifications(...)`, set `type: 'YOUR_NEW_COMMAND'` (or whichever notification type key your command emits). Pick the right `severity` per case (it interacts with the threshold filter, so emit `warning`/`error` only when you really want to push to messaging by default).

7. **CHANGELOG.md** -- add a bullet under `## [beta] (main)` pointing at the new command.

You usually do **not** need to touch `src/commands/hardis/org/monitor/all.ts` -- it imports `monitoringCommandsDefault` from the shared module.

## Adding a new notification type (not bound to a scheduled command)

For notification types emitted outside `monitor:all` (e.g. `BACKUP`, `DEPLOYMENT`, `DORA_REPORT`):

1. **`src/common/notifProvider/types.ts`** -- add the type to the `NotifMessageType` union **and** add an entry to `NOTIFICATION_TYPE_CATEGORY` (exhaustiveness check will fail compilation if you forget).
2. **`src/common/notifProvider/notificationDefaults.ts`** -- add a default routing entry.
3. **`config/sfdx-hardis.jsonschema.json`** -- add the key to `definitions.enum_notification_types`. Do **not** add it to `enum_monitoring_commands` (it isn't a command).
4. **i18n** -- add `notifTypeTitle<PascalCaseKey>` and `notifTypeDesc<PascalCaseKey>` in all 9 locales.
5. Use `NotifProvider.postNotifications({ type: 'YOUR_TYPE', ... })` in the code that emits the notification.

The new type appears automatically in `notificationConfig[]` of the `hardis:config:monitoring-defaults` payload because that list is derived from `NOTIFICATION_TYPE_CATEGORY`.

## Changing default routing for an existing key

Edit `notificationDefaults[KEY]` in `src/common/notifProvider/notificationDefaults.ts`. That's it. Existing installations pick the change up automatically for any channel the user did not explicitly override.

If you change a default that a user has fully overridden in their YAML (`notificationConfig:` entry), their override wins. That's intentional.

## Adding a new channel

Three steps if you ever need a fourth channel:

1. Extend `NotificationChannel` in `src/common/notifProvider/types.ts`.
2. Implement a new `Provider` extending `NotifProviderRoot` with `getChannel()` returning the new value; register it in `NotifProvider.getInstances()` in `src/common/notifProvider/index.ts`.
3. Update `DEFAULT_CHANNEL_THRESHOLD` in `notificationConfig.ts` and the `channels` array in `getMonitoringConfigDefaults()` (`monitoringDefaults.ts`).
4. Extend `config/sfdx-hardis.jsonschema.json` `definitions.notification_channel_config.properties` to expose it in YAML autocompletion.

## Configuration UI / VS Code extension contract

The VS Code extension reads defaults via the read-only `hardis:config:monitoring-defaults` command (`src/commands/hardis/config/monitoring-defaults.ts`). It returns:

```jsonc
{
  "monitoringCommands": [
    {
      "key": "APEX_FLOW_ERRORS",
      "title": "...",          // translated
      "description": "...",    // translated
      "category": "orgActivity",       // foreign key to categories[]
      "command": "sf hardis:org:monitor:errors",
      "frequency": "daily",
      "frequencyDay": "saturday",      // optional
      "frequencyDayOfMonth": 1,        // optional
      "notificationTypes": ["APEX_ERROR", "FLOW_ERROR"]  // cross-refs into notificationConfig[]
    }
  ],
  "notificationConfig": [
    {
      "key": "APEX_ERROR",
      "title": "...",          // translated
      "description": "...",    // translated
      "category": "orgActivity",       // foreign key to categories[]
      "notifications": { "messaging": "error", "email": "error", "api": "log" },
      "availableThresholds": ["error", "success", "log", "off"]   // emitted severities + "log" (always) + "off"
    }
  ],
  "categories": [
    { "key": "orgActivity", "title": "Org Activity", "description": "...", "order": 1 }
  ],
  "options": {
    "frequencies": ["daily","weekly","biweekly","monthly","off"],
    "frequencyDays": ["monday",...,"sunday"],
    "thresholds": ["log","success","info","warning","error","critical","off"],
    "channels": ["messaging","email","api"]
  }
}
```

The command does **not** read `.sfdx-hardis.yml` -- the UI reads it directly and merges the user values on top, using merge-by-key semantics on each list independently. Title/description are resolved via `t()` so they honour `SFDX_HARDIS_LANG`.

## Verification checklist

After any change in this area, run:

```sh
yarn compile      # TypeScript catches missing union members and enum drift
yarn lint
yarn build:doc    # Regenerates docs/hardis/**/*.md including monitor:all and config:monitoring-defaults
node -e "for (const l of ['en','de','es','fr','it','ja','nl','pl','pt-BR']) JSON.parse(require('fs').readFileSync('src/i18n/'+l+'.json','utf8'))"
```

Then smoke-test:

```sh
node bin/dev.js hardis:config:monitoring-defaults --json
SFDX_HARDIS_LANG=fr node bin/dev.js hardis:config:monitoring-defaults --json   # confirms translations resolve
```

`monitoringCommands[]` length should equal `monitoringCommandsDefault.length`, and `notificationConfig[]` length should equal `Object.keys(NOTIFICATION_TYPE_CATEGORY).length`.
