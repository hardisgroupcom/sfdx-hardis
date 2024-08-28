<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:create

## Description

Create and initialize a scratch org or a source-tracked sandbox (config can be defined using `config/.sfdx-hardis.yml`):

- **Install packages**
  - Use property `installedPackages`
- **Push sources**
- **Assign permission sets**
  - Use property `initPermissionSets`
- **Run apex initialization scripts**
  - Use property `scratchOrgInitApexScripts`
- **Load data**
  - Use property `dataPackages`
  

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|forcenew<br/>-n|boolean|If an existing scratch org exists, do not reuse it but create a new one||||
|json|boolean|Format output as json.||||
|pool<br/>-d|boolean|Creates the scratch org for a scratch org pool||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-dev-hub<br/>-v|option|undefined|nicolas.vuillamy@cloudity-jdc.com|||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:scratch:create
```


