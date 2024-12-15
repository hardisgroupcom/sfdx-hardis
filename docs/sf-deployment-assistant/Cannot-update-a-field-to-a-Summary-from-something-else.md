---
title: "Cannot update a field to a Summary from something else (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Error (.*) Cannot update a field to a (.*) from something else\""
---
<!-- markdownlint-disable MD013 -->
# Cannot update a field to a Summary from something else

## Detection

- RegExp: `Error (.*) Cannot update a field to a (.*) from something else`

## Resolution

```shell
You probably updated the type of field {1} to type {2}, and Salesforce does not allows that with deployments. You can:
- Try to manually change the type of {1} directly in target org, but it may not be technically possible
- Delete field {1} in target org: it will be recreated after deployment (but you will loose data on existing records, so be careful if your target is a production org)
- Create another field with desired type and manage data recovery if the target is a production org
```
