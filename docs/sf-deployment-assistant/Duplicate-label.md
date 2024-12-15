---
title: "Duplicate label (Deployment assistant)"
description: "How to solve Salesforce deployment error /Error (.*) Duplicate label: (.*)"
---
<!-- markdownlint-disable MD013 -->
# Duplicate label

## Detection

- RegExp: `Error (.*) Duplicate label: (.*)`

## Resolution

```shell
You probably renamed the picklist API name for {2}. Please update manually the picklist {1} in the target org to avoid to have a duplicate label
```
