# hardis:scratch:create

## Description

Create and initialize a scratch org so it is ready to use

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|apiversion|option|override the api version used for api requests made by this command||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|forcenew<br/>-n|boolean|If an existing scratch org exists, do not reuse it but create a new one||||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|targetdevhubusername<br/>-v|option|username or alias for the dev hub org; overrides default dev hub org||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:scratch:create
```


