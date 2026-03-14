<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:monitor:health-check

## Description


## Command Behavior

**Retrieves the Salesforce Security Health Check score together with every risk indicator, then exports the dataset for monitoring dashboards.**

Key functionalities:

- **Score Retrieval:** Queries the Tooling API [SecurityHealthCheck](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_securityhealthcheck.htm) object to capture the org score.
- **Risk Indicators:** Fetches all [SecurityHealthCheckRisks](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_securityhealthcheckrisks.htm) entries (high, medium, informational, meets standard) to highlight deviations from the Salesforce baseline.
- **Excel-Ready Report:** Builds a CSV/XLSX file that mixes the global score, risk counts, and the detailed indicator list so the data can be consumed in monitoring branches.
- **Grafana / Chat Notifications:** Sends results (score metric, sample risks, XLSX attachment) through the `NotifProvider` so Grafana, Slack, MS Teams, Email, or API endpoints can react automatically.
- **Customizable Thresholds:** Env vars `HEALTH_CHECK_THRESHOLD_WARNING` (default 80) and `HEALTH_CHECK_THRESHOLD_ERROR` (default 60) control when the score escalates to warning or error.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.

### Excel report example

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-monitoring-health-check-excel.jpg)

### Grafana example

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-monitoring-health-check-grafana.jpg)

### Slack example

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-monitoring-health-check-slack.jpg)

<details markdown="1">
<summary>Technical explanations</summary>

- **Tooling API usage:** Executes `SELECT Id, DurableId, CustomBaselineId, Score, CreatedDate FROM SecurityHealthCheck ORDER BY CreatedDate DESC LIMIT 1` to locate the latest score, then fetches all `SecurityHealthCheckRisks` via the associated Id.
- **Data shaping:** Normalizes every risk with labels, categories, org/baseline values, and severity icons so that Grafana-friendly metrics and Excel exports are straightforward.
- **Notifications:** Relies on `NotifProvider` to broadcast the score metric, top risky settings, and the XLSX attachment. Grafana pipelines reuse `data.metric` (score) and `metrics` (risk counters) fields.
- **Exit codes:** Sets `process.exitCode = 1` whenever an error severity is detected to help CI pipelines fail fast when the security score drops below expectations.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|outputfile<br/>-f|option|Force the path and name of output report file. Must end with .csv||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:org:monitor:health-check
```


