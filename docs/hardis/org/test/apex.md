<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:test:apex

## Description

Run apex tests in Salesforce org

If following configuration is defined, it will fail if apex coverage target is not reached:

- Env `APEX_TESTS_MIN_COVERAGE_ORG_WIDE` or `.sfdx-hardis` property `apexTestsMinCoverageOrgWide`
- Env `APEX_TESTS_MIN_COVERAGE_ORG_WIDE` or `.sfdx-hardis` property `apexTestsMinCoverageOrgWide`

You can override env var SFDX_TEST_WAIT_MINUTES to wait more than 60 minutes.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-apex-tests/) and can output Grafana, Slack and MsTeams Notifications.


## Parameters

| Name              |  Type   | Description                                                   |           Default           | Required |                                Options                                 |
|:------------------|:-------:|:--------------------------------------------------------------|:---------------------------:|:--------:|:----------------------------------------------------------------------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |                             |          |                                                                        |
| flags-dir         | option  | undefined                                                     |                             |          |                                                                        |
| json              | boolean | Format output as json.                                        |                             |          |                                                                        |
| skipauth          | boolean | Skip authentication check when a default username is required |                             |          |                                                                        |
| target-org<br/>-o | option  | undefined                                                     | <synefo@advisopartners.com> |          |                                                                        |
| testlevel<br/>-l  | option  | Level of tests to apply to validate deployment                |        RunLocalTests        |          | NoTestRun<br/>RunSpecifiedTests<br/>RunLocalTests<br/>RunAllTestsInOrg |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |                             |          |                                                                        |

## Examples

```shell
sf hardis:org:test:apex
```


