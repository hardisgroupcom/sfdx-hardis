<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:resetselection

## Description

Resets the selection that we want to add in the merge request

Calls a soft git reset behind the hood  


## Parameters

| Name              |  Type   | Description                                                   |           Default           | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:---------------------------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |                             |          |         |
| flags-dir         | option  | undefined                                                     |                             |          |         |
| json              | boolean | Format output as json.                                        |                             |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |                             |          |         |
| target-org<br/>-o | option  | undefined                                                     | <synefo@advisopartners.com> |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |                             |          |         |

## Examples

```shell
sf hardis:work:resetsave
```


