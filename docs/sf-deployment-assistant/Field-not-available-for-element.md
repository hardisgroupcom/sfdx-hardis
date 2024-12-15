---
title: "Field not available for element (Deployment assistant)"
description: "How to solve Salesforce deployment error /Field (.*) is not available for/gm"
---
<!-- markdownlint-disable MD013 -->
# Field not available for element

## Detection

- RegExp: `Field (.*) is not available for`

## Resolution

```shell
You probably changed the type of field {1}.
Find field {1} in the source XML, and remove the section using it
```
