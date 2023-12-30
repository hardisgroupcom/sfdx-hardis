<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:lint

## Description

Apply syntactic analysis (linters) on the repository sources, using Mega-Linter

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|apiversion|option|override the api version used for api requests made by this command||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|fix<br/>-f|boolean|Apply linters fixes||||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|skipauth|boolean|Skip authentication check when a default username is required||||
|targetusername<br/>-u|option|username or alias for the target org; overrides default target org||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:project:lint
```

```shell
$ sfdx hardis:project:lint --fix
```


