---
title: "Empty source items (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Required field is missing: sharingOwnerRules\""
---
<!-- markdownlint-disable MD013 -->
# Empty source items

## Detection

- String: `Required field is missing: sharingOwnerRules`
- String: `Required field is missing: standardValue`
- String: `Required field is missing: valueTranslation`

## Resolution

```shell
You probably retrieved empty items, that must not be included within the SFDX project
To remove them, please run sfdx:hardis:project:clean:emptyitems
```
