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
- [Notifications](#notifications)
- [Troubleshooting](#troubleshooting)

## Video tutorial

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/bcVdN0XItSc" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

## Instructions

### Common instructions

All you need to configure sfdx-hardis Org Monitoring is a **GitHub** , **Gitlab**, **Azure** or **BitBucket** repository.

- Create and clone a git repository
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

## Notifications

For a better user experience, it is highly recommended to configure notifications !

- [Slack instructions](salesforce-ci-cd-setup-integration-slack.md)
- [Microsoft Teams instructions](salesforce-ci-cd-setup-integration-ms-teams.md)

You can decide to run  commands but not send some notifications by defining either a **notificationsDisable** property in `.sfdx-hardis.yml`, or a comma separated list in env variable **NOTIFICATIONS_DISABLE**

Example in .sfdx-hardis.yml:

```yaml
notificationsDisable:
  - METADATA_STATUS
  - UNUSED_METADATAS
```

Example in env var:

```sh
NOTIFICATIONS_DISABLE=METADATA_STATUS,UNUSED_METADATAS
```

## Monitoring commands

You can decide to disable commands by defining either a **monitoringDisable** property in `.sfdx-hardis.yml`, or a comma separated list in env variable **MONITORING_DISABLE**

Example in .sfdx-hardis.yml:

```yaml
monitoringDisable:
  - METADATA_STATUS
  - UNUSED_METADATAS
```

Example in env var:

```sh
MONITORING_DISABLE=METADATA_STATUS,UNUSED_METADATAS
```

## Troubleshooting

You might want to customize which metadatas types are backuped, because you can't monitor more than 10000 items.

If there are more than 10000 items, your monitoring job will crash.

In that case, you can:

- Single Branch scope: Manually update file `manifest/package-skip-items.xml` in the branch corresponding to an org, then commit and push
- All branches scope: Define CI/CD env var **MONITORING_BACKUP_SKIP_METADATA_TYPES** with the list of additional metadata types you want to skip
  - example: \`MONITORING_BACKUP_SKIP_METADATA_TYPES=CustomLabel,StaticResource,Translation\`