<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:audit:apiversion

## Description

Audit API version

## Parameters

| Name                     |  Type   | Description                                                   | Default | Required | Options |
|:-------------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d             | boolean | Activate debug mode (more logs)                               |         |          |         |
| failiferror<br/>-f       | boolean | Fails (exit code 1) if an error is found                      |         |          |         |
| flags-dir                | option  | undefined                                                     |         |          |         |
| json                     | boolean | Format output as json.                                        |         |          |         |
| minimumapiversion<br/>-m | option  | Minimum allowed API version                                   |   20    |          |         |
| skipauth                 | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket                | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
sf hardis:project:audit:apiversion
```


