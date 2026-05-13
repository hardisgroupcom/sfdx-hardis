<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:test-class:remove

## Description


## Command Behavior

**Removes one or more Apex test classes from the deployment test class list for the project configuration.**

Requires `enableDeploymentApexTestClasses: true` in `config/.sfdx-hardis.yml`. If the feature is not activated, the command stops with an error.

In interactive mode, shows the currently configured test classes and lets the user select which ones to remove.

In agent mode, requires `--class-name` (can be specified multiple times) or `--all-class` to clear the entire list.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:action:test-class:remove --agent --scope pr --class-name MyTestClass_Test
sf hardis:project:action:test-class:remove --agent --scope project --all-class
```

Required in agent mode:

- `--scope`
- `--class-name` (one or more) OR `--all-class`

<details markdown="1">
<summary>Technical explanations</summary>

- Reads and writes `deploymentApexTestClasses` in the YAML config file at the selected scope.
- `--all-class` clears the entire list for the given scope.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|all-class|boolean|Remove all Apex test classes from the list (clears the entire list for the scope)||||
|branch|option|Target branch name (for branch scope, defaults to current branch)||||
|class-name|option|Apex test class name(s) to remove (can be specified multiple times)||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|pr-id|option|Pull request ID (for pr scope, defaults to draft)||||
|scope|option|Configuration scope: project, branch, or pr|||project<br/>branch<br/>pr|
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:action:test-class:remove
```

```shell
$ sf hardis:project:action:test-class:remove --agent --scope pr --class-name MyTest_Test
```

```shell
$ sf hardis:project:action:test-class:remove --agent --scope pr --class-name FooTest --class-name BarTest
```

```shell
$ sf hardis:project:action:test-class:remove --agent --scope project --all-class
```


