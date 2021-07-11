# hardis:org:test:apex

## Description

Run apex test cases on org

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|apiversion|option|override the api version used for api requests made by this command||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|targetusername<br/>-u|option|username or alias for the target org; overrides default target org||||
|testlevel<br/>-l|option|Level of tests to apply to validate deployment|RunLocalTests||NoTestRun<br/>RunSpecifiedTests<br/>RunLocalTests<br/>RunAllTestsInOrg|
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:org:test:apex
```


