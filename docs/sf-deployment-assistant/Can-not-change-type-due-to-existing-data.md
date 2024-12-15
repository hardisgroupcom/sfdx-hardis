---
title: "Can not change type due to existing data (Deployment assistant)"
description: "How to solve Salesforce deployment error "/Error (.*) Cannot change type due to existing data""
---
<!-- markdownlint-disable MD013 -->
# Can not change type due to existing data

## Detection

- RegExp: `Error (.*) Cannot change type due to existing data`

## Resolution

```shell
It is usually not recommended to change types of fields, but if it's really necessary you can:
- Manually change the type of {1} in the target org
- If you can't manually change the type:
  - you may modify the dependencies (Formulas, Flows...) using {1}, so they don't use this field
  - you can also delete dependencies (Formulas, Flows...) using {1}, but make sure they are deployed again later
- More help: https://help.salesforce.com/s/articleView?id=000327186&type=1
```
