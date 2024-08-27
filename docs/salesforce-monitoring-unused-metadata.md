---
title: Unused Metadatas (Salesforce monitoring)
description: Schedule daily checks unused metadatas with sfdx-hardis Monitoring
---
<!-- markdownlint-disable MD013 -->

### Detect metadatas that are not used

If there are elements that are not used by anything, maybe they should be removed !

Today working with:

- Custom Labels
- Custom Permissions

Sfdx-hardis command: [sf hardis:lint:unusedmetadatas](https://sfdx-hardis.cloudity.com/hardis/lint/unusedmetadatas/)

Key: **UNUSED_METADATAS**

### Grafana example

![](assets/images/screenshot-monitoring-unused-metadatas-grafana.jpg)

### Slack example

![](assets/images/screenshot-monitoring-unused-metadatas.jpg)