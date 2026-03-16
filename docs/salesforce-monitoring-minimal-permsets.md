---
title: Detect permission sets with minimal permissions (Salesforce monitoring)
description: Schedule weekly checks for permission sets in the project with very few permissions
---
<!-- markdownlint-disable MD013 -->

## Detect permission sets with minimal permissions

Analyzes permission set metadata files in the sfdx project to identify permission sets with very few permissions (5 or fewer by default). These "minimal" permission sets may be candidates for consolidation to reduce org complexity and improve maintainability.

Permission counting excludes metadata-only elements: label, description, hasActivationRequired, license, custom. All other elements (objectPermissions, userPermissions, fieldPermissions, etc.) are counted as permission-granting.

Sfdx-hardis command: [sf hardis:org:diagnose:minimalpermsets](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/minimalpermsets/)

Key: **MINIMAL_PERMSETS**

### Environment variables

| Variable                   | Description                                              | Default |
|:---------------------------|:---------------------------------------------------------|:--------|
| **MINIMAL_PERMSETS_THRESHOLD** | Max permissions for a permission set to be "minimal" | `5`     |
