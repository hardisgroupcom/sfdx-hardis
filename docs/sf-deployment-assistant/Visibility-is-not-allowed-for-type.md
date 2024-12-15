---
title: "Visibility is not allowed for type (Deployment assistant)"
description: "How to solve Salesforce deployment error "/Error (.*) set the visibility for a (.*) to Protected unless you are in a developer""
---
<!-- markdownlint-disable MD013 -->
# Visibility is not allowed for type

## Detection

- RegExp: `Error (.*) set the visibility for a (.*) to Protected unless you are in a developer`

## Resolution

```shell
Update the visibility of {1} to "Public"
```
