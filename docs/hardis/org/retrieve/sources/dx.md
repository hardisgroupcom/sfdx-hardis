<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:retrieve:sources:dx

## Description

Retrieve Salesforce DX project from org

## Parameters

| Name                     |  Type   | Description                                                                        | Default | Required |                        Options                        |
|:-------------------------|:-------:|:-----------------------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion               | option  | override the api version used for api requests made by this command                |         |          |                                                       |
| debug<br/>-d             | boolean | Activate debug mode (more logs)                                                    |         |          |                                                       |
| filteredmetadatas<br/>-m | option  | Comma separated list of Metadatas keys to remove from PackageXml file              |         |          |                                                       |
| folder<br/>-f            | option  | Folder                                                                             |    .    |          |                                                       |
| instanceurl<br/>-r       | option  | URL of org instance                                                                |         |          |                                                       |
| json                     | boolean | format output as json                                                              |         |          |                                                       |
| keepmetadatatypes<br/>-k | option  | Comma separated list of metadatas types that will be the only ones to be retrieved |         |          |                                                       |
| loglevel                 | option  | logging level for this command invocation                                          |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| shape<br/>-o             | boolean | Updates project-scratch-def.json from org shape                                    |         |          |                                                       |
| skipauth                 | boolean | Skip authentication check when a default username is required                      |         |          |                                                       |
| targetusername<br/>-u    | option  | username or alias for the target org; overrides default target org                 |         |          |                                                       |
| tempfolder<br/>-t        | option  | Temporary folder                                                                   |  ./tmp  |          |                                                       |
| websocket                | option  | Websocket host:port for VsCode SFDX Hardis UI integration                          |         |          |                                                       |

## Examples

```shell
sf hardis:org:retrieve:sources:dx
```


