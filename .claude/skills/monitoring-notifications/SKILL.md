---
name: monitoring-notifications
description: How sfdx-hardis monitoring commands, notification types, frequency, and per-channel routing fit together. Use when adding a new monitoring command, adding a new notification type, changing default routing thresholds, or wiring a new channel.
user-invocable: false
---

# Monitoring and Notifications

This skill documents the moving parts of the monitoring + notification pipeline and lists exactly which files must be touched when adding or modifying a command, notification type, channel, or default.

## Mental model

- **Monitoring command** = a sub-command run by `hardis:org:monitor:all`. Has a `key`, `title`, `command`, `frequency`, and (via the routing map) a `notifications` block. Listed in `monitoringCommandsDefault`.
- **Notification type** = a value of `NotifMessage.type`. Every notification dispatched through `NotifProvider.postNotifications` has one. Listed in the `NotifMessage.type` union.
- **Channel** = a logical bucket of providers. Three exist: `messaging` (Slack + Teams), `email`, `api`. Providers declare their channel via `getChannel()`.
- **Threshold** = the minimum severity required to deliver a notification on a channel. Order, low to high: `log < success < info < warning < error < critical`. The sentinel `off` disables the channel.

Most monitoring commands emit a single notification type whose key matches the command key (e.g. `AUDIT_TRAIL`). The exception is `APEX_FLOW_ERRORS`, which emits two distinct types (`APEX_ERROR` and `FLOW_ERROR`).

## Source of truth for defaults

| What | Where | Notes |
|------|-------|-------|
| Monitoring commands (key, title, command, frequency) | `src/common/monitoring/monitoringDefaults.ts` -> `monitoringCommandsDefault` | Array of `MonitoringCommandEntry`. Iterated by `monitor:all` on every run. |
| Notification-only types (no associated command) | `src/common/monitoring/monitoringDefaults.ts` -> `notificationOnlyTypes` | Drives the configuration UI payload. |
| Per-channel routing defaults | `src/common/notifProvider/notificationDefaults.ts` -> `notificationDefaults` | Keyed by `NotifMessage.type`. Per-key map of `{ messaging?, email?, api? }` thresholds. Missing channels fall back to `messaging: info`, `email: info`, `api: log`. |
| Notification type union | `src/common/notifProvider/types.ts` -> `NotifMessage.type` | The TypeScript union. Maintainer comment at the top lists everywhere to update. |

## User override model

Users override defaults in `.sfdx-hardis.yml` via the `monitoringCommands` array, merged by `key`:

- `monitor:all` calls `resolveMonitoringCommands(monitoringCommandsDefault, userEntries)` from `src/common/notifProvider/notificationConfig.ts`. For each default, any matching-by-key user entry is shallow-merged on top; user-only entries (keys not present in defaults) are appended.
- `NotifProvider.postNotifications` calls `getEffectiveNotificationConfig(notifType)` from the same file. It reads `notificationDefaults[type]` and merges the user's `monitoringCommands[i].notifications` block on top, field-by-field.
- Net effect: **fields the user didn't set automatically pick up new defaults the next time you ship**. Fields the user explicitly set keep their value (user intent wins).

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
     title: 'Short imperative title',
     command: 'sf hardis:your:new:command',
     frequency: 'weekly',
     // frequencyDay: 'monday',           // optional
     // frequencyDayOfMonth: 1,           // optional, monthly only
   }
   ```

2. **`src/common/notifProvider/types.ts`** -- add `'YOUR_NEW_COMMAND'` to the `NotifMessage.type` union (alphabetical-ish, but matching neighbours is fine).

3. **`src/common/notifProvider/notificationDefaults.ts`** -- add a `notificationDefaults['YOUR_NEW_COMMAND']` entry with the default per-channel thresholds. Default pattern: `{ messaging: 'warning', email: 'error', api: 'log' }` for issues to act on; `{ messaging: 'info', email: 'warning', api: 'log' }` for informational reports. Always include `api: 'log'` unless there's a reason not to (the API/Grafana provider expects to receive everything).

4. **`config/sfdx-hardis.jsonschema.json`** -- add the key to **both** `definitions.enum_monitoring_commands.enum`/`enumNames` **and** `definitions.enum_notification_types.enum`/`enumNames`. Keep both arrays alphabetically sorted.

5. **i18n** -- add two keys per locale, all 9 of them (`en, de, es, fr, it, ja, nl, pl, pt-BR`). Naming follows the pattern emitted by the helpers in `monitoringDefaults.ts`:
   - `notifTypeTitle<PascalCaseKey>` -- short label shown in the configuration UI.
   - `notifTypeDesc<PascalCaseKey>` -- one-line explanation.
   - PascalCase conversion: `YOUR_NEW_COMMAND` -> `YourNewCommand`; `UNUSED_USERS_CRM_6_MONTHS` -> `UnusedUsersCrm6Months`.
   - The `title` field on the `monitoringCommandsDefault` entry is the source for the existing English title -- copy it into `notifTypeTitle...` in `en.json`.
   - Follow `.claude/rules/translations.md` for the other 8 locales. Each locale file has its own sort convention (see existing entries); `pt-BR.json` uses case-insensitive ordering, the others use case-sensitive.

6. **In the new command's source file** -- when calling `NotifProvider.postNotifications(...)`, set `type: 'YOUR_NEW_COMMAND'`. Pick the right `severity` per case (it interacts with the threshold filter, so emit `warning`/`error` only when you really want to push to messaging by default).

7. **CHANGELOG.md** -- add a bullet under `## [beta] (main)` pointing at the new command.

You usually do **not** need to touch `src/commands/hardis/org/monitor/all.ts` -- it imports `monitoringCommandsDefault` from the shared module.

## Adding a new notification type (no associated command)

For notification types emitted outside `monitor:all` (e.g. `BACKUP`, `DEPLOYMENT`, `DORA_REPORT`):

1. **`src/common/notifProvider/types.ts`** -- add the type to the `NotifMessage.type` union.
2. **`src/common/notifProvider/notificationDefaults.ts`** -- add a default routing entry.
3. **`src/common/monitoring/monitoringDefaults.ts`** -- append the key to `notificationOnlyTypes` so the configuration UI command surfaces it.
4. **`config/sfdx-hardis.jsonschema.json`** -- add the key to `definitions.enum_notification_types`. Do **not** add it to `enum_monitoring_commands` (it isn't a command).
5. **i18n** -- add `notifTypeTitle<PascalCaseKey>` and `notifTypeDesc<PascalCaseKey>` in all 9 locales.
6. Use `NotifProvider.postNotifications({ type: 'YOUR_TYPE', ... })` in the code that emits the notification.

## Changing default routing for an existing key

Edit `notificationDefaults[KEY]` in `src/common/notifProvider/notificationDefaults.ts`. That's it. Existing installations pick the change up automatically for any channel the user did not explicitly override.

If you change a default that a user has fully overridden in their YAML, their override wins. That's intentional.

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
  "entries": [
    {
      "key": "AUDIT_TRAIL",
      "kind": "monitoringCommand" | "notificationType",
      "title": "...",          // translated
      "description": "...",    // translated
      "command": "sf hardis:...",      // monitoringCommand only
      "frequency": "daily",            // monitoringCommand only
      "frequencyDay": "saturday",      // optional
      "frequencyDayOfMonth": 1,        // optional
      "notifications": { "messaging": "warning", "email": "error", "api": "log" }
    }
  ],
  "options": {
    "frequencies": ["daily","weekly","biweekly","monthly","off"],
    "frequencyDays": ["monday",...,"sunday"],
    "thresholds": ["log","success","info","warning","error","critical","off"],
    "channels": ["messaging","email","api"]
  }
}
```

The command does **not** read `.sfdx-hardis.yml` -- the UI reads it directly and merges the user values on top using merge-by-key semantics. Title/description are resolved via `t()` so they honour `SFDX_HARDIS_LANG`.

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

The `entries[]` length should equal `monitoringCommandsDefault.length + notificationOnlyTypes.length` (no duplicates).
