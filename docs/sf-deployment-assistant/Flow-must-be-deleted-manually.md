---
title: "Flow must be deleted manually (Deployment assistant)"
description: "How to solve Salesforce deployment error /.flow (.*) insufficient access rights on cross-reference id"
---
<!-- markdownlint-disable MD013 -->
# Flow must be deleted manually

## Detection

- RegExp: `.flow (.*) insufficient access rights on cross-reference id`

## Resolution

```shell
Flow {1} can not be deleted using deployments, please delete it manually in the target org using menu Setup -> Flows , context menu on {1} -> View details and versions -> Deactivate all versions -> Delete flow
```
