<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:lint:metadatastatus

## Description

Check if elements are inactive in the project:

- Approval Processes
- Assignment Rules
- Auto Response Rules
- Escalation Rules
- Flows
- Forecasting Types
- Record Types
- Validation Rules
- Workflow Rules

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/detect-inactive-metadata.gif)

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-inactive-metadata/) and can output Grafana, Slack and MsTeams Notifications.


## Parameters

| Name              |  Type   | Description                                                       |                 Default                  | Required | Options |
|:------------------|:-------:|:------------------------------------------------------------------|:----------------------------------------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                   |                                          |          |         |
| flags-dir         | option  | undefined                                                         |                                          |          |         |
| json              | boolean | Format output as json.                                            |                                          |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv |                                          |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required     |                                          |          |         |
| target-org<br/>-o | option  | undefined                                                         | <nicolas.vuillamy@cloudity.com.playnico> |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |                                          |          |         |

## Examples

```shell
sf hardis:lint:metadatastatus
```


