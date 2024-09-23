---
title: : Invalid report type (Deployment assistant)
description: How to solve Salesforce deployment error /Error (.*) invalid report type/gm
---
<!-- markdownlint-disable MD013 -->
# Invalid report type

## Detection

- RegExp: `Error (.*) invalid report type`

## Resolution

```shell
Report type is missing for report {1}
- Open report {1} to se what report type is used
- Retrieve the report type from an org and add it to the sfdx sources
```
