<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:lint:unusedmetadatas

## Description

Check if elements (custom labels and custom permissions) are used in the project

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-unused-metadata/) and can output Grafana, Slack and MsTeams Notifications.
  

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
sf hardis:lint:unusedmetadatas
```


