<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:data:delete

## Description

Delete records in multiple objects using SFDMU Workspace
  
If you need to run this command in production, you need to:

- define runnableInProduction in export.json
- define sfdmuCanModify: YOUR_INSTANCE_URL in config/branches/.sfdx-hardis.YOUR_BRANCH.yml


## Parameters

| Name              |  Type   | Description                                                   |           Default            | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:----------------------------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |                              |          |         |
| flags-dir         | option  | undefined                                                     |                              |          |         |
| json              | boolean | Format output as json.                                        |                              |          |         |
| path<br/>-p       | option  | Path to the sfdmu workspace folder                            |                              |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |                              |          |         |
| target-org<br/>-o | option  | undefined                                                     | hardis@cityone.fr.intfluxne2 |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |                              |          |         |

## Examples

```shell
sf hardis:org:data:delete
```


