---
title: : Insufficient access rights on cross-reference id (Deployment assistant)
description: How to solve Salesforce deployment error /Error (.*) insufficient access rights on cross-reference id/gm
---
<!-- markdownlint-disable MD013 -->
# Insufficient access rights on cross-reference id

## Detection

- RegExp: `Error (.*) insufficient access rights on cross-reference id`

## Resolution

```shell
- If {1} is a Flow, it can not be deleted using deployments, please delete it manually in the target org using menu Setup -> Flows , context menu on {1} -> View details and versions -> Deactivate all versions -> Delete flow
- If you changed a custom field from unique to not unique, you need to manually make the change in the target org
```
