---
title: Detect Apex classes and triggers with deprecated API version (Salesforce monitoring)
description: Schedule weekly checks for Apex classes and triggers deployed with deprecated API versions
---
<!-- markdownlint-disable MD013 -->

## Detect Apex classes and triggers with deprecated API version

Detects Apex classes and triggers deployed with API versions at or below a configurable threshold. This checks **Apex metadata** (the version code was compiled against), which is separate from [deprecated API calls](salesforce-monitoring-deprecated-api-calls.md) (SOAP, REST, Bulk API traffic).

Configure the threshold via `DEPRECATED_APEX_API_VERSION` env var (default: `50`) or `--threshold` flag.

Sfdx-hardis command: [sf hardis:org:diagnose:apex-api-version](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/apex-api-version/)

Key: **APEX_API_VERSION**
