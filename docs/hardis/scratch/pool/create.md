<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:pool:create

## Description

Select a data storage service and configure information to build a scratch org pool

  Run the command, follow instruction, then you need to schedule a daily CI job for the pool maintenance:

  - Define CI ENV variable SCRATCH_ORG_POOL with value "true"

  - Call the following lines in the CI job:

```shell
  sf hardis:auth:login --devhub
  sf hardis:scratch:pool:refresh
```
  

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-dev-hub<br/>-v|option|undefined|nicolas.vuillamy@cloudity-jdc.com|||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:scratch:pool:configure
```


