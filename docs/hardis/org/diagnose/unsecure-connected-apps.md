<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:unsecure-connected-apps

## Description


## Command Behavior

**Detects unsecured Connected Apps in a Salesforce org and generates detailed reports for security analysis.**

This command is a critical security diagnostic tool that helps administrators identify Connected Apps that may pose security risks due to improper configuration. It provides comprehensive analysis of OAuth tokens and Connected App security settings to ensure proper access control.

Key functionalities:

- **OAuth Token Analysis:** Queries all OAuth tokens in the org using SOQL to retrieve comprehensive token information including app names, users, authorization status, and usage statistics.
- **Security Status Assessment:** Evaluates each Connected App's security configuration by checking the `IsUsingAdminAuthorization` flag to determine if admin pre-approval is required.
- **Ignore List Support:** Skips warning/escalation for Connected Apps configured in `monitoringUnsecureConnectedAppsIgnore` (project config) or `MONITORING_UNSECURE_CONNECTED_APPS_IGNORE` (environment variable). Matching OAuth tokens are marked as *Ignored*.
- **Unsecured App Detection:** Identifies Connected Apps that allow users to authorize themselves without admin approval, which can pose security risks.
- **Phantom App Cleanup (Optional):** Detects unsecured Connected Apps that are not present in the Installed Connected Apps list and offers an interactive option to revoke their OAuth tokens (forces re-authentication if still needed).
- **Detailed Reporting:** Generates two comprehensive CSV reports:
  - **OAuth Tokens Report:** Lists all OAuth tokens with security status, user information, and usage data
  - **Connected Apps Summary:** Aggregates unsecured Connected Apps with counts of associated OAuth tokens
- **Visual Indicators:** Uses status icons (❌ for unsecured, ✅ for secured, ⚪ for ignored) to provide immediate visual feedback on security status.
- **Security Recommendations:** Provides actionable guidance on how to secure Connected Apps through proper configuration.
- **Notifications:** Sends alerts to configured channels (Grafana, Slack, MS Teams) with security findings and attached reports.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-org-security/) and can output Grafana, Slack and MsTeams Notifications.

<iframe width="560" height="315" src="https://www.youtube.com/embed/jHv8yrSK8Dg" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Query Execution:** Executes a comprehensive SOQL query on the `OauthToken` object, joining with `AppMenuItem` and `User` objects to gather complete security context.
- **Security Analysis Logic:** Analyzes the `AppMenuItem.IsUsingAdminAuthorization` field to determine if a Connected App requires admin pre-approval for user authorization.
- **Ignore Handling:** Normalizes Connected App names and marks matching OAuth tokens as *Ignored* so they do not contribute to unsecured Connected App counts and notifications.
- **Data Transformation:** Processes raw SOQL results to add security status indicators and reorganize data for optimal reporting and analysis.
- **Aggregation Processing:** Groups OAuth tokens by Connected App name to provide summary statistics and identify the most problematic applications.
- **Token Revocation:** Optionally calls Salesforce OAuth revoke endpoint using each token's `DeleteToken` value to revoke OAuth tokens for selected phantom Connected Apps.
- **Report Generation:** Uses `generateCsvFile` to create structured CSV reports with proper formatting and metadata for easy analysis and sharing.
- **Notification Integration:** Integrates with the `NotifProvider` to send security alerts with detailed metrics, including the number of unsecured Connected Apps and associated OAuth tokens.
- **File Management:** Generates multiple output formats (CSV, XLSX) and manages file paths using `generateReportPath` for consistent report organization.
- **Connection Management:** Uses `setConnectionVariables` to ensure proper authentication context for notification providers that require org connection details.
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
$ sf hardis:org:diagnose:unsecure-connected-apps
```


