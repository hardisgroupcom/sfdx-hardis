<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:delete

## Description

Assisted menu to delete scratch orgs associated to a DevHub

## Parameters

| Name                        |  Type   | Description                                                          | Default | Required |                        Options                        |
|:----------------------------|:-------:|:---------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion                  | option  | override the api version used for api requests made by this command  |         |          |                                                       |
| debug<br/>-d                | boolean | Activate debug mode (more logs)                                      |         |          |                                                       |
| json                        | boolean | format output as json                                                |         |          |                                                       |
| loglevel                    | option  | logging level for this command invocation                            |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| skipauth                    | boolean | Skip authentication check when a default username is required        |         |          |                                                       |
| targetdevhubusername<br/>-v | option  | username or alias for the dev hub org; overrides default dev hub org |         |          |                                                       |
| websocket                   | option  | Websocket host:port for VsCode SFDX Hardis UI integration            |         |          |                                                       |

## Examples

```shell
sf hardis:scratch:delete
```


