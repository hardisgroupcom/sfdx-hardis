<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:legacyapi

## Description

Checks if an org uses a deprecated API version
More info at https://help.salesforce.com/s/articleView?id=000351312&language=en_US&mode=1&type=1

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|apiversion|option|override the api version used for api requests made by this command||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|eventtype<br/>-e|option|Type of EventLogFile event to analyze|ApiTotalUsage|||
|json|boolean|format output as json||||
|limit<br/>-l|option|Number of latest EventLogFile events to analyze|999|||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|mode<br/>-m|option|Detection mode: jsforce or apex|jsforce|||
|targetusername<br/>-u|option|username or alias for the target org; overrides default target org||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:org:diagnose:legacyapi
```


