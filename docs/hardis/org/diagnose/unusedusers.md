<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:unusedusers

## Description


## Command Behavior

**Detects and reports on inactive or unused Salesforce user accounts, helping to optimize license usage and enhance security.**

Efficient user management is vital in Salesforce to ensure resources are optimized and costs are controlled. However, inactive or unused user accounts can often go unnoticed, leading to wasted licenses and potential security risks. This tool addresses this challenge by enabling administrators to identify users who haven't logged in within a specified period.

By analyzing user login activity and last login timestamps, this feature highlights inactive user accounts, allowing administrators to take appropriate action. Whether it's deactivating dormant accounts, freeing up licenses, or ensuring compliance with security policies, this functionality empowers administrators to maintain a lean and secure Salesforce environment.

Key functionalities:

- **Inactivity Detection:** Identifies users who have not logged in for a specified number of days (`--days` flag, default 180 days in CI, 365 days otherwise).
- **License Type Filtering:** Allows filtering users by license type using `--licensetypes` (e.g., `all-crm`, `all-paying`) or specific license identifiers using `--licenseidentifiers`.
  - `all-crm`: Includes `SFDC`, `AUL`, `AUL1`, `AULL_IGHT` licenses.
  - `all-paying`: Includes `SFDC`, `AUL`, `AUL1`, `AULL_IGHT`, `PID_Customer_Community`, `PID_Customer_Community_Login`, `PID_Partner_Community`, `PID_Partner_Community_Login` licenses.
  - Note: You can see the full list of available license identifiers in [Salesforce Documentation](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/sfdx_cli_reference/sforce_api_objects_userlicense.htm).
- **Active User Retrieval:** The `--returnactiveusers` flag inverts the command, allowing you to retrieve active users who *have* logged in during the specified period.
- **CSV Report Generation:** Generates a CSV file containing details of all identified users (inactive or active), including their last login date, profile, and license information.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams) with a summary of inactive or active users.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-inactive-users/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Query (Bulk API):** It uses `bulkQuery` to efficiently retrieve user records from the Salesforce `User` object. The SOQL query dynamically constructs its WHERE clause based on the `--days`, `--licensetypes`, `--licenseidentifiers`, and `--returnactiveusers` flags.
- **Interactive Prompts:** Uses `prompts` to interactively ask the user for the number of inactive days and license types if not provided via flags.
- **License Mapping:** Internally maps common license type aliases (e.g., `all-crm`) to their corresponding Salesforce `LicenseDefinitionKey` values.
- **Report Generation:** It uses `generateCsvFile` to create the CSV report of users.
- **Notification Integration:** It integrates with the `NotifProvider` to send notifications, including attachments of the generated CSV report and metrics for monitoring dashboards.
- **User Feedback:** Provides a summary of the findings in the console, indicating the number of inactive or active users found.
</details>

## Parameters

| Name                      |  Type   | Description                                                                                                                                                                                                                          | Default | Required |            Options             |
|:--------------------------|:-------:|:-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:------------------------------:|
| days<br/>-t               | option  | Extracts the users that have been inactive for the amount of days specified. In CI, default is 180 days                                                                                                                              |         |          |                                |
| debug<br/>-d              | boolean | Activate debug mode (more logs)                                                                                                                                                                                                      |         |          |                                |
| flags-dir                 | option  | undefined                                                                                                                                                                                                                            |         |          |                                |
| json                      | boolean | Format output as json.                                                                                                                                                                                                               |         |          |                                |
| licenseidentifiers<br/>-i | option  | Comma-separated list of license identifiers, in case licensetypes is not used.. Identifiers available at https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_userlicense.htm |         |          |                                |
| licensetypes<br/>-l       | option  | Type of licenses to check. If set, do not use licenseidentifiers option. In CI, default is all-crm                                                                                                                                   |         |          | all<br/>all-crm<br/>all-paying |
| outputfile<br/>-f         | option  | Force the path and name of output report file. Must end with .csv                                                                                                                                                                    |         |          |                                |
| returnactiveusers         | boolean | Inverts the command by returning the active users                                                                                                                                                                                    |         |          |                                |
| skipauth                  | boolean | Skip authentication check when a default username is required                                                                                                                                                                        |         |          |                                |
| target-org<br/>-o         | option  | undefined                                                                                                                                                                                                                            |         |          |                                |
| websocket                 | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                                                            |         |          |                                |

## Examples

```shell
$ sf hardis:org:diagnose:unusedusers
```

```shell
$ sf hardis:org:diagnose:unusedusers --days 365
```

```shell
$ sf hardis:org:diagnose:unusedusers --days 60 --licensetypes all-crm
```

```shell
$ sf hardis:org:diagnose:unusedusers --days 60 --licenseidentifiers SFDC,AUL,AUL1
```

```shell
$ sf hardis:org:diagnose:unusedusers --days 60 --licensetypes all-crm --returnactiveusers
```


