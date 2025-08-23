<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:instanceupgrade

## Description


## Command Behavior

**Retrieves and displays the scheduled upgrade date for a Salesforce org's instance.**

This command provides crucial information about when your Salesforce instance will be upgraded to the next major release (Spring, Summer, or Winter). This is vital for release planning, testing, and ensuring compatibility with upcoming Salesforce features.

Key functionalities:

- **Instance Identification:** Determines the Salesforce instance name of your target org.
- **Upgrade Date Retrieval:** Fetches the planned start time of the next major core service upgrade for that instance from the Salesforce Status API.
- **Days Until Upgrade:** Calculates and displays the number of days remaining until the next major upgrade.
- **Severity-Based Logging:** Adjusts the log severity (info, warning) based on the proximity of the upgrade date, providing a visual cue for urgency.
- **Notifications:** Sends notifications to configured channels (e.g., Slack, MS Teams, Grafana) with the upgrade information, making it suitable for automated monitoring.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce SOQL Query:** It first queries the `Organization` object in Salesforce to get the `InstanceName` of the target org.
- **Salesforce Status API Integration:** It makes an HTTP GET request to the Salesforce Status API (`https://api.status.salesforce.com/v1/instances/{instanceName}/status`) to retrieve detailed information about the instance, including scheduled maintenances.
- **Data Parsing:** It parses the JSON response from the Status API to extract the relevant major release upgrade information.
- **Date Calculation:** Uses the `moment` library to calculate the difference in days between the current date and the planned upgrade date.
- **Notification Integration:** It integrates with the `NotifProvider` to send notifications, including the instance name, upgrade date, and days remaining, along with relevant metrics for monitoring dashboards.
- **User Feedback:** Provides clear messages to the user about the upgrade status and proximity.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:org:diagnose:instanceupgrade
```


