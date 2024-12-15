---
title: "Can not change field type to a formula field (Deployment assistant)"
description: "How to solve Salesforce deployment error /Error (.*) Cannot update a field from a Formula to something else/gm"
---
<!-- markdownlint-disable MD013 -->
# Can not change field type to a formula field

## Detection

- RegExp: `Error (.*) Cannot update a field from a Formula to something else`

## Resolution

```shell
You need to manually delete or rename the field in the target org to allow the deployment to pass
- First, try to manually delete field {1} in the target org
- if you can't delete {1}, rename it into {1}_ToDel, then once the deployment done, delete {1}_ToDel
```
