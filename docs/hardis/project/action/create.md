<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:create

## Description


## Command Behavior

**Creates a new deployment action in the project configuration.**

Deployment actions are pre- or post-deployment steps that run automatically during CI/CD pipelines. This command lets you define new actions of various types (shell command, data import, Apex script, community publish, manual instructions, batch scheduling, immediate batch run, or package.xml items removal) and store them at project, branch, or pull request scope.

New actions are appended to the end of the action list. Use `hardis:project:action:reorder` to change position.

The action ID is auto-generated using UUID.

### Target branches

An action runs on every target branch by default. To restrict it, set one of the two mutually exclusive lists:

- `includeTargetBranches`: the action only runs when the deployment targets one of these branches
- `excludeTargetBranches`: the action runs everywhere except on these branches

Branch names are matched exactly, ignoring case. The virtual name `dev-sandboxes` matches any target that is not a major branch declared in `config/branches`: a developer sandbox reached by `hardis:work:backpromote`, or a local deployment from a feature branch.

```yaml
commandsPostDeploy:
  - id: 6e9749de-d7e7-4e44-8742-f8cae3e2142e
    label: Publish the customer community
    type: publish-community
    parameters:
      communityName: Customer
    excludeTargetBranches:
      - dev-sandboxes
```

When an action does not apply to the branch being deployed, it is reported as skipped in the Pull Request comment, with the reason.

### Run a batch

A `run-batch` action runs a `Database.Batchable` Apex class once, before or after the metadata deployment. A pre-deploy batch needs its class to be in the target org already.

- `runMode: wait` (default) follows the job until it ends. The action fails when the job fails, is aborted, has batches in error, or is not over after `waitTimeoutMinutes` (60 by default).
- `successEvenIfBatchErrors: true` keeps the action successful when the job completes with batches in error.
- `runMode: no-wait` launches the batch and goes on with the deployment.
- No batch is launched when a job of the class is still running, or completed less than 3 hours ago with a result the action accepts: that job stands for this run.

A run-batch action only runs in the `process-deployment-only` context, never during a deployment check.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:action:create --agent --scope branch --when pre-deploy --type command --label "Disable triggers" --command "sf data update record --sobject User --where \"Name='Admin'\" --values \"TriggerEnabled__c=false\""
```

Required in agent mode:

- `--scope`, `--when`, `--type`, `--label`
- Type-specific flags: `--command` for command, `--apex-script` for apex, `--sfdmu-project` for data, `--community-name` for publish-community, `--instructions` for manual, `--class-name` and `--cron-expression` for schedule-batch, `--class-name` for run-batch (`--run-mode` defaults to `wait`), `--packagexml-items` for remove-packagexml-items

In agent mode, `--context` defaults to `process-deployment-only`. `--run-only-once-by-org` defaults to `true` (use `--no-run-only-once-by-org` to disable); other optional boolean flags default to `false`.

Use `--include-target-branches` or `--exclude-target-branches` (comma-separated, mutually exclusive) to restrict the action to some target branches. Without either flag, the action runs on all of them.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads and writes YAML config files using `js-yaml` and Node.js `fs`.
- Validates that referenced files (Apex scripts) and workspaces (SFDMU projects) exist before saving.
- Generates action ID with `crypto.randomUUID()`.
- Supports three config scopes: project (`config/.sfdx-hardis.yml`), branch (`config/branches/.sfdx-hardis.<branch>.yml`), PR (`scripts/actions/.sfdx-hardis.<prId>.yml`).
</details>


## Parameters

| Name                         |  Type   | Description                                                                                                                                                                                                              | Default | Required |                          Options                          |
|:-----------------------------|:-------:|:-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:---------------------------------------------------------:|
| agent                        | boolean | Run in non-interactive mode for agents and automation                                                                                                                                                                    |         |          |                                                           |
| allow-failure                | boolean | Allow action to fail without blocking deployment                                                                                                                                                                         |         |          |                                                           |
| apex-script                  | option  | Path to Apex script file (for apex type)                                                                                                                                                                                 |         |          |                                                           |
| batch-size                   | option  | Batch size for run-batch type (optional, 1 to 2000, defaults to 200)                                                                                                                                                     |         |          |                                                           |
| branch                       | option  | Target branch name (for branch scope, defaults to current branch)                                                                                                                                                        |         |          |                                                           |
| class-name                   | option  | Apex batch class name (for schedule-batch and run-batch types). Write a global class of a managed package with its namespace: ns.ClassName                                                                               |         |          |                                                           |
| command                      | option  | Shell command to execute (for command type)                                                                                                                                                                              |         |          |                                                           |
| community-name               | option  | Community name (for publish-community type)                                                                                                                                                                              |         |          |                                                           |
| context                      | option  | Execution context (default: process-deployment-only)                                                                                                                                                                     |         |          | all<br/>check-deployment-only<br/>process-deployment-only |
| cron-expression              | option  | Cron expression (for schedule-batch type)                                                                                                                                                                                |         |          |                                                           |
| custom-username              | option  | Run action with a specific Salesforce username                                                                                                                                                                           |         |          |                                                           |
| debug<br/>-d                 | boolean | Activate debug mode (more logs)                                                                                                                                                                                          |         |          |                                                           |
| exclude-target-branches      | option  | Comma-separated list of target branches the action is skipped on (ex: "main"). Use dev-sandboxes for developer sandboxes. Cannot be combined with --include-target-branches                                              |         |          |                                                           |
| flags-dir                    | option  | Import flag values from a directory.                                                                                                                                                                                     |         |          |                                                           |
| function-input               | option  | Value of a custom function input, as name=value. Repeat the flag once per input                                                                                                                                          |         |          |                                                           |
| include-target-branches      | option  | Comma-separated list of target branches the action runs on (ex: "uat,preprod"). Use dev-sandboxes for developer sandboxes. Cannot be combined with --exclude-target-branches                                             |         |          |                                                           |
| instructions                 | option  | Manual instructions text (for manual type)                                                                                                                                                                               |         |          |                                                           |
| job-name                     | option  | Job name for schedule-batch (optional, defaults to <className>_Schedule)                                                                                                                                                 |         |          |                                                           |
| json                         | boolean | Format output as json.                                                                                                                                                                                                   |         |          |                                                           |
| label                        | option  | Human-readable label for the action                                                                                                                                                                                      |         |          |                                                           |
| packagexml-items             | option  | Semicolon-separated list of package.xml items to remove before deployment, each in format TypeName:Member1,Member2 (for remove-packagexml-items type). Example: "ApexClass:MyClass1,MyClass3;Layout:MyLayout1,MyLayout2" |         |          |                                                           |
| pr-id                        | option  | Pull request ID (for pr scope, defaults to draft)                                                                                                                                                                        |         |          |                                                           |
| run-mode                     | option  | For run-batch type: wait for the batch to succeed, or launch it without waiting for its result (default: wait)                                                                                                           |         |          |                     wait<br/>no-wait                      |
| run-only-once-by-org         | boolean | Execute action only once per target org (default: true)                                                                                                                                                                  |         |          |                                                           |
| scope                        | option  | Configuration scope: project, branch, or pr                                                                                                                                                                              |         |          |                 project<br/>branch<br/>pr                 |
| sfdmu-project                | option  | SFDMU workspace name (for data type)                                                                                                                                                                                     |         |          |                                                           |
| success-even-if-batch-errors | boolean | For run-batch type in wait mode: keep the action successful when the batch completes with errors                                                                                                                         |         |          |                                                           |
| type                         | option  | Type of action: a built-in type (command, data, apex, publish-community, manual, schedule-batch, run-batch, remove-packagexml-items) or the id of a project custom function                                              |         |          |                                                           |
| wait-timeout                 | option  | Minutes to wait for the batch of a run-batch action in wait mode (optional, defaults to 60)                                                                                                                              |         |          |                                                           |
| websocket                    | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                                                |         |          |                                                           |
| when                         | option  | When to run the action: pre-deploy or post-deploy                                                                                                                                                                        |         |          |                pre-deploy<br/>post-deploy                 |

## Examples

```shell
$ sf hardis:project:action:create
```

```shell
$ sf hardis:project:action:create --agent --scope branch --when pre-deploy --type command --label "Disable triggers" --command "sf apex run --file scripts/disable-triggers.apex"
```

```shell
$ sf hardis:project:action:create --agent --scope pr --pr-id 123 --when post-deploy --type data --label "Import test data" --sfdmu-project TestData
```

```shell
$ sf hardis:project:action:create --agent --scope pr --pr-id 123 --when pre-deploy --type remove-packagexml-items --label "Skip legacy classes" --packagexml-items "ApexClass:MyClass1,MyClass3;Layout:MyLayout1,MyLayout2"
```

```shell
$ sf hardis:project:action:create --agent --scope pr --pr-id 123 --when post-deploy --type run-batch --label "Recalculate crew capacity" --class-name CrewCapacityBatch --run-mode wait --wait-timeout 30
```

```shell
$ sf hardis:project:action:create --agent --scope project --when post-deploy --type apex --label "Reset demo data" --apex-script scripts/apex/reset-demo.apex --exclude-target-branches "main,preprod"
```


