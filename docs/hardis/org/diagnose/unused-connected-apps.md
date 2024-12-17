<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:unused-connected-apps

## Description

Request objects ConnectedApp, LoginHistory and OAuthToken to find which connected apps might not be used anymore, and could be deleted for security / technical debt reasons.

Check with Connected Apps metadatas if the app is still active (inactive = "Admin Users are pre-authorized + no Profile or Permission set assigned")

The following default Salesforce Connected Apps are ignored:

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

You can add more ignored apps by defining a comma-separated list of names in variable ALLOWED_INACTIVE_CONNECTED_APPS

_Example: ALLOWED_INACTIVE_CONNECTED_APPS=My App 1,My App 2, My App 3_

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-release-updates/) and can output Grafana, Slack and MsTeams Notifications.


## Parameters

| Name              |  Type   | Description                                                       |           Default            | Required | Options |
|:------------------|:-------:|:------------------------------------------------------------------|:----------------------------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                   |                              |          |         |
| flags-dir         | option  | undefined                                                         |                              |          |         |
| json              | boolean | Format output as json.                                            |                              |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv |                              |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required     |                              |          |         |
| target-org<br/>-o | option  | undefined                                                         | hardis@cityone.fr.intfluxne2 |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |                              |          |         |

## Examples

```shell
sf hardis:org:diagnose:unused-connected-apps
```


