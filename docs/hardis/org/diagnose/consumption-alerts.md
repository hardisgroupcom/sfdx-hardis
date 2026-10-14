<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:consumption-alerts

## Description


## Command Behavior

**Reports the consumption and license utilization alerts that Salesforce itself raised on the org.**

Salesforce raises utilization alerts when consumption of a billed product approaches or crosses a threshold, and when license usage nears its entitlement. These are the same alerts surfaced in Digital Wallet. Because Digital Wallet has no public API, this object is the only programmatic way to read them.

Key functionalities:

- **Active Alert Retrieval:** Lists every alert currently in an active state, most recent first.
- **Grouping by Consumption Card:** Salesforce raises one alert per threshold crossed and leaves the earlier ones active, so a card past 75% appears as three records (25%, 50%, 75%). Alerts are grouped by card and reported at the highest threshold reached, so the count reflects cards in trouble rather than thresholds crossed.
- **Severity Assignment:** Any card in alert raises a warning, a card past 75% raises an error, and a card at its full allowance raises a critical.
- **CSV Report Generation:** Produces a report with the alert type, scope, trigger value, trigger type and timestamp.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams) summarizing the active alerts.

Orgs whose edition does not expose utilization alerts are skipped silently, so the monitoring run never fails because of them.

This command complements `sf hardis:org:diagnose:usage-entitlements`: that command projects consumption from raw meters, while this one reports what Salesforce already decided was worth flagging.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-consumption-alerts/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Query:** Reads `TenantConsumptionAlert` (labelled "Utilization Alert") filtered on active alerts and ordered by alert timestamp descending.
- **Graceful Degradation:** Catches the unsupported-object error so orgs without the object skip with a log-level message and exit code 0, rather than failing the monitoring run.
- **Severity Rule:** Alerts with a trigger value at or above 100 are treated as a breach of the full allowance and raise an error; any other active alert raises a warning.
- **Metrics:** Emits counts of active and critical alerts.
- **Exit Code Management:** Sets the process exit code to 1 when at least one alert is in an error state.
</details>


### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:diagnose:consumption-alerts --agent --target-org myorg@example.com
```

In agent mode, the command runs fully automatically with no interactive prompts.

## Parameters

| Name              |  Type   | Description                                                                                                  | Default | Required | Options |
|:------------------|:-------:|:-------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation. Uses default values and skips prompts.                |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                              |         |          |         |
| flags-dir         | option  | Import flag values from a directory.                                                                         |         |          |         |
| json              | boolean | Format output as json.                                                                                       |         |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv                                            |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                |         |          |         |
| target-org<br/>-o | option  | Username or alias of the target org. Not required if the `target-org` configuration variable is already set. |         |   true   |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                    |         |          |         |

## Examples

```shell
$ sf hardis:org:diagnose:consumption-alerts
```

```shell
$ sf hardis:org:diagnose:consumption-alerts --agent
```


