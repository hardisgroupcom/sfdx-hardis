# hardis:project:clean:orgmissingitems

## Description

Clean SFDX sources from items present neither in target org nor local package.xml

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|folder<br/>-f|option|Root folder|force-app|||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|packagexmlfull<br/>-p|option|Path to packagexml used for cleaning.
Must contain also standard CustomObject and CustomField elements.
If not provided, it will be generated from a remote org||||
|packagexmltargetorg<br/>-t|option|Target org username or alias to build package.xml (sfdx must be authenticated).
If not provided, will be prompted to the user.||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:project:clean:orgmissingitems
```


