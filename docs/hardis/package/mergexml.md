<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:package:mergexml

## Description

Select and merge package.xml files

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|folder<br/>-f|option|Root folder|manifest|||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|packagexmls<br/>-p|option|Comma separated list of package.xml files to merge. Will be prompted to user if not provided||||
|pattern<br/>-x|option|Name criteria to list package.xml files|/**/*package*.xml|||
|result<br/>-r|option|Result package.xml file name||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:package:mergexml
```

```shell
$ sfdx hardis:package:mergexml --folder packages --pattern /**/*.xml --result myMergedPackage.xml
```

```shell
$ sfdx hardis:package:mergexml --packagexmls "config/mypackage1.xml,config/mypackage2.xml,config/mypackage3.xml" --result myMergedPackage.xml
```


