<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:misc:purge-references

## Description

Purge references to any string in org metadatas before a deployment.

For example, this can be handy if you need to change the type of a custom field from Master Detail to Lookup.

USE WITH EXTREME CAUTION AND CAREFULLY READ THE MESSAGES !

## Parameters

| Name              |  Type   | Description                                                   |           Default           | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:---------------------------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |                             |          |         |
| flags-dir         | option  | undefined                                                     |                             |          |         |
| json              | boolean | Format output as json.                                        |                             |          |         |
| references<br/>-r | option  | Comma-separated list of references to find in metadatas       |                             |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |                             |          |         |
| target-org<br/>-o | option  | undefined                                                     | <synefo@advisopartners.com> |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |                             |          |         |

## Examples

```shell
sf hardis:misc:purge-references
```


