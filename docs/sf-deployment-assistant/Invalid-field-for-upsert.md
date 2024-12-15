---
title: "Invalid field for upsert (Deployment assistant)"
description: "How to solve Salesforce deployment error "/Error (.*) Invalid field for upsert, must be an External Id custom or standard indexed field: (.*) \((.*)\)""
---
<!-- markdownlint-disable MD013 -->
# Invalid field for upsert

## Detection

- RegExp: `Error (.*) Invalid field for upsert, must be an External Id custom or standard indexed field: (.*) \((.*)\)`

## Resolution

```shell
You tried to use field {2} for an upsert call in {1}.
- Is it declared as externalId ?
- Is the customIndex source file present in the deployment ?
- If it is declared as externalId and customIndex is present, you may have to go manually define the field as externalId in the target org

```
