---
title: Consumption utilization alerts (Salesforce monitoring)
description: Collect the consumption and license utilization alerts Salesforce raises on your org
---
<!-- markdownlint-disable MD013 -->

## Collect the utilization alerts Salesforce raises

Salesforce raises its own alerts when consumption of a billed product approaches or crosses a threshold, and when license usage nears its entitlement. They are the alerts shown in Digital Wallet.

Digital Wallet has no public API, so these alert records are the only way to read that information programmatically. This command collects them and routes them to your usual notification channels, next to every other monitoring indicator.

- Log: no active alert
- Warning: at least one active alert
- Error: at least one alert whose trigger value reached the full allowance

Sfdx-hardis command: [sf hardis:org:diagnose:consumption-alerts](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/consumption-alerts/)

Key: **CONSUMPTION_ALERTS**

## Relation to usage-based entitlements

This command and [usage-based entitlements](salesforce-monitoring-usage-entitlements.md) answer two different questions.

- Usage-based entitlements reads the raw meters and projects where consumption is heading. It warns you early, on your own thresholds.
- Consumption alerts reports what Salesforce already decided was worth flagging, including products that never appear as an entitlement row.

Running both gives you your own early warning plus Salesforce's official one.

## Orgs without utilization alerts

Not every org edition exposes utilization alerts. When the object is unavailable, the command logs the reason, sends no notification and exits successfully, so scheduling it across a whole fleet is safe.
