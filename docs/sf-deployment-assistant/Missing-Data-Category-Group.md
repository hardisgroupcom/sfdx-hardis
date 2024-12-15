---
title: "Missing Data Category Group (Deployment assistant)"
description: "How to solve Salesforce deployment error "/Error (.*) In field: DeveloperName - no DataCategoryGroup named (.*) found""
---
<!-- markdownlint-disable MD013 -->
# Missing Data Category Group

## Detection

- RegExp: `Error (.*) In field: DeveloperName - no DataCategoryGroup named (.*) found`

## Resolution

```shell
If Data Category Group {2} is not existing yet in target org, you might need to:
- create it manually in target org before deployment
- comment DataCategoryGroup in {1} XML

```
