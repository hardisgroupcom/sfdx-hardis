# hardis:package:version:promote

## Description

Promote package(s) version(s): convert it from beta to released

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|apiversion|option|override the api version used for api requests made by this command||||
|auto<br/>-d|boolean|Auto-detect which versions of which packages need to be promoted||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|targetdevhubusername<br/>-v|option|username or alias for the dev hub org; overrides default dev hub org||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:package:version:promote
```

```shell
$ sfdx hardis:package:version:promote --auto
```


