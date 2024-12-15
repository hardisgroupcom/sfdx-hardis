---
title: "Custom metadata entry not found (Deployment assistant)"
description: "How to solve Salesforce deployment error "Error (.*) In field: (.*) - no CustomMetadata named (.*) found""
---
<!-- markdownlint-disable MD013 -->
# Custom metadata entry not found

## Detection

- RegExp: `Error (.*) In field: (.*) - no CustomMetadata named (.*) found`

## Resolution

```shell
A reference to a custom metadata {3} of type {2} is not found in {1}:
- Are you sure you deployed {3} ?
- If you use a package.xml, is {3} present within type CustomMetadata ?

```
