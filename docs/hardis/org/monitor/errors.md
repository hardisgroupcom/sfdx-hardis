<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:monitor:errors

## Description


## Command Behavior

**Collects Apex and Flow crash logs from the last N days, exports CSV/XLSX reports, and posts notifications.**

Key functionalities:

- **Apex errors:** Queries failed Apex logs from the Tooling API and failed async Apex jobs from the standard API.
- **Flow errors:** Queries failed Flow interviews from the standard REST API.
- **Report generation:** Exports both datasets to CSV/XLSX for monitoring pipelines.
- **Notifications:** Sends notifications with summary metrics and file attachments.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.


## Parameters

| Name              |  Type   | Description                                                        | Default | Required | Options |
|:------------------|:-------:|:-------------------------------------------------------------------|:-------:|:--------:|:-------:|
| days<br/>-n       | option  | Number of days to look back for Apex and Flow errors (default: 1). |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                    |         |          |         |
| flags-dir         | option  | undefined                                                          |         |          |         |
| json              | boolean | Format output as json.                                             |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required      |         |          |         |
| target-org<br/>-o | option  | undefined                                                          |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration          |         |          |         |

## Examples

```shell
$ sf hardis:org:monitor:errors
```


