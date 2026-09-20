<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:function:list

## Description


## Command Behavior

**Lists the custom functions declared in the project configuration.**

Each function shows its id (the deployment action type to use), its label, its runtime, its script, and its input and output contract.

With `--check-runtimes`, the command also reports whether the interpreter each function needs is available on the current machine. Use it in a validation job to catch a missing `python` on a runner before a deployment fails on it.

The `--json` output carries the full definitions, which is what the VS Code extension reads to populate the deployment action editor.

### Agent Mode

This command is read-only and never prompts, so it already runs headless. `--agent` is accepted for consistency with the other commands.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads `customFunctions` from `config/.sfdx-hardis.yml`.
- `--check-runtimes` resolves each interpreter the same way the action does at run time.
</details>


## Parameters

| Name           |  Type   | Description                                                            | Default | Required | Options |
|:---------------|:-------:|:-----------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent          | boolean | Run in non-interactive mode for agents and automation                  |         |          |         |
| check-runtimes | boolean | Also report whether each function runtime is available on this machine |         |          |         |
| debug<br/>-d   | boolean | Activate debug mode (more logs)                                        |         |          |         |
| flags-dir      | option  | undefined                                                              |         |          |         |
| json           | boolean | Format output as json.                                                 |         |          |         |
| websocket      | option  | Websocket host:port for VsCode SFDX Hardis UI integration              |         |          |         |

## Examples

```shell
$ sf hardis:project:function:list
```

```shell
$ sf hardis:project:function:list --json
```

```shell
$ sf hardis:project:function:list --check-runtimes
```


