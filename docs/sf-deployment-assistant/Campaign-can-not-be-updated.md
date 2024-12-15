---
title: "Campaign can not be updated (Deployment assistant)"
description: "How to solve Salesforce deployment error "The object "Campaign" can't be updated""
---
<!-- markdownlint-disable MD013 -->
# Campaign can not be updated

## Detection

- String: `The object "Campaign" can't be updated`

## Resolution

```shell
Add "MarketingUser" in project-scratch-def.json features
If it is already done, you may manually check "MarketingUser" field on the scratch org user
```
