<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:community:update

## Description

Activate or deactivate a community by changing it's status:

- Live
- DownForMaintenance

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|name<br/>-n|option|List of Networks Names that you want to update, separated by comma||||
|status<br/>-s|option|New status for the community, available values are: Live, DownForMaintenance||||
|target-org<br/>-o|option|undefined|synefo@advisopartners.com|||

## Examples

```shell
$ sf hardis:org:community:update --name 'MyNetworkName' --status DownForMaintenance
```

```shell
$ sf hardis:org:community:update --name 'MyNetworkName,MySecondNetworkName' --status Live
```


