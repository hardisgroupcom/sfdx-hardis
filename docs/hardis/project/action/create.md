<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:create

## Description


## Command Behavior

**Creates a new deployment action in the project configuration.**

Deployment actions are pre- or post-deployment steps that run automatically during CI/CD pipelines. This command lets you define new actions of various types (shell command, data import, Apex script, community publish, manual instructions, or batch scheduling) and store them at project, branch, or pull request scope.

New actions are appended to the end of the action list. Use `hardis:project:action:reorder` to change position.

The action ID is auto-generated using UUID.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:action:create --agent --scope branch --when pre-deploy --type command --label "Disable triggers" --command "sf data update record --sobject User --where \"Name='Admin'\" --values \"TriggerEnabled__c=false\""
```

Required in agent mode:

- `--scope`, `--when`, `--type`, `--label`
- Type-specific flags: `--command` for command, `--apex-script` for apex, `--sfdmu-project` for data, `--community-name` for publish-community, `--instructions` for manual, `--class-name` and `--cron-expression` for schedule-batch

In agent mode, `--context` defaults to `all` and optional boolean flags default to `false`.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads and writes YAML config files using `js-yaml` and `fs-extra`.
- Validates that referenced files (Apex scripts) and workspaces (SFDMU projects) exist before saving.
- Generates action ID with `crypto.randomUUID()`.
- Supports three config scopes: project (`config/.sfdx-hardis.yml`), branch (`config/branches/.sfdx-hardis.<branch>.yml`), PR (`scripts/actions/.sfdx-hardis.<prId>.yml`).
</details>


## Parameters

| Name                 |  Type   | Description                                                              | Default | Required |                                    Options                                    |
|:---------------------|:-------:|:-------------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------------------------------:|
| agent                | boolean | Run in non-interactive mode for agents and automation                    |         |          |                                                                               |
| allow-failure        | boolean | Allow action to fail without blocking deployment                         |         |          |                                                                               |
| apex-script          | option  | Path to Apex script file (for apex type)                                 |         |          |                                                                               |
| branch               | option  | Target branch name (for branch scope, defaults to current branch)        |         |          |                                                                               |
| class-name           | option  | Apex batch class name (for schedule-batch type)                          |         |          |                                                                               |
| command              | option  | Shell command to execute (for command type)                              |         |          |                                                                               |
| community-name       | option  | Community name (for publish-community type)                              |         |          |                                                                               |
| context              | option  | Execution context (default: all)                                         |         |          |           all<br/>check-deployment-only<br/>process-deployment-only           |
| cron-expression      | option  | Cron expression (for schedule-batch type)                                |         |          |                                                                               |
| custom-username      | option  | Run action with a specific Salesforce username                           |         |          |                                                                               |
| debug<br/>-d         | boolean | Activate debug mode (more logs)                                          |         |          |                                                                               |
| flags-dir            | option  | undefined                                                                |         |          |                                                                               |
| instructions         | option  | Manual instructions text (for manual type)                               |         |          |                                                                               |
| job-name             | option  | Job name for schedule-batch (optional, defaults to <className>_Schedule) |         |          |                                                                               |
| json                 | boolean | Format output as json.                                                   |         |          |                                                                               |
| label                | option  | Human-readable label for the action                                      |         |          |                                                                               |
| pr-id                | option  | Pull request ID (for pr scope, defaults to draft)                        |         |          |                                                                               |
| run-only-once-by-org | boolean | Execute action only once per target org                                  |         |          |                                                                               |
| scope                | option  | Configuration scope: project, branch, or pr                              |         |          |                           project<br/>branch<br/>pr                           |
| sfdmu-project        | option  | SFDMU workspace name (for data type)                                     |         |          |                                                                               |
| skip-if-error        | boolean | Skip action if deployment failed                                         |         |          |                                                                               |
| type                 | option  | Type of action                                                           |         |          | command<br/>data<br/>apex<br/>publish-community<br/>manual<br/>schedule-batch |
| websocket            | option  | Websocket host:port for VsCode SFDX Hardis UI integration                |         |          |                                                                               |
| when                 | option  | When to run the action: pre-deploy or post-deploy                        |         |          |                          pre-deploy<br/>post-deploy                           |

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


