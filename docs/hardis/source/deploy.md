<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:source:deploy

## Description

sfdx-hardis wrapper for sfdx force:source:deploy that displays tips to solve deployment errors.

[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_deploy)


## Parameters

| Name                            |  Type   | Description                                                         |  Default   | Required |                                Options                                 |
|:--------------------------------|:-------:|:--------------------------------------------------------------------|:----------:|:--------:|:----------------------------------------------------------------------:|
| apiversion                      | option  | override the api version used for api requests made by this command |            |          |                                                                        |
| checkonly<br/>-c                | boolean | checkonly                                                           |            |          |                                                                        |
| debug                           | boolean | debug                                                               |            |          |                                                                        |
| ignoreerrors<br/>-o             | boolean | ignoreErrors                                                        |            |          |                                                                        |
| ignorewarnings<br/>-g           | boolean | ignoreWarnings                                                      |            |          |                                                                        |
| json                            | boolean | format output as json                                               |            |          |                                                                        |
| loglevel                        | option  | logging level for this command invocation                           |    warn    |          |         trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal          |
| manifest<br/>-x                 | option  | flagsLong.manifest                                                  |            |          |                                                                        |
| metadata<br/>-m                 | option  | metadata                                                            |            |          |                                                                        |
| postdestructivechanges          | option  | postdestructivechanges                                              |            |          |                                                                        |
| predestructivechanges           | option  | predestructivechanges                                               |            |          |                                                                        |
| runtests<br/>-r                 | option  | runTests                                                            |            |          |                                                                        |
| soapdeploy                      | boolean | soapDeploy                                                          |            |          |                                                                        |
| sourcepath<br/>-p               | option  | sourcePath                                                          |            |          |                                                                        |
| targetusername<br/>-u           | option  | username or alias for the target org; overrides default target org  |            |          |                                                                        |
| testlevel<br/>-l                | option  | testlevel                                                           | NoTestRun  |          | NoTestRun<br/>RunSpecifiedTests<br/>RunLocalTests<br/>RunAllTestsInOrg |
| validateddeployrequestid<br/>-q | option  | validateDeployRequestId                                             |            |          |                                                                        |
| verbose                         | boolean | verbose                                                             |            |          |                                                                        |
| wait<br/>-w                     | option  | wait                                                                | 60 minutes |          |                                                                        |
| websocket                       | option  | websocket                                                           |            |          |                                                                        |

## Examples


