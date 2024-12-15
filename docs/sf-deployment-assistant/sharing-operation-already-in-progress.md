---
title: "sharing operation already in progress (Deployment assistant)"
description: "How to solve Salesforce deployment error \"sharing operation already in progress\""
---
<!-- markdownlint-disable MD013 -->
# sharing operation already in progress

## Detection

- String: `sharing operation already in progress`

## Resolution

```shell
You can not deploy multiple SharingRules at the same time. You can either:
- Remove SharingOwnerRules and SharingRule from package.xml (so it becomes a manual operation)
- Use sf hardis:work:save to generate a deploymentPlan in .sfdx-hardis.json,
- If you are trying to create a scratch org, add DeferSharingCalc in features in project-scratch-def.json

```
