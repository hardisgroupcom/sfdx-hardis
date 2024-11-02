<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:audit:duplicatefiles

## Description

Find duplicate files in sfdx folder (often from past @salesforce/cli bugs)

## Parameters

| Name         |  Type   | Description                                                   |         Default         | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-----------------------:|:--------:|:-------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |                         |          |         |
| flags-dir    | option  | undefined                                                     |                         |          |         |
| json         | boolean | Format output as json.                                        |                         |          |         |
| path<br/>-p  | option  | Root path to check                                            | C:\git\pro\sfdx-hardis2 |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |                         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |                         |          |         |

## Examples

```shell
sf hardis:project:audit:duplicatefiles
```


