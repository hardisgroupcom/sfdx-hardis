---
title: Underused Permission Sets (Salesforce monitoring)
description: Schedule weekly checks for permission sets with few or no users
---
<!-- markdownlint-disable MD013 -->

## Detect underused permission sets

Permission sets with zero or few users may be candidates for cleanup or consolidation. This command helps identify technical debt and supports permission set hygiene.

**What it detects:**

- **0 users:** Permission sets with no direct assignments and not in any Permission Set Group
- **Low usage:** Permission sets assigned to 5 or fewer users (configurable via `PERMSET_LIMITED_USERS_THRESHOLD`)

Only custom permission sets (NamespacePrefix = null) that are not owned by profiles are included. Permission sets in Permission Set Groups are excluded, since users receive those via group assignment.

Sfdx-hardis command: [sf hardis:org:diagnose:underusedpermsets](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/underusedpermsets/)

Key: **UNDERUSED_PERMSETS**

### Grafana example

<!-- TODO: Add screenshot when available -->
<!-- ![](assets/images/screenshot-monitoring-underused-permsets-grafana.jpg) -->

### Slack example

<!-- TODO: Add screenshot when available -->
<!-- ![](assets/images/screenshot-monitoring-underused-permsets.jpg) -->
