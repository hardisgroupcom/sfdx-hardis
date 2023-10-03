<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:test:apex

## Description

Run apex tests in Salesforce org

If following configuration is defined, it will fail if apex coverage target is not reached:

- Env `APEX_TESTS_MIN_COVERAGE_ORG_WIDE` or `.sfdx-hardis` property `apexTestsMinCoverageOrgWide`
- Env `APEX_TESTS_MIN_COVERAGE_ORG_WIDE` or `.sfdx-hardis` property `apexTestsMinCoverageOrgWide`

You can override env var SFDX_TEST_WAIT_MINUTES to wait more than 60 minutes


## Parameters

| Name                  |  Type   | Description                                                         |    Default    | Required |                                Options                                 |
|:----------------------|:-------:|:--------------------------------------------------------------------|:-------------:|:--------:|:----------------------------------------------------------------------:|
| apiversion            | option  | override the api version used for api requests made by this command |               |          |                                                                        |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                     |               |          |                                                                        |
| json                  | boolean | format output as json                                               |               |          |                                                                        |
| loglevel              | option  | logging level for this command invocation                           |     warn      |          |         trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal          |
| skipauth              | boolean | Skip authentication check when a default username is required       |               |          |                                                                        |
| targetusername<br/>-u | option  | username or alias for the target org; overrides default target org  |               |          |                                                                        |
| testlevel<br/>-l      | option  | Level of tests to apply to validate deployment                      | RunLocalTests |          | NoTestRun<br/>RunSpecifiedTests<br/>RunLocalTests<br/>RunAllTestsInOrg |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration           |               |          |                                                                        |

## Examples

```shell
sfdx hardis:org:test:apex
```


