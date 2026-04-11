---
title: Apex flex queue (Salesforce monitoring)
description: Monitor AsyncApexJob Holding backlog and get alerts before the flex queue is full
---
<!-- markdownlint-disable MD013 -->

## Detect Apex flex queue backlog

Salesforce limits how many asynchronous Apex jobs can sit in **Holding** status in the **Apex flex queue** (maximum **100** jobs per org). When that limit is reached, additional queueable or batch work may fail or stall until capacity frees up.

This check counts `AsyncApexJob` records with `Status = 'Holding'`, including **ApexClass.Name**, **JobType**, and **CreatedDate** for each job, and sends notifications when:

- **Warning:** the count is **greater than or equal to** the configured threshold (default **90**).
- **Error:** the count reaches **100** (queue full).

Sfdx-hardis command: [sf hardis:org:diagnose:flex-queue](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/flex-queue/)

Key: **APEX_FLEX_QUEUE**

### Environment variables

| Variable                      | Description                                                                                 | Default |
|:------------------------------|:--------------------------------------------------------------------------------------------|:--------|
| **APEX_FLEX_QUEUE_THRESHOLD** | Alert when the number of Holding jobs is **≥** this value (1–100). Overrides `--threshold`. | `90`    |

You can disable this check in `hardis:org:monitor:all` with `MONITORING_DISABLE=APEX_FLEX_QUEUE` or the same value under `monitoringDisable` in `.sfdx-hardis.yml`. See [all environment variables](all-env-variables.md#monitoring-debugging).
