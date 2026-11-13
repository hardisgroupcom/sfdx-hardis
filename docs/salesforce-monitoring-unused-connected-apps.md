---
title: Detect unused Connected Apps (Salesforce monitoring)
description: With sfdx-hardis, schedule weekly checks of Connected Apps that are not used anymore, but still accessible
---
<!-- markdownlint-disable MD013 -->

## Detect unused Connected Apps

Lists all Connected Apps that might not be used anymore.

You can disable or even delete them to reduce technical debt and avoid security risks.

Sfdx-hardis command: [sf hardis:org:diagnose:unused-connected-apps](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unused-connected-apps/)

Key: **CONNECTED_APPS**

### Settings

| Environment variable | Description | Default |
|---|---|---|
| UNUSED_CONNECTED_APPS_DAYS | A Connected App whose last OAuth token use is older than this number of days is reported (ex: 30, 90 or 365) | 180 |
| ALLOWED_INACTIVE_CONNECTED_APPS | Comma-separated names of Connected Apps that are never reported | |

### Grafana example

TODO

### Slack example

TODO