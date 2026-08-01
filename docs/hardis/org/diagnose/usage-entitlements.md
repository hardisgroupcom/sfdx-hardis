<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:usage-entitlements

## Description


## Command Behavior

**Monitors Salesforce usage-based entitlements and warns when consumption is on track to exceed the allowance before the period ends.**

Usage-based entitlements are the consumption meters Salesforce bills on: Einstein Requests, Flex Credits, Data 360 credits, Salesforce Messaging, monthly API calls, Experience Cloud logins, storage add-ons, and whatever else the org purchased. They are visible in Setup > Company Information > Usage-Based Entitlements. This is a different concern from `sf hardis:org:monitor:limits`, which tracks daily and hourly throttling limits.

Key functionalities:

- **Entitlement Retrieval:** Queries every usage-based entitlement declared on the org.
- **Period Derivation:** Salesforce rarely populates an end date, so the current billing window is derived from the entitlement start date and its frequency (daily, weekly, fortnightly, monthly, quarterly, yearly).
- **Consumption Projection:** Compares the share of the allowance consumed against the share of the period elapsed, and projects consumption at period end. A resource at 60% consumption when only 30% of the period has passed projects to 200%, and is flagged even though a flat percentage rule would stay silent.
- **Threshold-Based Alerting:** Warns above 120% projected consumption and errors above 150%, both configurable. Flat consumption thresholds act as a floor so a nearly exhausted allowance still alerts late in the period.
- **Per-Resource Configuration:** Thresholds can be tightened, loosened or muted per resource in `.sfdx-hardis.yml`.
- **CSV Report Generation:** Produces a report with consumption, allowance, period boundaries, elapsed share, projection and severity for every entitlement.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams) summarizing entitlements at risk.

Resources for which Salesforce reports no consumption data are listed in the report but never alert, and never emit metrics.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-usage-entitlements/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Query:** Reads `TenantUsageEntitlement`. The query deliberately omits `ORDER BY`: `MasterLabel` is neither sortable nor filterable and Salesforce rejects such queries. Sorting happens client-side once projections are computed.
- **Resource Identity:** `ResourceGroupKey` is the constant `(tenant)` on every row and cannot identify a resource, so the `Setting` field (for example `setting/force.com/orgValue.MaxCdpProfiles`) is used as the stable key. Its trailing token is accepted as a shorthand in configuration.
- **Period Arithmetic:** Windows are rolled forward from `StartDate` in UTC using calendar-month arithmetic for monthly, quarterly and yearly frequencies, with clamping to the last day of shorter months.
- **Projection Guards:** A projection is only computed once at least 5% of the period has elapsed and at least 10% of the allowance is consumed, so early-period noise cannot raise false alarms.
- **Configuration Resolution:** Reads the `usageEntitlements` block via `getConfig`, then lets `USAGE_PROJECTION_THRESHOLD_WARNING`, `USAGE_PROJECTION_THRESHOLD_ERROR`, `LIMIT_THRESHOLD_WARNING` and `LIMIT_THRESHOLD_ERROR` environment variables override it.
- **Metrics:** Emits per-resource consumption and projection metrics prefixed with `UsageEnt_`, plus counts of entitlements at risk, metered and total.
- **Exit Code Management:** Sets the process exit code to 1 when any entitlement is in an error state.
</details>


### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:diagnose:usage-entitlements --agent --target-org myorg@example.com
```

In agent mode, the command runs fully automatically with no interactive prompts.

## Parameters

| Name              |  Type   | Description                                                                                   | Default | Required | Options |
|:------------------|:-------:|:----------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation. Uses default values and skips prompts. |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                               |         |          |         |
| flags-dir         | option  | undefined                                                                                     |         |          |         |
| json              | boolean | Format output as json.                                                                        |         |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv                             |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                 |         |          |         |
| target-org<br/>-o | option  | undefined                                                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                     |         |          |         |

## Examples

```shell
$ sf hardis:org:diagnose:usage-entitlements
```

```shell
$ sf hardis:org:diagnose:usage-entitlements --agent
```


