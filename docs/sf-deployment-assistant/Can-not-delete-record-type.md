---
title: : Can not delete record type (Deployment assistant)
description: How to solve Salesforce deployment error /Error (.*) Cannot delete record type through API/gm
---
<!-- markdownlint-disable MD013 -->
# Can not delete record type

## Detection

- RegExp: `Error (.*) Cannot delete record type through API`

## Resolution

```shell
You need to manually delete record type {1} in target org
- Edit record type {1}, uncheck "Active"
- Delete record type {1}
```
