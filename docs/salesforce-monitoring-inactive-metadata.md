---
title: Inactive Metadatas (Salesforce monitoring)
description: Schedule daily checks of inactive metadata (Flows, Validation rules...) with sfdx-hardis Monitoring
---
<!-- markdownlint-disable MD013 -->

## Detect inactive metadata

Are you sure this **inactive flow** should be inactive ?

And what about this **deactivated Validation** Rule ?

Maybe it's time to remove them !

Full list of metadata types that are checked:

- Approval Processes
- Assignment Rules
- Auto Response Rules
- Escalation Rules
- Flows
- Forecasting Types
- Record Types
- Validation Rules
- Workflow Rules

Sfdx-hardis command: [sf hardis:lint:metadatastatus](https://sfdx-hardis.cloudity.com/hardis/lint/metadatastatus/)

Key: **METADATA_STATUS**

### Grafana example

![](assets/images/screenshot-monitoring-inactive-metadata-grafana.jpg)

### Slack example

![](assets/images/screenshot-monitoring-inactive-metadata.jpg)

### Local example

![](assets/images/detect-inactive-metadata.gif)