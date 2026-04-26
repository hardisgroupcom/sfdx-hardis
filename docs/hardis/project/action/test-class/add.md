<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:test-class:add

## Description


## Command Behavior

**Adds one or more Apex test classes to the deployment test class list for the project configuration.**

Requires `enableDeploymentApexTestClasses: true` in `config/.sfdx-hardis.yml`. If the feature is not activated, the command stops with an error.

In interactive mode, discovers all Apex test classes available in the repository sources and lets the user select the ones to add.

In agent mode, requires `--class-name` (can be specified multiple times to add several classes at once) and validates that each class exists in the repository sources.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:action:test-class:add --agent --scope pr --class-name MyTestClass_Test --class-name AnotherTest_Test
```

Required in agent mode:

- `--scope`, `--class-name` (one or more)

Defaults applied: validates each class exists in sources before adding.

<details markdown="1">
<summary>Technical explanations</summary>

- Discovers test classes by scanning `.cls` files for the `@IsTest` annotation using `getApexTestClasses()`.
- Reads and writes `deploymentApexTestClasses` in the YAML config file at the selected scope.
- Skips duplicates silently after logging a warning.
</details>


## Parameters

| Name         |  Type   | Description                                                                              | Default | Required |          Options          |
|:-------------|:-------:|:-----------------------------------------------------------------------------------------|:-------:|:--------:|:-------------------------:|
| agent        | boolean | Run in non-interactive mode for agents and automation                                    |         |          |                           |
| branch       | option  | Target branch name (for branch scope, defaults to current branch)                        |         |          |                           |
| class-name   | option  | Apex test class name(s) to add (required in agent mode; can be specified multiple times) |         |          |                           |
| debug<br/>-d | boolean | Activate debug mode (more logs)                                                          |         |          |                           |
| flags-dir    | option  | undefined                                                                                |         |          |                           |
| json         | boolean | Format output as json.                                                                   |         |          |                           |
| pr-id        | option  | Pull request ID (for pr scope, defaults to draft)                                        |         |          |                           |
| scope        | option  | Configuration scope: project, branch, or pr                                              |         |          | project<br/>branch<br/>pr |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                |         |          |                           |

## Examples

```shell
$ sf hardis:project:action:test-class:add
```

```shell
$ sf hardis:project:action:test-class:add --agent --scope pr --class-name MyTest_Test
```

```shell
$ sf hardis:project:action:test-class:add --agent --scope project --class-name FooTest --class-name BarTest
```


