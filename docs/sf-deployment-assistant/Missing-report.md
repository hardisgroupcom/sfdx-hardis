---
title: "Missing report (Deployment assistant)"
description: "How to solve Salesforce deployment error "/Error (.*) The (.*) report chart has a problem with the "reportName" field""
---
<!-- markdownlint-disable MD013 -->
# Missing report

## Detection

- RegExp: `Error (.*) The (.*) report chart has a problem with the "reportName" field`

## Resolution

```shell
{1} is referring to unknown report {2}. To retrieve it, you can run:
- sf project retrieve start -m Report:{2} -o YOUR_ORG_USERNAME
- If it fails, looks for the report folder and add it before report name to the retrieve command (ex: MYFOLDER/MYREPORTNAME)

```
