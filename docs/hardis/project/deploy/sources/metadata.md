<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:deploy:sources:metadata

## Description

Deploy metadatas to source org

## Parameters

| Name                         |  Type   | Description                                                   |        Default        | Required |                                Options                                 |
|:-----------------------------|:-------:|:--------------------------------------------------------------|:---------------------:|:--------:|:----------------------------------------------------------------------:|
| check<br/>-c                 | boolean | Only checks the deployment, there is no impact on target org  |                       |          |                                                                        |
| debug<br/>-d                 | boolean | Activate debug mode (more logs)                               |                       |          |                                                                        |
| deploydir<br/>-x             | option  | Deploy directory                                              |           .           |          |                                                                        |
| destructivepackagexml<br/>-k | option  | Path to destructiveChanges.xml file to deploy                 |                       |          |                                                                        |
| filter<br/>-f                | boolean | Filter metadatas before deploying                             |                       |          |                                                                        |
| flags-dir                    | option  | undefined                                                     |                       |          |                                                                        |
| json                         | boolean | Format output as json.                                        |                       |          |                                                                        |
| packagexml<br/>-p            | option  | Path to package.xml file to deploy                            |                       |          |                                                                        |
| skipauth                     | boolean | Skip authentication check when a default username is required |                       |          |                                                                        |
| target-org<br/>-o            | option  | undefined                                                     | <hardis@aefc2021.com> |          |                                                                        |
| testlevel<br/>-l             | option  | Level of tests to apply to validate deployment                |     RunLocalTests     |          | NoTestRun<br/>RunSpecifiedTests<br/>RunLocalTests<br/>RunAllTestsInOrg |
| websocket                    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |                       |          |                                                                        |

## Examples

```shell
sf hardis:project:deploy:sources:metadata
```


