---
title: How to monitor your Salesforce Org
description: Learn how to configure a monitoring repository for a Salesforce Org, using sfdx-hardis, then how to read reports
---
<!-- markdownlint-disable MD013 -->

- [Video tutorial](#video-tutorial)
- [Instructions](#instructions)
  - [Common instructions](#common-instructions)
  - [Github](#github)
  - [Gitlab](#gitlab)
  - [Azure](#azure)
  - [Bitbucket](#bitbucket)
  - [Jenkins (any Git server)](#jenkins-any-git-server)
- [Notifications](#notifications)
- [Troubleshooting](#troubleshooting)

## Video tutorial

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/bcVdN0XItSc" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

## Instructions

### Common instructions

All you need to configure sfdx-hardis Org Monitoring is a **GitHub**, **Gitlab**, **Azure**, **BitBucket** or any Git server accessible from a **Jenkins** instance.

- Create and clone a git repository (initialize it with README)
- Open it with Visual Studio Code, then open [VsCode SFDX Hardis](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis) extension menu.
  - If you need installations instructions, please [visit documentation page](salesforce-ci-cd-use-install.md)

- Follow instructions, that can be specific according to your git provider

> Tip: Schedule monitoring jobs at different hours so the notifications are more readable, for example production at 1AM and preprod at 2AM

### Github

- [GitHub configuration](salesforce-monitoring-config-github.md)
  - [Pre-requisites](salesforce-monitoring-config-github.md#pre-requisites)
  - [Schedule monitoring job](salesforce-monitoring-config-github.md#schedule-the-monitoring-job)

### Gitlab

- [Gitlab configuration](salesforce-monitoring-config-gitlab.md)
  - [Pre-requisites](salesforce-monitoring-config-gitlab.md#pre-requisites)
  - [Schedule monitoring job](salesforce-monitoring-config-gitlab.md#schedule-the-monitoring-job)

### Azure

- [Azure configuration](salesforce-monitoring-config-azure.md)
  - [Pre-requisites](salesforce-monitoring-config-azure.md#pre-requisites)
  - [Schedule monitoring job](salesforce-monitoring-config-azure.md#schedule-the-monitoring-job)

### Bitbucket

- [Bitbucket configuration](salesforce-monitoring-config-bitbucket.md)
  - [Pre-requisites](salesforce-monitoring-config-bitbucket.md#pre-requisites)
  - [Schedule monitoring job](salesforce-monitoring-config-bitbucket.md#schedule-the-monitoring-job)

### Jenkins (any Git server)

- [Jenkins configuration](salesforce-monitoring-config-jenkins.md)
  - [Pre-requisites](salesforce-monitoring-config-jenkins.md#pre-requisites)
  - [Schedule monitoring job](salesforce-monitoring-config-jenkins.md#schedule-the-monitoring-job)

## Notifications

For a better user experience, it is highly recommended to configure notifications !

You can wire any combination of the following targets - they are fully independent and can be enabled in parallel:

- [Slack instructions](salesforce-ci-cd-setup-integration-slack.md) -- post to one or several Slack channels (global, branch-scoped, errors-only)
- [Microsoft Teams instructions](salesforce-ci-cd-setup-integration-ms-teams.md) -- post to Teams channels via incoming webhooks
- [Email instructions](salesforce-ci-cd-setup-integration-email.md) -- send to any recipient list, with per-notification-type overrides
- [API / Grafana instructions](salesforce-ci-cd-setup-integration-api.md) -- stream logs and Prometheus metrics to Grafana Loki, Prometheus, or any HTTP endpoint (used to build [Grafana dashboards](salesforce-ci-cd-setup-integration-api.md#grafana-setup))

sfdx-hardis groups these targets into three channels, and you can configure each channel independently per notification type:

- **messaging** -- Slack and Microsoft Teams
- **email** -- email recipients
- **api** -- the sfdx-hardis API / metrics provider (e.g. Grafana Loki, Prometheus). The `api` channel is always sent when configured, unless explicitly set to `off`.

The full configuration (frequency, per-channel severity thresholds, custom commands) can be edited from the [VS Code SFDX Hardis extension](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis) UI, or directly in `.sfdx-hardis.yml`:

![](assets/images/monitoring-config-2026.gif)

### Fine-grained routing per notification type

You can configure, for each notification type, the minimum severity that must be reached before a channel is notified. This avoids overflowing Slack/Teams with informational notifications while still streaming everything to Grafana.

Severity order (low to high): `log < success < info < warning < error < critical`. Use `off` to disable a channel for a given notification type.

```yaml
monitoringCommands:
  - key: AUDIT_TRAIL
    notifications:
      messaging: warning   # Slack/Teams only on warning, error, critical
      email: error         # email only on error and critical
      api: log             # everything goes to Grafana
  - key: ORG_LIMITS
    notifications:
      messaging: error
      email: critical
  - key: METADATA_STATUS
    notifications:
      messaging: off       # mute Slack/Teams for this notification type
```

### Override email recipients per notification type

For email, you can also override the recipient list per notification type, on top of the env-var-based recipients (`NOTIF_EMAIL_ADDRESS`, `NOTIF_EMAIL_ADDRESS_<BRANCH>`, `NOTIF_EMAIL_ADDRESS_<TYPE>`). Recipients listed in YAML are appended by default; set `replaceRecipients: true` to fully redirect the notification type to a dedicated mailing list.

```yaml
monitoringCommands:
  - key: AUDIT_TRAIL
    notifications:
      email:
        threshold: warning
        recipients:
          - security@company.com
          - audit-team@company.com
        replaceRecipients: true   # ignore env-var recipients for this type
  - key: BACKUP
    notifications:
      email:
        recipients:
          - devops@company.com    # appended to existing env-var recipients
```

You can also decide to skip posting logs or metrics to API for all notification types or specific ones by defining env variables **NOTIF_API_SKIP_LOGS** and **NOTIF_API_SKIP_METRICS**.

Examples:

```sh
# Skip posting logs to API and JSON file for specific notification types
NOTIF_API_SKIP_LOGS=UNUSED_USERS,METADATA_STATUS
```

```sh
# Skip posting logs to API and JSON file for all notification types
NOTIF_API_SKIP_LOGS=all
# Skip posting metrics to API for specific notification types
NOTIF_API_SKIP_METRICS=METADATA_STATUS,UNUSED_METADATAS
```

## Monitoring commands

You can fine-tune which monitoring commands run, how often, and how their notifications are routed via the **monitoringCommands** property in `.sfdx-hardis.yml`. User entries are **merged by `key`** onto the built-in defaults, so you only need to declare the fields you want to override; new keys are appended as custom commands.

### Frequency

Each entry accepts a `frequency` field with one of:

- `daily` -- runs every run
- `weekly` -- runs once per week. The firing day is configurable via `frequencyDay` (`monday`..`sunday`, default `saturday`)
- `biweekly` -- runs every other week. Same `frequencyDay` selector. The anchor uses ISO week parity so two `biweekly` entries with the same `frequencyDay` always fire on the same calendar weeks
- `monthly` -- runs once per month. The firing day is configurable via `frequencyDayOfMonth` (`1`..`31`, default `1`). Values larger than the current month's last day are clamped to the last day, so `31` reliably means "last day of the month"
- `off` -- never runs unless `--force-all` is passed to `hardis:org:monitor:all` (or env var `MONITORING_IGNORE_FREQUENCY=true` is set)

Example overriding cadence + day:

```yaml
monitoringCommands:
  - key: AUDIT_TRAIL
    frequency: weekly
    frequencyDay: monday
  - key: LICENSES
    frequency: monthly
    frequencyDayOfMonth: 1
  - key: ORG_LIMITS
    frequency: off
```

### Custom commands

To add a brand new command, declare a new key with `title` and `command`. Frequency and notifications are optional and behave the same as built-in entries:

```yaml
monitoringCommands:
  - key: MY_CUSTOM_REPORT
    title: My custom command
    command: sf my:custom:command
    frequency: biweekly
    frequencyDay: friday
    notifications:
      messaging: info
      email: warning
```

## Troubleshooting

You might want to customize which metadatas types are backuped, because you can't monitor more than 10000 items.

If there are more than 10000 items, your monitoring job will crash.

In that case, you can:

- Single Branch scope: Manually update file `manifest/package-skip-items.xml` in the branch corresponding to an org, then commit and push. It works with:
  - Full wildcard (`<members>*</members>`)
  - Named metadata (`<members>Account.Name</members>`)
  - Partial wildcards names (`<members>pi__*</members>` , `<members>*__dlm</members>` , or `<members>prefix*suffix</members>`)

- All branches scope: Define CI/CD env var **MONITORING_BACKUP_SKIP_METADATA_TYPES** with the list of additional metadata types you want to skip
  - example: \`MONITORING_BACKUP_SKIP_METADATA_TYPES=CustomLabel,StaticResource,Translation\`