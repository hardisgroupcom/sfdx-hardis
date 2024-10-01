---
title: Error parsing file (Deployment assistant)
description: How to solve Salesforce deployment error /Error (.*) Error parsing file: (.*)/gm
---
<!-- markdownlint-disable MD013 -->
# Error parsing file

## Detection

- RegExp: `Error (.*) Error parsing file: (.*)`

## Resolution

```shell
There has been an error parsing the XML file of {1}: {2}
- Open file {1} and look where the error can be ! (merge issue, typo, XML tag not closed...)
```
