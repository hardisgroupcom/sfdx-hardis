<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:legacyapi

## Description

Checks if an org uses retired or someday retired API version


See article below

[![Handle Salesforce API versions Deprecation like a pro](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deprecated-api.jpg)](https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238)



## Parameters

| Name                  |  Type   | Description                                                         |    Default    | Required |                        Options                        |
|:----------------------|:-------:|:--------------------------------------------------------------------|:-------------:|:--------:|:-----------------------------------------------------:|
| apiversion            | option  | override the api version used for api requests made by this command |               |          |                                                       |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                     |               |          |                                                       |
| eventtype<br/>-e      | option  | Type of EventLogFile event to analyze                               | ApiTotalUsage |          |                                                       |
| json                  | boolean | format output as json                                               |               |          |                                                       |
| limit<br/>-l          | option  | Number of latest EventLogFile events to analyze                     |      999      |          |                                                       |
| loglevel              | option  | logging level for this command invocation                           |     warn      |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| outputfile<br/>-o     | option  | Force the path and name of output report file. Must end with .csv   |               |          |                                                       |
| skipauth              | boolean | Skip authentication check when a default username is required       |               |          |                                                       |
| targetusername<br/>-u | option  | username or alias for the target org; overrides default target org  |               |          |                                                       |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration           |               |          |                                                       |

## Examples

```shell
$ sfdx hardis:org:diagnose:legacyapi
```

```shell
$ sfdx hardis:org:diagnose:legacyapi -u hardis@myclient.com
```

```shell
$ sfdx hardis:org:diagnose:legacyapi --outputfile 'c:/path/to/folder/legacyapi.csv'
```

```shell
$ sfdx hardis:org:diagnose:legacyapi -u hardis@myclient.com --outputfile ./tmp/legacyapi.csv
```


