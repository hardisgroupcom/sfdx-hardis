<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:emptyitems

## Description

Remove unwanted empty items within sfdx project sources

## Parameters

| Name          |  Type   | Description                                                   |  Default  | Required |                        Options                        |
|:--------------|:-------:|:--------------------------------------------------------------|:---------:|:--------:|:-----------------------------------------------------:|
| debug<br/>-d  | boolean | Activate debug mode (more logs)                               |           |          |                                                       |
| folder<br/>-f | option  | Root folder                                                   | force-app |          |                                                       |
| json          | boolean | format output as json                                         |           |          |                                                       |
| loglevel      | option  | logging level for this command invocation                     |   warn    |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| skipauth      | boolean | Skip authentication check when a default username is required |           |          |                                                       |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |           |          |                                                       |

## Examples

```shell
$ sfdx hardis:project:clean:emptyitems
```


