---
title: Underused Permission Sets (Salesforce monitoring)
description: Schedule weekly checks for permission sets and permission set groups with few or no users with sfdx-hardis Monitoring
---
<!-- markdownlint-disable MD013 -->

## Detect underused permission sets

Permission sets and Permission Set Groups with zero or few assigned users may be candidates for cleanup or consolidation. This command helps identify technical debt and supports permission hygiene.

**What it detects:**

- **0 users (error):** Permission sets and Permission Set Groups with no assignments at all
- **Low usage (warning):** Permission sets and groups assigned to `PERMSET_LIMITED_USERS_THRESHOLD` or fewer users (default: **5**)

**Scope:**

- **Permission Sets:** Custom only (`NamespacePrefix = null`, `LicenseId = null`), not profile-owned, not included in a Permission Set Group. PSL-linked and managed package permission sets are excluded.
- **Permission Set Groups:** Custom only (`NamespacePrefix = null`). Managed package groups are excluded.

**Configuration:**

| Environment variable               | Description                                                                                     | Default  |
|------------------------------------|-------------------------------------------------------------------------------------------------|----------|
| `PERMSET_LIMITED_USERS_THRESHOLD`  | Maximum number of users to consider a permission set "low usage"                                | `5`      |
| `UNDERUSED_PERMISSION_SETS_IGNORE` | Comma-separated list of permission set / group names to exclude from results (case-insensitive) | _(none)_ |

Sfdx-hardis command: [sf hardis:org:diagnose:underusedpermsets](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/underusedpermsets/)

Key: **UNDERUSED_PERMSETS**

### Grafana example

<!-- TODO: Add screenshot when available -->
<!-- ![](assets/images/screenshot-monitoring-underused-permsets-grafana.jpg) -->

### Slack example

<!-- TODO: Add screenshot when available -->
<!-- ![](assets/images/screenshot-monitoring-underused-permsets.jpg) -->
