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
- Warning: projected consumption above 120%, or more than 50% of the allowance consumed
- Error: projected consumption above 150%, or more than 75% consumed
- **Critical: more than 100% consumed**

The critical level is deliberately separate. Everything below it is a forecast; above it the paid allowance is already spent and overage is accruing right now. Real orgs sit there routinely, so the notification reports the two groups separately rather than merging them into one count.

Flat consumption thresholds act as a floor, so an almost exhausted allowance still alerts late in the period when the projection alone would stay quiet.

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

## Estimated cost

Consumption percentages tell you something is wrong; a euro figure tells you how much it matters. The command can turn overage into money, but the rates have to come from you.

**Salesforce publishes no prices through any API.** `TenantUsageEntitlement` carries quantities and no rates, and your contracted prices live in your order form. Every cost reported here is therefore an **estimate computed from rates you declare**, not an invoice.

```yaml
usageCost:
  currency: EUR
  resources:
    - key: MaxCustomerNetworkLogins
      unitPrice: 0.12
      model: overage
    - key: MaxRegularNetworkMembers
      unitPrice: 2.5
```

`model: overage` (the default) charges only the units consumed beyond the allowance, which is how prepaid allowances usually work. `model: total` charges every unit consumed, for pay-as-you-go resources.

Rates are opt-in per resource on purpose. Plenty of entitlements are hard caps rather than meters ("B2B Commerce Total Storefronts: 2 of 5"), and applying a blanket rate to those would invent charges that do not exist. A resource with no rate reports **no cost at all**, which is deliberately different from a cost of zero.

With the example above, an org consuming 828 Customer Community Logins against an allowance of 600 reports 228 units of overage at 0.12, so `27.36 EUR`.

Cost is **reporting only**. Severity keeps coming from consumption and projection percentages, so a stale rate can never invent an alert or silence a real one.

## How the billing period is computed

The current window is derived from the entitlement start date and its frequency (`Daily`, `Weekly`, `Fortnightly`, `Monthly`, `Quarterly`, `Yearly`), rolled forward until it contains today, using calendar arithmetic for monthly, quarterly and yearly frequencies.

The end date on an entitlement is the **contract expiry, not the end of the current billing window**. Orgs routinely carry a `Daily` allowance with an end date three years out, or a `Monthly` one running until the contract renews. It is therefore used only as an upper bound: a contract ending partway through a cycle shortens that cycle, and an expired contract produces no window at all.

Entitlements with a frequency of `Once` are flat capacity rather than a recurring allowance. They have no period, so no projection is computed and only the consumption thresholds apply.

A projection needs a minimum of signal to be meaningful: it is only computed once at least 5% of the period has elapsed and at least 10% of the allowance is consumed. Without those guards a single unit consumed on day one of a monthly period would project to an absurd multiple.
