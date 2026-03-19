---
title: Deployments Monitoring (Salesforce monitoring)
description: Analyze metadata deployments and validations with sfdx-hardis Monitoring
---
<!-- markdownlint-disable MD013 -->

## Analyze metadata deployments and validations

Analyzes metadata deployments and validations by querying DeployRequest records via the Tooling API.

Sfdx-hardis command: [sf hardis:org:diagnose:deployments](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/deployments/)

Key: **DEPLOYMENTS**

### What it does

- Queries DeployRequest via Tooling API (excludes InProgress)
- Distinguishes deployments from validations (CheckOnly)
- Tracks status (Succeeded, Failed, Canceled)
- Calculates pending time (CreatedDate → StartDate) and duration (StartDate → CompletedDate)
- Generates CSV/XLSX report and sends notifications (Grafana, Slack, MS Teams)

### Options

- `--period daily|weekly|all` – Time period: daily (last 24h), weekly (last 7 days), or all (default: daily). No limit applied; Salesforce retains DeployRequest records for ~30 days.

### Metrics reported

- **Success rate %** – Succeeded / total for deployments and validations
- **Average duration (min)** – Mean deployment/validation time (StartDate → CompletedDate)
- **Average pending (min)** – Mean queue time (CreatedDate → StartDate)
