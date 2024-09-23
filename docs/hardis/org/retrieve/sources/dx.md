<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:retrieve:sources:dx

## Description

Retrieve Salesforce DX project from org

## Parameters

| Name                     |  Type   | Description                                                                        | Default | Required | Options |
|:-------------------------|:-------:|:-----------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d             | boolean | Activate debug mode (more logs)                                                    |         |          |         |
| filteredmetadatas<br/>-m | option  | Comma separated list of Metadatas keys to remove from PackageXml file              |         |          |         |
| flags-dir                | option  | undefined                                                                          |         |          |         |
| folder<br/>-f            | option  | Folder                                                                             |    .    |          |         |
| instanceurl<br/>-r       | option  | URL of org instance                                                                |         |          |         |
| json                     | boolean | Format output as json.                                                             |         |          |         |
| keepmetadatatypes<br/>-k | option  | Comma separated list of metadatas types that will be the only ones to be retrieved |         |          |         |
| shape<br/>-o             | boolean | Updates project-scratch-def.json from org shape                                    |         |          |         |
| skipauth                 | boolean | Skip authentication check when a default username is required                      |         |          |         |
| target-org<br/>-o        | option  | undefined                                                                          |         |          |         |
| tempfolder<br/>-t        | option  | Temporary folder                                                                   |  ./tmp  |          |         |
| websocket                | option  | Websocket host:port for VsCode SFDX Hardis UI integration                          |         |          |         |

## Examples

```shell
sf hardis:org:retrieve:sources:dx
```


