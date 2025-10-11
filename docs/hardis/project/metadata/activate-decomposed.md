<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:metadata:activate-decomposed

## Description

**Activate decomposed metadata types in Salesforce DX projects.**

This command helps manage decomposed metadata types that can be split into multiple files in source format. It automatically decomposes all supported metadata types that exist in your project.

Supported metadata types (Beta):
- CustomLabels
- PermissionSet
- ExternalServiceRegistration
- SharingRules
- Workflow

Key features:
- Automatically detects and decomposes all applicable metadata types
- Decomposes only metadata types that exist in your project
- Interactive confirmation for decomposition operations
- Handles all confirmation prompts automatically

## Parameters

| Name         |  Type   | Description                                                   | Default | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d | boolean | Run command in debug mode                                     |  false  |          |         |
| json         | boolean | Format output as json.                                        |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:project:metadata:activate-decomposed
```

```shell
$ sf hardis:project:metadata:activate-decomposed --debug
```
