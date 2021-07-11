# hardis:project:audit:apiversion

## Description

Audit API version

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|failiferror<br/>-f|boolean|Fails (exit code 1) if an error is found||||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|minimumapiversion<br/>-m|option|Minimum allowed API version|20|||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:project:audit:apiversion
```


