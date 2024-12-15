---
title: "Unsupported sharing configuration (Deployment assistant)"
description: "How to solve Salesforce deployment error /not supported for (.*) since it's org wide default is"
---
<!-- markdownlint-disable MD013 -->
# Unsupported sharing configuration

## Detection

- RegExp: `not supported for (.*) since it's org wide default is`

## Resolution

```shell
Consistency error between {1} sharing settings and {1} object configuration
Please check https://salesforce.stackexchange.com/questions/260923/sfdx-deploying-contact-sharing-rules-on-a-fresh-deployment
If you already did that, please try again to run the job
```
