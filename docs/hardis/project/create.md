<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:create

## Description

Create a new SFDX Project

## Command Behavior

**Creates and initializes a new Salesforce DX project with sfdx-hardis configuration.**

This command automates the setup of a new SFDX project, including git repository initialization, DevHub connection, project naming, development branch configuration, and default auto-clean types.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Git Repository:** Ensures a git repository exists or clones one.
- **DevHub Selection:** Prompts for the type of development orgs (scratch, sandbox, or both) and connects to DevHub if needed.
- **Project Generation:** Creates a new SFDX project using `sf project generate` if one doesn't already exist.
- **Default Files:** Copies default CI/CD configuration files from the package defaults.
- **Configuration:** Sets project name, development branch, and auto-clean types in `.sfdx-hardis.yml`.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:create --agent
```

In agent mode:

- The DevHub type prompt is skipped; defaults to `scratch`.
- The project name prompt is skipped; the project name must already be set in config or an error is thrown.
- The development branch prompt is skipped; defaults to `integration`.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:create
```

```shell
$ sf hardis:project:create --agent
```


