<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:test:apex

## Description

Run apex tests in Salesforce org

If following configuration is defined, it will fail if apex coverage target is not reached:

- Env `APEX_TESTS_MIN_COVERAGE_ORG_WIDE` or `.sfdx-hardis` property `apexTestsMinCoverageOrgWide`
- Env `APEX_TESTS_MIN_COVERAGE_ORG_WIDE` or `.sfdx-hardis` property `apexTestsMinCoverageOrgWide`

In a monitoring job, failing tests or a coverage under the target do not fail the job: the result is in the notification and the reports. Everywhere else, the command exits with code 1.

You can override env var SFDX_TEST_WAIT_MINUTES to wait more than 120 minutes.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-apex-tests/) and can output Grafana, Slack and MsTeams Notifications.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:test:apex --agent
```

In agent mode, all interactive prompts are skipped and default values are used.



## Parameters

| Name              |  Type   | Description                                                                                                  |    Default    | Required |                                Options                                 |
|:------------------|:-------:|:-------------------------------------------------------------------------------------------------------------|:-------------:|:--------:|:----------------------------------------------------------------------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                        |               |          |                                                                        |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                              |               |          |                                                                        |
| flags-dir         | option  | Import flag values from a directory.                                                                         |               |          |                                                                        |
| json              | boolean | Format output as json.                                                                                       |               |          |                                                                        |
| skipauth          | boolean | Skip authentication check when a default username is required                                                |               |          |                                                                        |
| target-org<br/>-o | option  | Username or alias of the target org. Not required if the `target-org` configuration variable is already set. |               |   true   |                                                                        |
| testlevel<br/>-l  | option  | Level of tests to apply to validate deployment                                                               | RunLocalTests |          | NoTestRun<br/>RunSpecifiedTests<br/>RunLocalTests<br/>RunAllTestsInOrg |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                    |               |          |                                                                        |

## Examples

```shell
$ sf hardis:org:test:apex
```

```shell
$ sf hardis:org:test:apex --agent
```


