<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:flex-queue

## Description

Counts **AsyncApexJob** records with **Status = 'Holding'** (Apex flex queue), including **ApexClass.Name**, **JobType**, and **CreatedDate** for each job. The org can hold at most **100** such jobs; when the queue is full, new queueable/batch work can fail or stall.

- **Alert:** when the count is **greater than or equal to** `--threshold` (default **90**), or from env **APEX_FLEX_QUEUE_THRESHOLD**.
- **Severity:** **error** when count reaches **100** (queue full); **warning** when count is at or above the threshold but below the max.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.


### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:diagnose:flex-queue --agent --target-org myorg@example.com
```

In agent mode, the command runs fully automatically. The `--threshold` defaults to 90 (or `APEX_FLEX_QUEUE_THRESHOLD` env var) when not provided.

## Parameters

| Name              |  Type   | Description                                                                                                    | Default | Required | Options |
|:------------------|:-------:|:---------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation. Uses default values and skips prompts.                  |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                                |         |          |         |
| flags-dir         | option  | undefined                                                                                                      |         |          |         |
| json              | boolean | Format output as json.                                                                                         |         |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv                                              |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                  |         |          |         |
| target-org<br/>-o | option  | undefined                                                                                                      |         |          |         |
| threshold<br/>-t  | option  | Alert when Holding job count >= this value (1–100). Overrides APEX_FLEX_QUEUE_THRESHOLD env var (default: 90). |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                      |         |          |         |

## Examples

```shell
$ sf hardis:org:diagnose:flex-queue
```

```shell
$ sf hardis:org:diagnose:flex-queue --threshold 95
```

```shell
$ sf hardis:org:diagnose:flex-queue --outputfile ./reports/flex-queue-holding.csv
```

```shell
$ sf hardis:org:diagnose:flex-queue --agent
```


