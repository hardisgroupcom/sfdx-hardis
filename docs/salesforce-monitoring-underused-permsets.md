---
title: Underused Permission Sets (Salesforce monitoring)
description: Schedule weekly checks for permission sets with few or no users
---
<!-- markdownlint-disable MD013 -->

## Detect underused permission sets

Permission sets with zero or few users may be candidates for cleanup or consolidation. This command helps identify technical debt and supports permission set hygiene.

**What it detects:**

- **0 users:** Permission sets and Permission Set Groups with no assignments
- **Low usage:** Permission sets and groups assigned to 5 or fewer users (configurable via `PERMSET_LIMITED_USERS_THRESHOLD`)

**Permission Sets:** Custom only (NamespacePrefix = null, LicenseId = null), not profile-owned, not in groups. PSL-linked and managed package permission sets are excluded.

**Permission Set Groups:** Custom only (NamespacePrefix = null). Managed package groups are excluded.

Sfdx-hardis command: [sf hardis:org:diagnose:underusedpermsets](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/underusedpermsets/)

Key: **UNDERUSED_PERMSETS**

### Grafana example

<!-- TODO: Add screenshot when available -->
<!-- ![](assets/images/screenshot-monitoring-underused-permsets-grafana.jpg) -->

### Slack example

<!-- TODO: Add screenshot when available -->
<!-- ![](assets/images/screenshot-monitoring-underused-permsets.jpg) -->
