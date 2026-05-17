<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:update

## Description


## Command Behavior

**Updates an existing deployment action in the project configuration.**

Allows modifying any field of an existing action, including changing its type (which requires providing new type-specific parameters). Only the fields you specify are updated; all other fields remain unchanged.

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
</details>


## Parameters

| Name                 |  Type   | Description                                                       | Default | Required |                                    Options                                    |
|:---------------------|:-------:|:------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------------------------------:|
| action-id            | option  | ID of the action to update                                        |         |          |                                                                               |
| agent                | boolean | Run in non-interactive mode for agents and automation             |         |          |                                                                               |
| allow-failure        | boolean | Allow action to fail without blocking deployment                  |         |          |                                                                               |
| apex-script          | option  | New path to Apex script file (for apex type)                      |         |          |                                                                               |
| branch               | option  | Target branch name (for branch scope, defaults to current branch) |         |          |                                                                               |
| class-name           | option  | New Apex batch class name (for schedule-batch type)               |         |          |                                                                               |
| command              | option  | New shell command (for command type)                              |         |          |                                                                               |
| community-name       | option  | New community name (for publish-community type)                   |         |          |                                                                               |
| context              | option  | New execution context                                             |         |          |           all<br/>check-deployment-only<br/>process-deployment-only           |
| cron-expression      | option  | New cron expression (for schedule-batch type)                     |         |          |                                                                               |
| custom-username      | option  | Run action with a specific Salesforce username                    |         |          |                                                                               |
| debug<br/>-d         | boolean | Activate debug mode (more logs)                                   |         |          |                                                                               |
| flags-dir            | option  | undefined                                                         |         |          |                                                                               |
| instructions         | option  | New manual instructions text (for manual type)                    |         |          |                                                                               |
| job-name             | option  | New job name for schedule-batch                                   |         |          |                                                                               |
| json                 | boolean | Format output as json.                                            |         |          |                                                                               |
| label                | option  | New label for the action                                          |         |          |                                                                               |
| pr-id                | option  | Pull request ID (for pr scope, defaults to draft)                 |         |          |                                                                               |
| run-only-once-by-org | boolean | Execute action only once per target org                           |         |          |                                                                               |
| scope                | option  | Configuration scope: project, branch, or pr                       |         |          |                           project<br/>branch<br/>pr                           |
| sfdmu-project        | option  | New SFDMU workspace name (for data type)                          |         |          |                                                                               |
| skip-if-error        | boolean | Skip action if deployment failed                                  |         |          |                                                                               |
| type                 | option  | New type of action                                                |         |          | command<br/>data<br/>apex<br/>publish-community<br/>manual<br/>schedule-batch |
| websocket            | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |         |          |                                                                               |
| when                 | option  | When to run the action: pre-deploy or post-deploy                 |         |          |                          pre-deploy<br/>post-deploy                           |

## Examples

```shell
$ sf hardis:project:action:update
```

```shell
$ sf hardis:project:action:update --agent --scope branch --when pre-deploy --action-id abc-123 --label "New label" --context process-deployment-only
```


