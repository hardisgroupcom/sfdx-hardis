# hardis:project:clean:references

## Description

Remove unwanted references within sfdx project sources

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|config<br/>-c|option|Path to a JSON config file or a destructiveChanges.xml file||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|type<br/>-t|option|Cleaning type|||all<br/>caseentitlement<br/>dashboards<br/>datadotcom<br/>destructivechanges<br/>localfields<br/>productrequest|
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:project:clean:references
```

```shell
$ sfdx hardis:project:clean:references --type all
```

```shell
$ sfdx hardis:project:clean:references --config ./cleaning/myconfig.json
```

```shell
$ sfdx hardis:project:clean:references --config ./somefolder/myDestructivePackage.xml
```


