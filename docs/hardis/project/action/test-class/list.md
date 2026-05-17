<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:test-class:list

## Description


## Command Behavior

**Lists the Apex test classes configured for deployment in the project configuration.**

Requires `enableDeploymentApexTestClasses: true` in `config/.sfdx-hardis.yml`. If the feature is not activated, the command stops with an error.

Displays the list of `deploymentApexTestClasses` for the specified scope (project, branch, or PR).

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:action:test-class:list --agent --scope project
```

Required in agent mode:

- `--scope`

<details markdown="1">
<summary>Technical explanations</summary>

- Reads `deploymentApexTestClasses` from the YAML config file at the given scope.
- Supports `--json` output via SfCommand.
</details>


## Parameters

| Name         |  Type   | Description                                                       | Default | Required |          Options          |
|:-------------|:-------:|:------------------------------------------------------------------|:-------:|:--------:|:-------------------------:|
| agent        | boolean | Run in non-interactive mode for agents and automation             |         |          |                           |
| branch       | option  | Target branch name (for branch scope, defaults to current branch) |         |          |                           |
| debug<br/>-d | boolean | Activate debug mode (more logs)                                   |         |          |                           |
| flags-dir    | option  | undefined                                                         |         |          |                           |
| json         | boolean | Format output as json.                                            |         |          |                           |
| pr-id        | option  | Pull request ID (for pr scope, defaults to draft)                 |         |          |                           |
| scope        | option  | Configuration scope: project, branch, or pr                       |         |          | project<br/>branch<br/>pr |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |         |          |                           |

## Examples

```shell
$ sf hardis:project:action:test-class:list
```

```shell
$ sf hardis:project:action:test-class:list --agent --scope project
```

```shell
$ sf hardis:project:action:test-class:list --scope pr --pr-id 123 --json
```


