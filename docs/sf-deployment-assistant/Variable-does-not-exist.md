---
title: : Variable does not exist (Deployment assistant)
description: How to solve Salesforce deployment error /Error (.*) Variable does not exist: (.*) \((.*)\)/gm
---
<!-- markdownlint-disable MD013 -->
# Variable does not exist

## Detection

- RegExp: `Error (.*) Variable does not exist: (.*) \((.*)\)`

## Resolution

```shell
Apex error in {1} with unknown variable {2} at position {3}. If {2} is a class name, try to fix it, or maybe it is missing in the files or in package.xml !
```
