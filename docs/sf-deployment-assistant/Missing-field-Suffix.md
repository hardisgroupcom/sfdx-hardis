---
title: "Missing field Suffix (Deployment assistant)"
description: "How to solve Salesforce deployment error field Suffix"
---
<!-- markdownlint-disable MD013 -->
# Missing field Suffix

## Detection

- String: `field Suffix`

## Resolution

```shell
Suffix must be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=000332623&type=1&mode=1
- Scratch org setting:
"nameSettings": {
  "enableNameSuffix": true
},
```
