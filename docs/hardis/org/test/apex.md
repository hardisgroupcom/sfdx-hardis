<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:test:apex

## Description

Run apex tests in Salesforce org

If following configuration is defined, it will fail if apex coverage target is not reached:

- Env `APEX_TESTS_MIN_COVERAGE_ORG_WIDE` or `.sfdx-hardis` property `apexTestsMinCoverageOrgWide`
- Env `APEX_TESTS_MIN_COVERAGE_ORG_WIDE` or `.sfdx-hardis` property `apexTestsMinCoverageOrgWide`

In a monitoring job, failing tests or a coverage under the target do not fail the job: the result is in the notification and the reports. A test run that stops without a result (expired session, timeout, network errors) still fails it. Everywhere else, the command exits with code 1.

You can override env var SFDX_TEST_WAIT_MINUTES to wait more than 120 minutes.

## Command Behavior

- Starts the Apex tests asynchronously, then checks every 30 seconds whether the test run is over.
- Network errors while talking to the org (for example `fetch failed` during a long nightly run) are retried, so a short outage does not fail the job.
- If the test run does not end in time, or if its results cannot be retrieved, the notification says so with the test run id, and no failing classes or coverage are sent, instead of reporting failed tests and a 0% coverage.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-apex-tests/) and can output Grafana, Slack and MsTeams Notifications.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:test:apex --agent
```

In agent mode, all interactive prompts are skipped and default values are used.

<details markdown="1">
<summary>Technical explanations</summary>

- Runs `sf apex run test --test-level <level> --code-coverage --json` without `--wait` to get the test run id.
- Polls `ApexTestRunResult.Status` until the run is over, within `SFDX_TEST_WAIT_MINUTES` (default 120, also used when the value is not a positive integer).
- Downloads results with `sf apex get test --test-run-id <id> --code-coverage --result-format human --output-dir <reportDir>`.
- Transient network errors (`fetch failed`, `ECONNRESET`, `ETIMEDOUT`, `socket hang up`...) are retried on every call to the org.
- The download of the results is retried up to 4 times, 30 seconds apart, as long as it returns no test outcome.

</details>


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


