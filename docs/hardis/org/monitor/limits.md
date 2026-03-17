<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:monitor:limits

## Description


## Command Behavior

**Checks the current usage of various Salesforce org limits and sends notifications if thresholds are exceeded.**

This command is a critical component of proactive Salesforce org management, helping administrators and developers monitor resource consumption and prevent hitting critical limits that could impact performance or functionality. It provides early warnings when limits are approaching their capacity.

Key functionalities:

- **Limit Retrieval:** Fetches a comprehensive list of all Salesforce org limits using the Salesforce CLI.
- **Usage Calculation:** Calculates the percentage of each limit that is currently being used.
- **Threshold-Based Alerting:** Assigns a severity (success, warning, or error) to each limit based on configurable thresholds:
  - **Warning:** If usage exceeds 50% (configurable via `LIMIT_THRESHOLD_WARNING` environment variable).
  - **Error:** If usage exceeds 75% (configurable via `LIMIT_THRESHOLD_ERROR` environment variable).
- **CSV Report Generation:** Generates a CSV file containing all org limits, their current usage, maximum allowed, and calculated percentage used, along with the assigned severity.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams) with a summary of limits that have exceeded the warning or error thresholds.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-org-limits/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce CLI Integration:** It executes the `sf org limits list` command to retrieve the current org limits. It parses the JSON output of this command.
- **Data Processing:** It iterates through the retrieved limits, calculates the `used` and `percentUsed` values, and assigns a `severity` (success, warning, error) based on the configured thresholds.
- **Environment Variable Configuration:** Reads `LIMIT_THRESHOLD_WARNING` and `LIMIT_THRESHOLD_ERROR` environment variables to set the warning and error thresholds for limit usage.
- **Report Generation:** It uses `generateCsvFile` to create the CSV report of org limits.
- **Notification Integration:** It integrates with the `NotifProvider` to send notifications, including attachments of the generated CSV report and detailed metrics for each limit, which can be consumed by monitoring dashboards like Grafana.
- **Exit Code Management:** Sets the process exit code to 1 if any limit is in an 'error' state, indicating a critical issue.
</details>


## Parameters

| Name              |  Type   | Description                                                       | Default | Required | Options |
|:------------------|:-------:|:------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                   |         |          |         |
| flags-dir         | option  | undefined                                                         |         |          |         |
| json              | boolean | Format output as json.                                            |         |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required     |         |          |         |
| target-org<br/>-o | option  | undefined                                                         |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |         |          |         |

## Examples

```shell
$ sf hardis:org:monitor:limits
```


