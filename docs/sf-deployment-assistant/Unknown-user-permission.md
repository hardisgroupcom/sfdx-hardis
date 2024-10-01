---
title: Unknown user permission (Deployment assistant)
description: How to solve Salesforce deployment error Unknown user permission:
---
<!-- markdownlint-disable MD013 -->
# Unknown user permission

## Detection

- String: `Unknown user permission:`

## Resolution

```shell
You can:
- enable the related permission in the target org
- or remove references to the permission in source XML files (Probably a Profile or a Permission set)
```
