<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:auth:login

## Description

Login to salesforce org

## Parameters

| Name               |  Type   | Description                                                   | Default | Required |                        Options                        |
|:-------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| debug<br/>-d       | boolean | Activate debug mode (more logs)                               |         |          |                                                       |
| devhub<br/>-h      | boolean | Also connect associated DevHub                                |         |          |                                                       |
| instanceurl<br/>-r | option  | URL of org instance                                           |         |          |                                                       |
| json               | boolean | format output as json                                         |         |          |                                                       |
| loglevel           | option  | logging level for this command invocation                     |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| scratchorg<br/>-s  | boolean | Scratch org                                                   |         |          |                                                       |
| skipauth           | boolean | Skip authentication check when a default username is required |         |          |                                                       |
| websocket          | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |                                                       |

## Examples

```shell
$ sfdx hardis:auth:login
```


