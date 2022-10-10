<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:deploy:sources:metadata

## Description

Deploy metadatas to source org

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|apiversion|option|override the api version used for api requests made by this command||||
|check<br/>-c|boolean|Only checks the deployment, there is no impact on target org||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|deploydir<br/>-x|option|Deploy directory|.|||
|destructivepackagexml<br/>-k|option|Path to destructiveChanges.xml file to deploy||||
|filter<br/>-f|boolean|Filter metadatas before deploying||||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|packagexml<br/>-p|option|Path to package.xml file to deploy||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|targetusername<br/>-u|option|username or alias for the target org; overrides default target org||||
|testlevel<br/>-l|option|Level of tests to apply to validate deployment|RunLocalTests||NoTestRun<br/>RunSpecifiedTests<br/>RunLocalTests<br/>RunAllTestsInOrg|
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:project:deploy:sources:metadata
```


