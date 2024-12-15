---
title: "Can not change field type with picklist (Deployment assistant)"
description: "How to solve Salesforce deployment error /Error (.*) Cannot change which global value set this picklist uses/gm"
---
<!-- markdownlint-disable MD013 -->
# Can not change field type with picklist

## Detection

- RegExp: `Error (.*) Cannot change which global value set this picklist uses`

## Resolution

```shell
You probably updated the type of field {1}, and Salesforce does not allows that with deployments. You can:
- Try to manually change the type of {1} directly in target org, but it may not be technically possible
- Delete field {1} in target org: it will be recreated after deployment (but you will loose data on existing records, so be careful if your target is a production org)
- Create another field with desired type and manage data recovery if the target is a production org
```
