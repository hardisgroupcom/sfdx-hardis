---
title: "Change Matching Rule (Deployment assistant)"
description: "How to solve Salesforce deployment error "/Error (.*) Before you change a matching rule, you must deactivate it""
---
<!-- markdownlint-disable MD013 -->
# Change Matching Rule

## Detection

- RegExp: `Error (.*) Before you change a matching rule, you must deactivate it`

## Resolution

```shell
To be able to deploy, you must go in target org setup to manually deactivate matching rule {1}
```
