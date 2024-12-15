---
title: "Condition missing reference (Deployment assistant)"
description: "How to solve Salesforce deployment error /Error (.*) field integrity exception: unknown \(A condition has a reference to (.*), which doesn't exist.\)"
---
<!-- markdownlint-disable MD013 -->
# Condition missing reference

## Detection

- RegExp: `Error (.*) field integrity exception: unknown \(A condition has a reference to (.*), which doesn't exist.\)`

## Resolution

```shell
There is a reference to {2} in {1}, and {2} is not found. You can either:
- Add {2} in your deployment sources and make sure it is named in package.xml
- Remove the reference to {2} in {1}

```
