<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:convert:profilestopermsets

## Description

Creates permission sets from existing profiles, with id PS_PROFILENAME

## Parameters

| Name          |  Type   | Description                                                   | Default | Required | Options |
|:--------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d  | boolean | Activate debug mode (more logs)                               |         |          |         |
| except<br/>-e | option  | List of filters                                               |         |          |         |
| flags-dir     | option  | undefined                                                     |         |          |         |
| json          | boolean | Format output as json.                                        |         |          |         |
| skipauth      | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
sf hardis:project:convert:profilestopermsets
```


