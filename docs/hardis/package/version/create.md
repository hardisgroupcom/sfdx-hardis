<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:package:version:create

## Description

Create a new version of an unlocked package

## Parameters

| Name                        |  Type   | Description                                                               | Default | Required |                        Options                        |
|:----------------------------|:-------:|:--------------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion                  | option  | override the api version used for api requests made by this command       |         |          |                                                       |
| debug<br/>-d                | boolean | Activate debug mode (more logs)                                           |         |          |                                                       |
| deleteafter                 | boolean | Delete package version after creating it                                  |         |          |                                                       |
| install<br/>-i              | boolean | Install package version on default org after generation                   |         |          |                                                       |
| installkey<br/>-k           | option  | Package installation key                                                  |         |          |                                                       |
| json                        | boolean | format output as json                                                     |         |          |                                                       |
| loglevel                    | option  | logging level for this command invocation                                 |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| package<br/>-p              | option  | Package identifier that you want to use to generate a new package version |         |          |                                                       |
| skipauth                    | boolean | Skip authentication check when a default username is required             |         |          |                                                       |
| targetdevhubusername<br/>-v | option  | username or alias for the dev hub org; overrides default dev hub org      |         |          |                                                       |
| websocket                   | option  | Websocket host:port for VsCode SFDX Hardis UI integration                 |         |          |                                                       |

## Examples

```shell
sf hardis:package:version:create
```


