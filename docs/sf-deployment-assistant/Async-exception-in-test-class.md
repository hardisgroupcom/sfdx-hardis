---
title: "Async exception in test class (Deployment assistant)"
description: "How to solve Salesforce deployment error \"/System.AsyncException: (.*) Apex\""
---
<!-- markdownlint-disable MD013 -->
# Async exception in test class

## Detection

- RegExp: `System.AsyncException: (.*) Apex`

## Resolution

```shell
This may be a test class implementation issue in {1}.
Please check https://developer.salesforce.com/forums/?id=9060G0000005kVLQAY
```
