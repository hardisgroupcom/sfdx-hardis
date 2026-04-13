---
title: hardis:org:diagnose:flex-queue
description: Monitor Apex flex queue (AsyncApexJob Holding status) and alert on configurable thresholds
---
<!-- markdownlint-disable MD013 -->

# hardis:org:diagnose:flex-queue

## Description

Counts **AsyncApexJob** records with **Status = 'Holding'** (Apex flex queue), including **ApexClass.Name**, **JobType**, and **CreatedDate** for each job. The org can hold at most **100** such jobs; when the queue is full, new queueable or batch work can fail or stall.

- **Alert:** when the count is **greater than or equal to** `--threshold` (default **90**), or from env **APEX_FLEX_QUEUE_THRESHOLD**.
- **Severity:** **error** when the count reaches **100** (queue full); **warning** when the count is at or above the threshold but below the max.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) and can output Grafana, Slack, and Microsoft Teams notifications.

**Monitoring key:** `APEX_FLEX_QUEUE` (included in [sf hardis:org:monitor:all](https://sfdx-hardis.cloudity.com/hardis/org/monitor/all/), daily).

## Parameters

| Name              |  Type   | Description                                                                                 | Default | Required |
|:------------------|:-------:|:--------------------------------------------------------------------------------------------|:-------:|:--------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                             | `false` |          |
| outputfile<br/>-f | string  | Force the path and name of the output report file (must end with `.csv`)                    |         |          |
| skipauth          | boolean | Skip authentication check when a default username is required                               |         |          |
| target-org<br/>-o | string  | Salesforce org alias or username                                                            |         |          |
| threshold<br/>-t  | integer | Alert when Holding job count ≥ this value (1–100). Overrides **APEX_FLEX_QUEUE_THRESHOLD**. |  `90`*  |          |
| websocket         | string  | Websocket host:port for VsCode SFDX Hardis UI integration                                   |         |          |

\*Default **90** comes from **APEX_FLEX_QUEUE_THRESHOLD** when the env var is set; otherwise **90**.

## Examples

```shell
sf hardis:org:diagnose:flex-queue
```

```shell
sf hardis:org:diagnose:flex-queue --threshold 95
```

```shell
APEX_FLEX_QUEUE_THRESHOLD=85 sf hardis:org:diagnose:flex-queue --outputfile ./reports/flex-queue-holding.csv
```

## Related documentation

- [Apex flex queue (monitoring overview)](https://sfdx-hardis.cloudity.com/salesforce-monitoring-apex-flex-queue/)
- [All environment variables — Monitoring & Debugging](https://sfdx-hardis.cloudity.com/all-env-variables/#monitoring-debugging)
