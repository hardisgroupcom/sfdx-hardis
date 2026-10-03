<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:list

## Description


## Command Behavior

**Lists deployment actions defined in the project configuration.**

Displays a table of actions for the specified scope and deployment phase, showing position, ID, label, type, and context.

With `--with-status` and `--pr-ids`, it returns instead the status of the actions of these Pull Requests in each org branch, as recorded in their "Deployment Actions" comments: done, failed, not run because a previous action failed, moved to a fix Pull Request, waiting for a manual execution... The VS Code extension reads it to show the status of each action, and to offer **Retry** and **Mark as done** on the failed ones. A git provider token is required.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:action:list --agent --scope branch --when pre-deploy
sf hardis:project:action:list --agent --with-status --pr-ids 123,124 --json
```

Required in agent mode:

- `--scope`, `--when`

<details markdown="1">
<summary>Technical explanations</summary>

- Reads the action list from the YAML config file and displays it as a formatted table.
- Supports `--json` output via SfCommand.
</details>


## Parameters

| Name         |  Type   | Description                                                                                                  | Default | Required |          Options           |
|:-------------|:-------:|:-------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:--------------------------:|
| agent        | boolean | Run in non-interactive mode for agents and automation                                                        |         |          |                            |
| branch       | option  | Target branch name (for branch scope, defaults to current branch)                                            |         |          |                            |
| debug<br/>-d | boolean | Activate debug mode (more logs)                                                                              |         |          |                            |
| flags-dir    | option  | undefined                                                                                                    |         |          |                            |
| json         | boolean | Format output as json.                                                                                       |         |          |                            |
| pr-id        | option  | Pull request ID (for pr scope, defaults to draft)                                                            |         |          |                            |
| pr-ids       | option  | Comma-separated list of Pull Request numbers (with --with-status)                                            |         |          |                            |
| scope        | option  | Configuration scope: project, branch, or pr                                                                  |         |          | project<br/>branch<br/>pr  |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                    |         |          |                            |
| when         | option  | When to run the action: pre-deploy or post-deploy                                                            |         |          | pre-deploy<br/>post-deploy |
| with-status  | boolean | Return the status of the actions of --pr-ids in each org branch, read from their Deployment Actions comments |         |          |                            |

## Examples

```shell
$ sf hardis:project:action:list
```

```shell
$ sf hardis:project:action:list --agent --scope branch --when pre-deploy
```

```shell
$ sf hardis:project:action:list --scope project --when post-deploy --json
```


