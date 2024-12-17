<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:legacyapi

## Description

Checks if an org uses retired or someday retired API version


See article below

[![Handle Salesforce API versions Deprecation like a pro](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deprecated-api.jpg)](https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238)

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-deprecated-api-calls/) and can output Grafana, Slack and MsTeams Notifications.


## Parameters

| Name              |  Type   | Description                                                       |           Default            | Required | Options |
|:------------------|:-------:|:------------------------------------------------------------------|:----------------------------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                   |                              |          |         |
| eventtype<br/>-e  | option  | Type of EventLogFile event to analyze                             |        ApiTotalUsage         |          |         |
| flags-dir         | option  | undefined                                                         |                              |          |         |
| json              | boolean | Format output as json.                                            |                              |          |         |
| limit<br/>-l      | option  | Number of latest EventLogFile events to analyze                   |             999              |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv |                              |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required     |                              |          |         |
| target-org<br/>-o | option  | undefined                                                         | hardis@cityone.fr.intfluxne2 |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |                              |          |         |

## Examples

```shell
sf hardis:org:diagnose:legacyapi
```

```shell
sf hardis:org:diagnose:legacyapi -u hardis@myclient.com
```

```shell
sf hardis:org:diagnose:legacyapi --outputfile 'c:/path/to/folder/legacyapi.csv'
```

```shell
sf hardis:org:diagnose:legacyapi -u hardis@myclient.com --outputfile ./tmp/legacyapi.csv
```


