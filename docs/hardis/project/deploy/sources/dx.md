<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:deploy:sources:dx

## Description

Deploy SFDX source to org, following deploymentPlan in .sfdx-hardis.yml

  Env vars override:

  - SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES: define "true" to ignore split of package.xml


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|apiversion|option|override the api version used for api requests made by this command||||
|check<br/>-c|boolean|Only checks the deployment, there is no impact on target org||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|packagexml<br/>-p|option|Path to package.xml containing what you want to deploy in target org||||
|targetusername<br/>-u|option|username or alias for the target org; overrides default target org||||
|testlevel<br/>-l|option|Level of tests to apply to validate deployment|RunLocalTests||NoTestRun<br/>RunSpecifiedTests<br/>RunLocalTests<br/>RunAllTestsInOrg|
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:project:deploy:sources:dx
```


