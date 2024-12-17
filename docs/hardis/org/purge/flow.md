<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:purge:flow

## Description

Purge Obsolete flow versions to avoid the 50 max versions limit. Filters on Status and Name

## Parameters

| Name                          |  Type   | Description                                                                                                              |            Default             | Required | Options |
|:------------------------------|:-------:|:-------------------------------------------------------------------------------------------------------------------------|:------------------------------:|:--------:|:-------:|
| allowpurgefailure<br/>-f      | boolean | Allows purges to fail without exiting with 1. Use --no-allowpurgefailure to disable                                      |                                |          |         |
| debug<br/>-d                  | boolean | Activate debug mode (more logs)                                                                                          |                                |          |         |
| delete-flow-interviews<br/>-w | boolean | If the presence of Flow interviews prevent to delete flows versions, delete them before retrying to delete flow versions |                                |          |         |
| flags-dir                     | option  | undefined                                                                                                                |                                |          |         |
| instanceurl<br/>-r            | option  | URL of org instance                                                                                                      | <https://login.salesforce.com> |          |         |
| json                          | boolean | Format output as json.                                                                                                   |                                |          |         |
| name<br/>-n                   | option  | Filter according to Name criteria                                                                                        |                                |          |         |
| prompt<br/>-z                 | boolean | Prompt for confirmation (true by default, use --no-prompt to skip)                                                       |                                |          |         |
| skipauth                      | boolean | Skip authentication check when a default username is required                                                            |                                |          |         |
| status<br/>-s                 | option  | Filter according to Status criteria                                                                                      |                                |          |         |
| target-org<br/>-o             | option  | undefined                                                                                                                |  hardis@cityone.fr.intfluxne2  |          |         |
| websocket                     | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                |                                |          |         |

## Examples

```shell
sf hardis:org:purge:flow
```

```shell
sf hardis:org:purge:flow --target-org nicolas.vuillamy@gmail.com --no-prompt --delete-flow-interviews
```

```shell
sf hardis:org:purge:flow --target-org nicolas.vuillamy@gmail.com --status "Obsolete,Draft,InvalidDraft" --name TestFlow
```


