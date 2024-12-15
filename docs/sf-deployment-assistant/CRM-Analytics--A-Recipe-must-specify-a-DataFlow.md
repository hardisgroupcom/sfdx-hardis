---
title: "CRM Analytics: A Recipe must specify a DataFlow (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Error (.*) A Recipe must specify a Dataflow\""
---
<!-- markdownlint-disable MD013 -->
# CRM Analytics: A Recipe must specify a DataFlow

## Detection

- RegExp: `Error (.*) A Recipe must specify a Dataflow`

## Resolution

```shell
You must include related WaveDataFlow {1} in sources (and probably in package.xml too).
To retrieve it, run: sf project retrieve start -m WaveDataFlow:{1} -u SOURCE_ORG_USERNAME
You can also retrieve all analytics sources in one shot using sf hardis:org:retrieve:source:analytics -u SOURCE_ORG_USERNAME
  - https://salesforce.stackexchange.com/a/365453/33522
  - https://help.salesforce.com/s/articleView?id=000319274&type=1
```
