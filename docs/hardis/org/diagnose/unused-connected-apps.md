<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:unused-connected-apps

## Description


## Command Behavior

**Identifies and reports on potentially unused Connected Apps in a Salesforce org, suggesting candidates for deletion or deactivation.**

This command helps improve org security and reduce technical debt by pinpointing Connected Apps that are no longer actively used. Connected Apps can pose security risks if left unmonitored, and cleaning them up contributes to a healthier Salesforce environment.

Key functionalities:

- **Connected App Data Collection:** Gathers information about all Connected Apps in the org, including creation and last modified dates, and associated users.
- **Usage Analysis:** Analyzes `LoginHistory` and `OAuthToken` records to determine the last usage date of each Connected App.
- **Inactivity Detection:** Flags Connected Apps as potentially unused if they have no recent login history or OAuth token usage.
- **Accessibility Check:** Examines Connected App metadata to identify if they are accessible (e.g., if they require admin approval and have no profiles or permission sets assigned).
- **Ignored Apps:** Automatically ignores a predefined list of common Salesforce Connected Apps (e.g., `Salesforce CLI`, `Salesforce Mobile Dashboards`). You can extend this list by defining the `ALLOWED_INACTIVE_CONNECTED_APPS` environment variable.
- **CSV Report Generation:** Generates a CSV file containing details of all analyzed Connected Apps, including their usage status, last usage date, and reasons for being flagged as potentially unused.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams) with a summary of potentially unused Connected Apps.

**Default Ignored Connected Apps:**

- Ant Migration Tool
- Chatter Desktop
- Chatter Mobile for BlackBerry
- Force.com IDE
- OIQ_Integration
- Salesforce CLI
- Salesforce Files
- Salesforce Mobile Dashboards
- Salesforce Touch
- Salesforce for Outlook
- SalesforceA
- SalesforceA for Android
- SalesforceA for iOS
- SalesforceDX Namespace Registry
- SalesforceIQ

You can add more ignored apps by defining a comma-separated list of names in the `ALLOWED_INACTIVE_CONNECTED_APPS` environment variable.

_Example: 
ALLOWED_INACTIVE_CONNECTED_APPS=My App 1,My App 2, My App 3_

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-unused-connected-apps/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce SOQL Queries:** It performs SOQL queries against `ConnectedApplication`, `LoginHistory`, and `OAuthToken` objects to gather comprehensive data about Connected Apps and their usage.
- **Temporary SFDX Project:** It creates a temporary SFDX project to retrieve Connected App metadata, allowing for local parsing and analysis of their XML files.
- **Metadata Parsing:** It parses the `connectedApp-meta.xml` files to check for `isAdminApproved` and the presence of `profileName` or `permissionsetName` to determine accessibility.
- **Data Correlation:** It correlates data from various Salesforce objects to build a complete picture of each Connected App's usage and status.
- **Date Calculation:** Uses `moment` to calculate the time since the last OAuth token usage.
- **Report Generation:** It uses `generateCsvFile` to create the CSV report of unused Connected Apps.
- **Notification Integration:** It integrates with the `NotifProvider` to send notifications, including attachments of the generated CSV report and metrics for monitoring dashboards.
- **File System Operations:** Uses `fs-extra` for creating and removing temporary directories and files.
- **Environment Variable Reading:** Reads the `ALLOWED_INACTIVE_CONNECTED_APPS` environment variable to customize the list of ignored Connected Apps.
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
$ sf hardis:org:diagnose:unused-connected-apps
```


