<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:monitor:backup

## Description

Retrieve sfdx sources in the context of a monitoring backup
  
You can remove more metadata types from backup, especially in case you have too many metadatas and that provokes a crash, using:

- Manual update of `manifest/package-skip-items.xml` config file (then commit & push in the same branch)

- Environment variable MONITORING_BACKUP_SKIP_METADATA_TYPES (example: `MONITORING_BACKUP_SKIP_METADATA_TYPES=CustomLabel,StaticResource,Translation`): that will be applied to all monitoring branches.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|apiversion|option|override the api version used for api requests made by this command||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|outputfile<br/>-o|option|Force the path and name of output report file. Must end with .csv||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|targetusername<br/>-u|option|username or alias for the target org; overrides default target org||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:org:monitor:backup
```


