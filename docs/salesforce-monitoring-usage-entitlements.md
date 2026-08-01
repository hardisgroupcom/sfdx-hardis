---
title: Usage-based entitlements (Salesforce monitoring)
description: Track Salesforce consumption meters and get warned before an allowance is overshot
---
<!-- markdownlint-disable MD013 -->

## Detect usage-based entitlements consumed too fast

Salesforce bills a growing part of its platform by consumption: Einstein Requests, Flex Credits, Data 360 credits, Salesforce Messaging, monthly API calls, Experience Cloud logins, storage add-ons. Those meters are listed in **Setup > Company Information > Usage-Based Entitlements**.

This is a different concern from [org limits](salesforce-monitoring-org-limits.md), which tracks the daily and hourly limits that throttle an org. Usage-based entitlements are what ends up on the invoice.

Watching a raw percentage is not enough. An entitlement at 60% consumption looks healthy, but if only 30% of the billing period has elapsed it is on track to reach 200% of the allowance. This command projects consumption to the end of the period and alerts on that projection.

- Success: projected consumption below 120%
- Warning: projected consumption above 120%
- Error: projected consumption above 150%

Flat consumption thresholds (50% warning, 75% error, same as org limits) act as a floor, so an almost exhausted allowance still alerts late in the period when the projection alone would stay quiet.

Sfdx-hardis command: [sf hardis:org:diagnose:usage-entitlements](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/usage-entitlements/)

Key: **USAGE_ENTITLEMENTS**

Consumption, projections and utilization alerts are all rendered on the **08 - Usage & Cost** dashboard of the [Grafana v2 dashboards](salesforce-monitoring-grafana-v2.md).

## Resources without consumption data

Salesforce reports no consumption for some entitlements, usually because the resource has never been metered on the org. Those rows appear in the CSV report with the status `not-metered`, are never used to raise a notification, and emit no metric. A missing value is never read as zero.

## Configuration

Thresholds can be set globally, and overridden per resource, in `.sfdx-hardis.yml`:

```yaml
usageEntitlements:
  projectionThresholdWarning: 120
  projectionThresholdError: 150
  resources:
    # Tighter alerting on Data 360 profiles
    - key: MaxCdpProfiles
      projectionThresholdWarning: 110
      projectionThresholdError: 130
    # Never alert on this one
    - key: MaxExtIdentityLogins
      mute: true
```

Resources are identified by the `Setting` value of the entitlement. Both the full value (`setting/force.com/orgValue.MaxCdpProfiles`) and its trailing token (`MaxCdpProfiles`) are accepted.

The same thresholds can be set with environment variables, which take precedence over the YAML file:

| Variable                             | Default | Description                                           |
|--------------------------------------|---------|-------------------------------------------------------|
| `USAGE_PROJECTION_THRESHOLD_WARNING` | 120     | Projected end-of-period consumption raising a warning |
| `USAGE_PROJECTION_THRESHOLD_ERROR`   | 150     | Projected end-of-period consumption raising an error  |
| `LIMIT_THRESHOLD_WARNING`            | 50      | Consumption percentage raising a warning              |
| `LIMIT_THRESHOLD_ERROR`              | 75      | Consumption percentage raising an error               |

## How the billing period is computed

Salesforce rarely populates an end date on an entitlement, so the current window is derived from the start date and the frequency (`Daily`, `Weekly`, `Fortnightly`, `Monthly`, `Quarterly`, `Yearly`). The window is rolled forward from the start date until it contains today, using calendar arithmetic for monthly, quarterly and yearly frequencies.

Entitlements with a frequency of `Once` are flat capacity rather than a recurring allowance. They have no period, so no projection is computed and only the consumption thresholds apply.

A projection needs a minimum of signal to be meaningful: it is only computed once at least 5% of the period has elapsed and at least 10% of the allowance is consumed. Without those guards a single unit consumed on day one of a monthly period would project to an absurd multiple.
