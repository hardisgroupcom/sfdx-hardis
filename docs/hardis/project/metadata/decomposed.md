<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:metadata:decomposed

## Description

**Manage decomposed metadata types in Salesforce DX projects.**

This command helps manage decomposed metadata types such as CustomLabels and PermissionSet that can be split into multiple files in source format.

Key features:
- Decompose CustomLabels into individual files using decomposeCustomLabelsBeta2 behavior
- Decompose PermissionSets using the decomposePermissionSetBeta2 behavior
- Interactive confirmation for decomposition operations

## Parameters

| Name                  |  Type   | Description                                                   | Default                | Required | Options                                              |
|:----------------------|:-------:|:--------------------------------------------------------------|:----------------------:|:--------:|:----------------------------------------------------:|
| behavior<br/>-b       | option  | Decomposition behavior to use                                 |                        | true     | decomposePermissionSetBeta2, decomposeCustomLabelsBeta2 |
| auto-confirm<br/>-y   | boolean | Automatically confirm decomposition without prompting         | false                  |          |                                                      |
| debug<br/>-d          | boolean | Run command in debug mode                                     | false                  |          |                                                      |
| json                  | boolean | Format output as json.                                        |                        |          |                                                      |
| skipauth              | boolean | Skip authentication check when a default username is required |                        |          |                                                      |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |                        |          |                                                      |

## Examples

```shell
$ sf hardis:project:metadata:decomposed --behavior decomposePermissionSetBeta2
```

```shell
$ sf hardis:project:metadata:decomposed --behavior decomposeCustomLabelsBeta2 --auto-confirm
```
