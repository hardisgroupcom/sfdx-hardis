---
title: Suspect Setup Actions (Salesforce monitoring)
description: Schedule daily checks of suspect actions in setup with sfdx-hardis Monitoring
---
<!-- markdownlint-disable MD013 -->

## Detect calls to deprecated API versions

Will check if [legacy API versions are called by external tools](https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238).

Sfdx-hardis command: [sf hardis:org:diagnose:legacyapi](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi/)

Key: **LEGACY_API**

### Grafana example

![](assets/images/screenshot-monitoring-legacyapi-grafana.jpg)

### Slack example

![](assets/images/screenshot-monitoring-legacyapi.jpg)