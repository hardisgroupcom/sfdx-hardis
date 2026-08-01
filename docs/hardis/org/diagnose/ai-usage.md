<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:ai-usage

## Description


## Command Behavior

**Breaks down Agentforce and Data 360 credit consumption by agent and action.**

Agentforce actions and Data 360 operations are billed in Flex Credits. This command reads the consumption models Salesforce publishes in Data 360 and reports where the credits went, so a runaway agent or an expensive action shows up before the invoice does.

Key functionalities:

- **Consumption Breakdown:** Aggregates credits consumed and event counts per agent, action, usage type and metered flag.
- **Data 360 Credits:** Reports Data 360 credit consumption alongside Agentforce usage.
- **Date Windowing:** Restricts the analysis to a recent period, 30 days by default.
- **CSV Report Generation:** Produces a report of the aggregated consumption rows.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams) with the credit totals and the top consumers.

**This command requires Data 360 (Data Cloud) with an Agentforce or Data 360 consumption model provisioned.** On any other org it logs why it cannot run, sends no notification, and exits successfully, so it is safe to schedule across a whole fleet.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-ai-usage/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Availability Probe:** Lists Data 360 data model objects before querying anything. Two distinct skip paths are handled: Data Cloud not provisioned on the org, and Data Cloud provisioned without any consumption model. Neither is treated as a failure.
- **Model Discovery:** Consumption model names ship with a paid SKU and are not hardcoded. Known names are matched against the live listing first, then a name pattern is used as a fallback so a Salesforce rename does not silently break the command.
- **Column Discovery:** Columns are read from the schema the Data 360 query API returns rather than assumed, then mapped onto the roles the report needs (agent, action, credits, metered flag, usage type, timestamp).
- **Graceful Aggregation:** When no credits column can be identified, the command returns raw rows instead of inventing an aggregation.
- **Metrics:** Emits total, metered and unmetered credit totals, action counts and Data 360 credit totals. Per-agent detail stays in the report and notification body, never in metric labels.
</details>


### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:diagnose:ai-usage --agent --target-org myorg@example.com
```

In agent mode, the command runs fully automatically with no interactive prompts. The analysis window defaults to the last 30 days unless `--days` is provided.

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation. Uses default values and skips prompts.||||
|days|option|Number of days to analyze|30|||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|outputfile<br/>-f|option|Force the path and name of output report file. Must end with .csv||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:org:diagnose:ai-usage
```

```shell
$ sf hardis:org:diagnose:ai-usage --days 7
```

```shell
$ sf hardis:org:diagnose:ai-usage --agent
```


