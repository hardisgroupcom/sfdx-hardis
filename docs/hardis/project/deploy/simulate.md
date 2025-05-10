<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:deploy:simulate

## Description

Simulate the deployment of a metadata in an org prompted to the user
  
For example, helps to solve the issue in a Permission Set without having to run a CI/CD job.

Used by VsCode Extension

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|source-dir<br/>-f|option|Source file or directory to simulate the deployment||||
|target-org<br/>-o|option|undefined||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:deploy:simulate --source-dir force-app/defaut/main/permissionset/PS_Admin.permissionset-meta.xml
```


