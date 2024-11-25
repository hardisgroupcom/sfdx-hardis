<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:monitor:backup

## Description

Retrieve sfdx sources in the context of a monitoring backup

Automatically skips metadatas from installed packages with namespace.  

You can remove more metadata types from backup, especially in case you have too many metadatas and that provokes a crash, using:

- Manual update of `manifest/package-skip-items.xml` config file (then commit & push in the same branch)

- Environment variable MONITORING_BACKUP_SKIP_METADATA_TYPES (example: `MONITORING_BACKUP_SKIP_METADATA_TYPES=CustomLabel,StaticResource,Translation`): that will be applied to all monitoring branches.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-metadata-backup/) and can output Grafana, Slack and MsTeams Notifications.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|outputfile<br/>-f|option|Force the path and name of output report file. Must end with .csv||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:org:monitor:backup
```


