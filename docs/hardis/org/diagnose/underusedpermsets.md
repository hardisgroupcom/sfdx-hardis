<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:underusedpermsets

## Description


## Command Behavior

**Detects Permission Sets and Permission Set Groups that are assigned to zero users or to a configurable low number of users.**

This command helps identify permission sets and permission set groups that may be candidates for cleanup or consolidation. It includes:

- **Permission Sets:** Custom permission sets (NamespacePrefix = null, LicenseId = null) not owned by profiles and not in groups. Excludes PSL-linked and managed package permission sets.
- **Permission Set Groups:** Custom groups (NamespacePrefix = null). Excludes managed package groups.

Key functionalities:

- **Zero-assignment detection:** Finds permission sets and groups with no assignments.
- **Low-usage detection:** Finds permission sets and groups assigned to `PERMSET_LIMITED_USERS_THRESHOLD` or fewer users (default: 5).
- **Configurable threshold:** Set `PERMSET_LIMITED_USERS_THRESHOLD` environment variable to override the default (e.g., `10`).
- **Ignore list:** Set `UNDERUSED_PERMISSION_SETS_IGNORE` to a comma-separated list of permission set or group names to exclude from results.
- **CSV Report Generation:** Generates a CSV file with all identified permission sets.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams).

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

- **SOQL Queries:** Uses four SOQL queries, for permission sets (zero + limited) and permission set groups (zero + limited).
- **Exclusions:** Permission sets in groups are excluded (counted via group); PSL-linked and managed package items are excluded.
- **Ignore list:** `UNDERUSED_PERMISSION_SETS_IGNORE` env var (comma-separated names) excludes matching permission sets and groups.
- **Report Generation:** Uses `generateCsvFile` to create the CSV report.
- **Notification Integration:** Integrates with `NotifProvider` for notifications.
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
$ sf hardis:org:diagnose:underusedpermsets
```


