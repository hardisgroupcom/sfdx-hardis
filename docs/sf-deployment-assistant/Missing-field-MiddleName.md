---
title: : Missing field MiddleName (Deployment assistant)
description: How to solve Salesforce deployment error field MiddleName
---
<!-- markdownlint-disable MD013 -->
# Missing field MiddleName

## Detection

- String: `field MiddleName`
- String: `Variable does not exist: MiddleName`

## Resolution

```shell
MiddleNames must be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=000332623&type=1&mode=1
- Scratch org setting:
"nameSettings": {
  "enableMiddleName": true
}
```
