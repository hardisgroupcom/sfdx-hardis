<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:test:agents

## Description

Run Agentforce agent tests (AiEvaluationDefinition metadata) in a Salesforce org.

## Command Behavior

- **Discovers all agent tests:** Lists every AiEvaluationDefinition available in the org using `sf agent test list`.
- **Runs each test:** Executes `sf agent test run` for each definition and waits for completion (override the wait with env var `SFDX_TEST_WAIT_MINUTES`, default 60 minutes).
- **Aggregates results:** Reports pass/fail at the test-case and assertion level. The command fails (exit code 1) if any assertion does not pass.
- **CSV report:** Generates a report listing every assertion with its expected and actual values.
- **Notifications:** Sends alerts to Grafana, Slack and MS Teams when agent tests fail.

Use `--tests` to run only specific agent tests (comma-separated API names) instead of all of them.

This command requires the `@salesforce/plugin-agent` Salesforce CLI plugin. Install it with `sf plugins install @salesforce/plugin-agent`.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-agent-tests/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

- Calls `sf agent test list --json` to enumerate AiEvaluationDefinition components, then `sf agent test run --api-name <name> --wait <minutes> --json` for each one (synchronous, no polling).
- Parses the `testCases[].testResults[]` array of each run: an assertion passes when its `result` is `PASS`; a test case passes when all its assertions pass.
- A run whose overall status is not `COMPLETED` is treated as an error and flips the notification severity.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:test:agents --agent
```

In agent mode the command runs fully automatically. There are no interactive prompts; the wait time defaults to `SFDX_TEST_WAIT_MINUTES` (60 minutes) and all agent tests found in the org are run unless `--tests` is provided.


## Parameters

| Name              |  Type   | Description                                                                                             | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                   |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                         |         |          |         |
| flags-dir         | option  | undefined                                                                                               |         |          |         |
| json              | boolean | Format output as json.                                                                                  |         |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv                                       |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                           |         |          |         |
| target-org<br/>-o | option  | undefined                                                                                               |         |          |         |
| tests<br/>-t      | option  | Comma-separated list of agent test API names to run. Runs all tests found in the org when not provided. |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                               |         |          |         |

## Examples

```shell
$ sf hardis:org:test:agents
```

```shell
$ sf hardis:org:test:agents --tests Mercury_Referral_Agent_Eval
```

```shell
$ sf hardis:org:test:agents --outputfile ./reports/agent-tests.csv
```

```shell
$ sf hardis:org:test:agents --agent
```


