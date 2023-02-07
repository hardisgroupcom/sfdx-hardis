<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:config:get

## Description

Returns sfdx-hardis project config for a given level

## Parameters

| Name         |  Type   | Description                                                   | Default | Required |                        Options                        |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |                                                       |
| json         | boolean | format output as json                                         |         |          |                                                       |
| level<br/>-l | option  | project,branch or user                                        | project |          |              project<br/>branch<br/>user              |
| loglevel     | option  | logging level for this command invocation                     |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |                                                       |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |                                                       |

## Examples

```shell
sfdx hardis:project:deploy:sources:metadata
```


