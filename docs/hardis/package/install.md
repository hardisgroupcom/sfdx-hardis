<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:package:install

## Description

Install a package in an org using its id (starting with **04t**)

Assisted menu to propose to update `installedPackages` property in `.sfdx-hardis.yml`


## Parameters

| Name                   |  Type   | Description                                                         | Default | Required |                        Options                        |
|:-----------------------|:-------:|:--------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion             | option  | override the api version used for api requests made by this command |         |          |                                                       |
| debug<br/>-d           | boolean | Activate debug mode (more logs)                                     |         |          |                                                       |
| installationkey<br/>-k | option  | installation key for key-protected package (default: null)          |         |          |                                                       |
| json                   | boolean | format output as json                                               |         |          |                                                       |
| loglevel               | option  | logging level for this command invocation                           |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| package<br/>-p         | option  | Package Version Id to install (04t...)                              |         |          |                                                       |
| skipauth               | boolean | Skip authentication check when a default username is required       |         |          |                                                       |
| targetusername<br/>-u  | option  | username or alias for the target org; overrides default target org  |         |          |                                                       |
| websocket              | option  | Websocket host:port for VsCode SFDX Hardis UI integration           |         |          |                                                       |

## Examples

```shell
sf hardis:package:install
```


