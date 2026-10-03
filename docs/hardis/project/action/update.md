<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:update

## Description


## Command Behavior

**Updates an existing deployment action in the project configuration.**

Allows modifying any field of an existing action, including changing its type (which requires providing new type-specific parameters). Only the fields you specify are updated; all other fields remain unchanged.

The target branch restriction (`includeTargetBranches` / `excludeTargetBranches`) can also be changed here. The two lists are mutually exclusive: setting one clears the other. Pass an empty value to a flag to remove the restriction and run the action on every target branch again.

### Fix an action that failed after its deployment

When an action of a merged Pull Request fails because its definition is wrong, move it to a fix Pull Request with `--move-to-pr`: the action keeps its id, leaves the file of its original Pull Request, and is added to the file of the fix Pull Request (`current`, `draft` or a number) with `movedFrom` set to the original Pull Request number. Correct it there, then merge the fix Pull Request: the action runs from it, and the original Pull Request shows it as moved. An action declared in the description of the original Pull Request cannot be removed from it after the merge: it is copied, and its original version no longer runs.

`--moved-from` sets or changes `movedFrom` by hand (`0` removes it).

See [Recover a failed action](https://sfdx-hardis.cloudity.com/salesforce-devops-work-on-user-story-deployment-actions/#recover-a-failed-action).

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:action:update --agent --scope branch --when pre-deploy --action-id <uuid> --label "Updated label"
```

Required in agent mode:

- `--scope`, `--when`, `--action-id`
- At least one field to update

<details markdown="1">
<summary>Technical explanations</summary>

- Reads the action list from the YAML config file, finds the action by ID, applies updates, validates, and writes back.
- Changing `--type` clears old type-specific parameters and requires new ones.
- `--move-to-pr` requires `--scope pr` and the number of the original Pull Request in `--pr-id`. When the action is not in its YAML file, it is read from the description of the Pull Request through the git provider API.
- A `run-batch` action is updated with `--class-name`, `--run-mode`, `--batch-size`, `--wait-timeout` and `--success-even-if-batch-errors`. It only runs in the `process-deployment-only` context.
</details>

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.github.io) course runs this command, click by click, on an org of your own:

- [Lab 3.3 - Read the deployment log, and what .forceignore hides from it](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-3-deploy-to-integration-and-read-the-log/)

<!-- training-links:end -->


## Parameters

| Name                         |  Type   | Description                                                                                                                                                                     | Default | Required |                          Options                          |
|:-----------------------------|:-------:|:--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:---------------------------------------------------------:|
| action-id                    | option  | ID of the action to update                                                                                                                                                      |         |          |                                                           |
| agent                        | boolean | Run in non-interactive mode for agents and automation                                                                                                                           |         |          |                                                           |
| allow-failure                | boolean | Allow action to fail without blocking deployment                                                                                                                                |         |          |                                                           |
| apex-script                  | option  | New path to Apex script file (for apex type)                                                                                                                                    |         |          |                                                           |
| batch-size                   | option  | Batch size for run-batch type (optional, 1 to 2000, defaults to 200)                                                                                                            |         |          |                                                           |
| branch                       | option  | Target branch name (for branch scope, defaults to current branch)                                                                                                               |         |          |                                                           |
| class-name                   | option  | New Apex batch class name (for schedule-batch and run-batch types). Write a global class of a managed package with its namespace: ns.ClassName                                  |         |          |                                                           |
| command                      | option  | New shell command (for command type)                                                                                                                                            |         |          |                                                           |
| community-name               | option  | New community name (for publish-community type)                                                                                                                                 |         |          |                                                           |
| context                      | option  | New execution context                                                                                                                                                           |         |          | all<br/>check-deployment-only<br/>process-deployment-only |
| cron-expression              | option  | New cron expression (for schedule-batch type)                                                                                                                                   |         |          |                                                           |
| custom-username              | option  | Run action with a specific Salesforce username                                                                                                                                  |         |          |                                                           |
| debug<br/>-d                 | boolean | Activate debug mode (more logs)                                                                                                                                                 |         |          |                                                           |
| exclude-target-branches      | option  | New comma-separated list of target branches the action is skipped on. Pass an empty value to remove the restriction                                                             |         |          |                                                           |
| flags-dir                    | option  | undefined                                                                                                                                                                       |         |          |                                                           |
| function-input               | option  | Value of a custom function input, as name=value. Repeat the flag once per input                                                                                                 |         |          |                                                           |
| include-target-branches      | option  | New comma-separated list of target branches the action runs on. Pass an empty value to remove the restriction                                                                   |         |          |                                                           |
| instructions                 | option  | New manual instructions text (for manual type)                                                                                                                                  |         |          |                                                           |
| job-name                     | option  | New job name for schedule-batch                                                                                                                                                 |         |          |                                                           |
| json                         | boolean | Format output as json.                                                                                                                                                          |         |          |                                                           |
| label                        | option  | New label for the action                                                                                                                                                        |         |          |                                                           |
| move-to-pr                   | option  | Move the action from the Pull Request of --pr-id to this Pull Request (a number, current or draft), keeping its id and setting movedFrom                                        |         |          |                                                           |
| moved-from                   | option  | Number of the Pull Request the action was moved from (0 removes it)                                                                                                             |         |          |                                                           |
| new-when                     | option  | Move the action to the other deployment phase. --when still says where to find it                                                                                               |         |          |                pre-deploy<br/>post-deploy                 |
| packagexml-items             | option  | New semicolon-separated list of package.xml items to remove, each in format TypeName:Member1,Member2 (for remove-packagexml-items type)                                         |         |          |                                                           |
| pr-id                        | option  | Pull request ID (for pr scope, defaults to draft)                                                                                                                               |         |          |                                                           |
| run-mode                     | option  | For run-batch type: wait for the batch to succeed, or launch it without waiting for its result (default: wait)                                                                  |         |          |                     wait<br/>no-wait                      |
| run-only-once-by-org         | boolean | Execute action only once per target org                                                                                                                                         |         |          |                                                           |
| scope                        | option  | Configuration scope: project, branch, or pr                                                                                                                                     |         |          |                 project<br/>branch<br/>pr                 |
| sfdmu-project                | option  | New SFDMU workspace name (for data type)                                                                                                                                        |         |          |                                                           |
| success-even-if-batch-errors | boolean | For run-batch type in wait mode: keep the action successful when the batch completes with errors                                                                                |         |          |                                                           |
| type                         | option  | New type of action: a built-in type (command, data, apex, publish-community, manual, schedule-batch, run-batch, remove-packagexml-items) or the id of a project custom function |         |          |                                                           |
| wait-timeout                 | option  | Minutes to wait for the batch of a run-batch action in wait mode (optional, defaults to 60)                                                                                     |         |          |                                                           |
| websocket                    | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                       |         |          |                                                           |
| when                         | option  | When to run the action: pre-deploy or post-deploy                                                                                                                               |         |          |                pre-deploy<br/>post-deploy                 |

## Examples

```shell
$ sf hardis:project:action:update
```

```shell
$ sf hardis:project:action:update --agent --scope branch --when pre-deploy --action-id abc-123 --label "New label" --context process-deployment-only
```

```shell
$ sf hardis:project:action:update --agent --scope project --when post-deploy --action-id abc-123 --include-target-branches "uat,preprod"
```

```shell
$ sf hardis:project:action:update --agent --scope pr --pr-id 123 --when post-deploy --action-id abc-123 --move-to-pr current
```


