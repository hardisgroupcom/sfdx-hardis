<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:lint

## Description

Apply syntactic analysis (linters) on the repository sources, using Mega-Linter

## Parameters

| Name              |  Type   | Description                                                   |           Default           | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:---------------------------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |                             |          |         |
| fix<br/>-f        | boolean | Apply linters fixes                                           |                             |          |         |
| flags-dir         | option  | undefined                                                     |                             |          |         |
| json              | boolean | Format output as json.                                        |                             |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |                             |          |         |
| target-org<br/>-o | option  | undefined                                                     | <synefo@advisopartners.com> |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |                             |          |         |

## Examples

```shell
sf hardis:project:lint
```

```shell
sf hardis:project:lint --fix
```


