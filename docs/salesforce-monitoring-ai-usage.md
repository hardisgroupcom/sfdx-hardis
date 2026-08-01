---
title: Agentforce and Data 360 credit usage (Salesforce monitoring)
description: Break down Agentforce and Data 360 credit consumption by agent and action
---
<!-- markdownlint-disable MD013 -->

## Track where your credits go

Agentforce actions and Data 360 operations are billed in Flex Credits. A single misbehaving agent, or one action called far more often than expected, can burn a large share of a credit pool before anyone notices.

This command reads the consumption models Salesforce publishes in Data 360 and reports credits consumed and event counts per agent, per action, and per usage type, splitting metered from unmetered usage.

**Only metered usage is charged.** Standard generative AI features and Prompt Builder templates covered by an Agentforce add-on run unmetered, and on a real org they are usually the bulk of consumption. The command therefore leads with billed credits and reports the total alongside, so the headline figure matches what actually lands on the invoice.

Sfdx-hardis command: [sf hardis:org:diagnose:ai-usage](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/ai-usage/)

Key: **AI_USAGE**

## Requirements

This command needs **Data 360 (Data Cloud)** with an Agentforce or Data 360 consumption model provisioned. Those models ship with a paid Agentforce or Data 360 subscription: enabling Data Cloud alone is not enough.

On any org that does not meet those requirements the command logs why it cannot run, sends no notification, and exits successfully. Scheduling it across a whole fleet is safe: orgs without the models simply do nothing.

## Configuration

By default the command reports the last 30 days. Use `--days` to change the window.

Set `AI_USAGE_CREDITS_THRESHOLD` to raise a warning when total credit consumption over the window exceeds a value. Without it the command reports consumption without alerting.

Credit totals come from their own aggregate query, so they stay exact even on orgs with more agent and action combinations than the detail listing shows. When the listing is capped, the command says so.

## Estimated cost

Declare a credit price and the command reports billed credits in money as well:

```yaml
usageCost:
  currency: EUR
  flexCredits:
    unitPrice: 0.005
```

Salesforce publishes no prices through any API, so this rate comes from your contract and the figure is an estimate. It is applied to **billed** credits only, never to unmetered usage.

Flex Credits tier down with volume (to 80%, then 40%, then 20% of the base rate), so a flat rate is an **upper bound**: the real charge is at most the reported figure. Erring high is deliberate, since an estimate that understates spend would be worse than none.

Cost is reporting only and never influences severity.

```sh
sf hardis:org:diagnose:ai-usage --days 7
```

## Relation to usage-based entitlements

[Usage-based entitlements](salesforce-monitoring-usage-entitlements.md) tells you how much of your credit allowance is left and whether you are on track to exceed it. This command tells you which agent and which action consumed it.

Use the first to know that you have a problem, and this one to know what to fix.
