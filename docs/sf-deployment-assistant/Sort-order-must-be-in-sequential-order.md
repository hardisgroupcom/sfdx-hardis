---
title: "Sort order must be in sequential order (Deployment assistant)"
description: "How to solve Salesforce deployment error "Error (.*) SortOrder must be in sequential order from""
---
<!-- markdownlint-disable MD013 -->
# Sort order must be in sequential order

## Detection

- RegExp: `Error (.*) SortOrder must be in sequential order from`

## Resolution

```shell
You probably have a default DuplicateRule in the target org. Retrieve it from target org, or delete it manually in target org, so you can deploy.
Ref: https://developer.salesforce.com/forums/?id=9060G000000I6SoQAK
```
