<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:licenses

## Description


**Lists and analyzes User Licenses and Permission Set Licenses subscribed and used in a Salesforce org.**

This command provides a comprehensive overview of your Salesforce license consumption. It's particularly useful for:

- **License Management:** Understanding which licenses are active, how many are available, and how many are being used.
- **Cost Optimization:** Identifying unused or underutilized licenses that could be reallocated or decommissioned.
- **Compliance:** Ensuring that your organization is compliant with Salesforce licensing agreements.
- **Monitoring:** Tracking license usage trends over time.

Key functionalities:

- **User License Details:** Retrieves information about standard and custom User Licenses, including `MasterLabel`, `Name`, `TotalLicenses`, and `UsedLicenses`.
- **Permission Set License Details:** Retrieves information about Permission Set Licenses, including `MasterLabel`, `PermissionSetLicenseKey`, `TotalLicenses`, and `UsedLicenses`.
- **Used Licenses Filter:** The `--usedonly` flag allows you to filter the report to show only licenses that have at least one `UsedLicenses` count greater than zero.
- **CSV Report Generation:** Generates a CSV file containing all the retrieved license information, suitable for detailed analysis.
- **Notifications:** Sends notifications to configured channels (e.g., Grafana, Slack, MS Teams) with a summary of license usage, including lists of active and used licenses.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce SOQL Queries:** It executes SOQL queries against the `UserLicense` and `PermissionSetLicense` objects in Salesforce to retrieve license data.
- **Data Transformation:** It processes the query results, reformatting the data to be more readable and consistent for reporting purposes (e.g., removing `Id` and `attributes`, renaming `PermissionSetLicenseKey` to `Name`).
- **Data Aggregation:** It aggregates license information, creating a `licensesByKey` object for quick lookups and a `usedLicenses` array for a concise list of actively used licenses.
- **Report Generation:** It uses `generateCsvFile` to create the CSV report of license data.
- **Notification Integration:** It integrates with the `NotifProvider` to send notifications, including attachments of the generated CSV report and metrics for monitoring dashboards.
- **User Feedback:** Provides clear messages to the user about the license extraction process and the used licenses.
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
| usedonly<br/>-u   | boolean | Filter to have only used licenses                                 |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |         |          |         |

## Examples

```shell
$ sf hardis:org:diagnose:licenses
```


