<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:configure:monitoring

## Description

Configure monitoring of an org

## Parameters

| Name              |  Type   | Description                                                   |           Default            | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:----------------------------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |                              |          |         |
| flags-dir         | option  | undefined                                                     |                              |          |         |
| json              | boolean | Format output as json.                                        |                              |          |         |
| orginstanceurl    | option  | Org instance url (technical param, do not use manually)       |                              |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |                              |          |         |
| target-org<br/>-o | option  | undefined                                                     | hardis@cityone.fr.intfluxne2 |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |                              |          |         |

## Examples

```shell
sf hardis:org:configure:monitoring
```


