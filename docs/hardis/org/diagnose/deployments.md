<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:deployments

## Description

Analyzes metadata deployments and validations by querying DeployRequest records via the Tooling API.

Tracks:

- Deployment/validation status (Succeeded, Failed, InProgress, Canceled)
- Pending time (CreatedDate to StartDate)
- Duration (StartDate to CompletedDate)
- Separation of deployments vs validations (CheckOnly)

Key functionalities:

- **Deployments vs validations:** Distinguishes actual deployments from validation-only (CheckOnly) runs.
- **Timing analysis:** Pending time (queue) and deployment/validation duration in minutes.
- **CSV report:** Generates a report of recent deployment/validation activity.
- **Notifications:** Sends to Grafana, Slack, MS Teams.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) and can output Grafana, Slack and MsTeams Notifications.


### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:diagnose:deployments --agent --period daily --target-org myorg@example.com
```

In agent mode:

- `--period` defaults to `daily` (last 24 hours) when not provided.
- All interactive prompts are skipped.

## Parameters

| Name              |  Type   | Description                                                                                                                                                                 | Default | Required |         Options          |
|:------------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:------------------------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                                                                                       |         |          |                          |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                                                                                             |         |          |                          |
| flags-dir         | option  | undefined                                                                                                                                                                   |         |          |                          |
| json              | boolean | Format output as json.                                                                                                                                                      |         |          |                          |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv                                                                                                           |         |          |                          |
| period<br/>-p     | option  | Time period to analyze: daily (last 24h), weekly (last 7 days), or all (no date filter). If not set, defaults to daily in CI or prompts for a number of days interactively. |         |          | daily<br/>weekly<br/>all |
| skipauth          | boolean | Skip authentication check when a default username is required                                                                                                               |         |          |                          |
| target-org<br/>-o | option  | undefined                                                                                                                                                                   |         |          |                          |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                   |         |          |                          |

## Examples

```shell
$ sf hardis:org:diagnose:deployments
```

```shell
$ sf hardis:org:diagnose:deployments --period daily
```

```shell
$ sf hardis:org:diagnose:deployments --period weekly
```

```shell
$ sf hardis:org:diagnose:deployments --period all
```

```shell
$ sf hardis:org:diagnose:deployments --agent
```


