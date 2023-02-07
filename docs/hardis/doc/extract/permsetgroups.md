<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:extract:permsetgroups

## Description

Generate markdown files with project documentation

## Parameters

| Name              |  Type   | Description                                                       | Default | Required |                        Options                        |
|:------------------|:-------:|:------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                   |         |          |                                                       |
| json              | boolean | format output as json                                             |         |          |                                                       |
| loglevel          | option  | logging level for this command invocation                         |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| outputfile<br/>-o | option  | Force the path and name of output report file. Must end with .csv |         |          |                                                       |
| skipauth          | boolean | Skip authentication check when a default username is required     |         |          |                                                       |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |         |          |                                                       |

## Examples

```shell
sfdx hardis:doc:extract:permsetgroups
```


