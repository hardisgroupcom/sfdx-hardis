<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:user:unfreeze

## Description

Unfreeze mass users in org after a maintenance or go live

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|apiversion|option|override the api version used for api requests made by this command||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|except<br/>-e|option|Allow to take all item except these criteria|System Administrator,Administrateur système|||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|maxuserdisplay<br/>-m|option|Maximum users to display in logs|100|||
|name<br/>-n|option|Filter according to Name criteria||||
|targetusername<br/>-u|option|username or alias for the target org; overrides default target org||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:org:user:unfreeze
```

```shell
$ sfdx hardis:org:user:unfreeze --targetusername myuser@myorg.com
```

```shell
$ sfdx hardis:org:user:unfreeze --except 'System Administrator,Some Other Profile'
```


