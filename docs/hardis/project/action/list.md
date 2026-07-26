<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:list

## Description


## Command Behavior

**Lists deployment actions defined in the project configuration.**

Displays a table of actions for the specified scope and deployment phase, showing position, ID, label, type, and context.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:action:list --agent --scope branch --when pre-deploy
```

Required in agent mode:

- `--scope`, `--when`

<details markdown="1">
<summary>Technical explanations</summary>

- Reads the action list from the YAML config file and displays it as a formatted table.
- Supports `--json` output via SfCommand.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|branch|option|Target branch name (for branch scope, defaults to current branch)||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|pr-id|option|Pull request ID (for pr scope, defaults to draft)||||
|scope|option|Configuration scope: project, branch, or pr|||project<br/>branch<br/>pr|
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||
|when|option|When to run the action: pre-deploy or post-deploy|||pre-deploy<br/>post-deploy|

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


