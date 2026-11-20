---
title: Check Release Updates (Salesforce monitoring)
description: Schedule weekly checks of Setup Release Updates with sfdx-hardis Monitoring
---
<!-- markdownlint-disable MD013 -->

## Check Release Updates

!!! warning "Deprecated"
    This check is replaced by [What will break](salesforce-monitoring-what-will-break.md), which checks the release updates due together with everything else that will break after a dated Salesforce change. The daily monitoring now runs it instead.

Before publishing **breaking changes**, Salesforce announces them in the Setup menu [**Release Updates**](https://help.salesforce.com/s/articleView?id=sf.release_updates.htm&type=5).

⚠️ Some of them are very important: if you do not make the related changes in time (for example before Winter '25), your production org can crash.

This command extracts the Release Updates that need to be checked in your org.

Sfdx-hardis command: [sf hardis:org:diagnose:releaseupdates](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/releaseupdates/)

Key: **RELEASE_UPDATES**

### Grafana example

![](assets/images/screenshot-monitoring-release-updates-grafana.jpg)

### Slack example

![](assets/images/screenshot-monitoring-release-updates.jpg)