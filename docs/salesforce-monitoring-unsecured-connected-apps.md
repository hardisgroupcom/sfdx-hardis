---
title: Unsecured Connected Apps (Salesforce monitoring)
description: Schedule daily checks of insecure Connected Apps settings with sfdx-hardis Monitoring
---
<!-- markdownlint-disable MD013 -->

## Detect unsecured Connected Apps

Connected Apps with weak security settings can expose your org to unnecessary risks.

This check identifies Connected Apps and External Client Apps that should be reviewed and hardened.

Sfdx-hardis command: [sf hardis:org:diagnose:unsecure-connected-apps](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unsecure-connected-apps/)

Key: **UNSECURED_CONNECTED_APPS**

### Grafana example

![](assets/images/monitoring-unsecured-connected-apps-grafana.png)

### Slack example

![](assets/images/monitoring-unsecured-connected-apps-slack.png)

## Report example

![](assets/images/monitoring-unsecured-connected-apps-report.png)
