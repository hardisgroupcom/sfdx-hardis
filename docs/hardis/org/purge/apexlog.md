# hardis:org:purge:apexlog

## Description

Purge apex logs in selected org

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|apiversion|option|override the api version used for api requests made by this command||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|prompt<br/>-z|boolean|Prompt for confirmation (true by default, use --no-prompt to skip)||||
|targetusername<br/>-u|option|username or alias for the target org; overrides default target org||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:org:purge:apexlog
```

```shell
$ sfdx hardis:org:purge:apexlog --targetusername nicolas.vuillamy@gmail.com
```


