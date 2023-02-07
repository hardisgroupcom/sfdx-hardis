<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:create

## Description

Create and initialize a scratch org or a source-tracked sandbox (config can be defined using `config/.sfdx-hardis.yml`):

- **Install packages**
  - Use property `installedPackages`
- **Push sources**
- **Assign permission sets**
  - Use property `initPermissionSets`
- **Run apex initialization scripts**
  - Use property `scratchOrgInitApexScripts`
- **Load data**
  - Use property `dataPackages`
  

## Parameters

| Name                        |  Type   | Description                                                             | Default | Required |                        Options                        |
|:----------------------------|:-------:|:------------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion                  | option  | override the api version used for api requests made by this command     |         |          |                                                       |
| debug<br/>-d                | boolean | Activate debug mode (more logs)                                         |         |          |                                                       |
| forcenew<br/>-n             | boolean | If an existing scratch org exists, do not reuse it but create a new one |         |          |                                                       |
| json                        | boolean | format output as json                                                   |         |          |                                                       |
| loglevel                    | option  | logging level for this command invocation                               |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| pool<br/>-d                 | boolean | Creates the scratch org for a scratch org pool                          |         |          |                                                       |
| skipauth                    | boolean | Skip authentication check when a default username is required           |         |          |                                                       |
| targetdevhubusername<br/>-v | option  | username or alias for the dev hub org; overrides default dev hub org    |         |          |                                                       |
| websocket                   | option  | Websocket host:port for VsCode SFDX Hardis UI integration               |         |          |                                                       |

## Examples

```shell
sfdx hardis:scratch:create
```


