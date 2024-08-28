<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:generate:packagexmlfull

## Description

Generates full org package.xml, including managed items

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|outputfile|option|Output package.xml file||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined|hardis@aefc2021.com|||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:org:generate:packagexmlfull
```

```shell
$ sf hardis:org:generate:packagexmlfull --outputfile /tmp/packagexmlfull.xml
```

```shell
$ sf hardis:org:generate:packagexmlfull --targetusername nico@example.com
```


