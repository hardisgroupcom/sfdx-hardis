---
title: "Duplicate value Platform Action Id List (Deployment assistant)"
description: "How to solve Salesforce deployment error "duplicate value found: PlatformActionListId duplicates value on record with id""
---
<!-- markdownlint-disable MD013 -->
# Duplicate value Platform Action Id List

## Detection

- String: `duplicate value found: PlatformActionListId duplicates value on record with id`

## Resolution

```shell
There are probably issue with conflict management. Open the XML of the source item, and replace all <sortOrder> numbers to make an ascending order, starting with 0
```
