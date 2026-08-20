---
title: Suspect Setup Actions (Salesforce monitoring)
description: Schedule daily checks of suspect actions in setup with sfdx-hardis Monitoring
---
<!-- markdownlint-disable MD013 -->

## Detect suspect setup actions in major org

Extracts from the Audit Trail all actions that are considered suspect, except the ones related to the deployment user and to a given list of users, such as the release manager.

Sfdx-hardis command: [sf hardis:org:diagnose:audittrail](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/audittrail/)

Key: **AUDIT_TRAIL**

### Grafana example

![](assets/images/screenshot-monitoring-audittrail-grafana.jpg)

### Slack example

![](assets/images/screenshot-monitoring-audittrail.jpg)

## Excel output example

![](assets/images/screenshot-monitoring-audittrail-excel.jpg)

## Local output example

![](assets/images/screenshot-monitoring-audittrail-local.jpg)
