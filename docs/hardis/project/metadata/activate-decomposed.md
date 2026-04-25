<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:metadata:activate-decomposed

## Description


## Command Behavior

**Activate decomposed metadata types in Salesforce DX projects.**

This command helps manage decomposed metadata types that can be split into multiple files in source format. It automatically decomposes all supported metadata types that exist in your project.

Supported metadata types (Beta):

- CustomLabels
- PermissionSet
- ExternalServiceRegistration
- SharingRules
- Workflow

See [Salesforce documentation on decomposed metadata](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_decomposed_md_types.htm)

Key features:

- Automatically detects and decomposes all applicable metadata types
- Decomposes only metadata types that exist in your project
- Interactive confirmation for decomposition operations
- Handles all confirmation prompts automatically

<details markdown="1">
<summary>Technical explanations</summary>

This command utilizes Salesforce CLI's decomposed metadata feature to split complex metadata types into smaller, more manageable components:

- **CustomLabels**: Each custom label becomes a separate file, making it easier to track changes and manage translations.
- **PermissionSets**: Permission sets are decomposed into multiple files based on the permissions they contain (field permissions, object permissions, etc.).
- **ExternalServiceRegistration**: Decomposes external service registrations.
- **SharingRules**: Decomposes sharing rules into individual components.
- **Workflow**: Decomposes workflow rules into individual components.

The command wraps the underlying Salesforce CLI functionality and provides a more user-friendly interface with additional validation and error handling.

Note: All decomposed metadata features are currently in Beta in Salesforce CLI.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:metadata:activate-decomposed --agent
```

In agent mode:

- All applicable metadata types are processed automatically
- The retry prompt for source tracking conflicts is skipped; the command will automatically unset the default org and retry
- All interactive prompts are skipped


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Run command in debug mode||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:metadata:activate-decomposed
```

```shell
$ sf hardis:project:metadata:activate-decomposed --debug
```

```shell
$ sf hardis:project:metadata:activate-decomposed --agent
```


