---
title: "Invalid type (Deployment assistant)"
description: "How to solve Salesforce deployment error /Error (.*) Invalid type: (.*) \((.*)\)/gm"
---
<!-- markdownlint-disable MD013 -->
# Invalid type

## Detection

- RegExp: `Error (.*) Invalid type: (.*) \((.*)\)`

## Resolution

```shell
Apex error in {1} with unknown type {2} at position {3}. If {2} is a class name, try to fix it, or maybe it is missing in the files or in package.xml !
```
