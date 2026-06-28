<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:minimalpermsets

## Description

Analyzes permission set metadata files in the sfdx project to identify permission sets with very few permissions (configurable threshold, default: 5 or fewer).

These "minimal" permission sets may be candidates for consolidation to reduce org complexity and improve maintainability.

Key functionalities:

- **Project-based analysis:** Scans `.permissionset-meta.xml` files in the project (no org connection required for analysis).
- **Permission counting:** Uses structure to differentiate leaf elements (primitives) from nested elements (objects). Leaf elements are metadata-only; nested elements grant permissions. Future API additions are supported automatically.
- **Configurable threshold:** Set `MINIMAL_PERMSETS_THRESHOLD` env var or use `--threshold` (default: 5).
- **Metadata directory:** Uses `--metadata-dir` or scans `**/*.permissionset-meta.xml` in the project.
- **CSV report:** Generates a report listing minimal permission sets with their permission count.
- **Notifications:** Sends alerts to Grafana, Slack, MS Teams when minimal permission sets are found.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.


### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:diagnose:minimalpermsets --agent
```

In agent mode, the command runs fully automatically. The permission threshold defaults to 5 (or `MINIMAL_PERMSETS_THRESHOLD` env var) when `--threshold` is not provided.

## Parameters

| Name                |  Type   | Description                                                                                                          | Default | Required | Options |
|:--------------------|:-------:|:---------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent               | boolean | Run in non-interactive mode for agents and automation. Uses default values and skips prompts.                        |         |          |         |
| debug<br/>-d        | boolean | Activate debug mode (more logs)                                                                                      |         |          |         |
| flags-dir           | option  | undefined                                                                                                            |         |          |         |
| json                | boolean | Format output as json.                                                                                               |         |          |         |
| metadata-dir<br/>-m | option  | Directory containing .permissionset-meta.xml files. If not set, scans entire project for **/*.permissionset-meta.xml |         |          |         |
| outputfile<br/>-f   | option  | Force the path and name of output report file. Must end with .csv                                                    |         |          |         |
| skipauth            | boolean | Skip authentication check when a default username is required                                                        |         |          |         |
| target-org<br/>-o   | option  | undefined                                                                                                            |         |          |         |
| threshold<br/>-t    | option  | Maximum number of permissions to be considered minimal. Overrides MINIMAL_PERMSETS_THRESHOLD env var.                |         |          |         |
| websocket           | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                            |         |          |         |

## Examples

```shell
$ sf hardis:org:diagnose:minimalpermsets
```

```shell
$ sf hardis:org:diagnose:minimalpermsets --threshold 5
```

```shell
$ sf hardis:org:diagnose:minimalpermsets --metadata-dir force-app/main/default/permissionsets
```

```shell
$ sf hardis:org:diagnose:minimalpermsets --agent
```


