<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:new

## Description

Assisted menu to start working on a Salesforce task.

Advanced instructions in [Create New Task documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-create-new-task/)

At the end of the command, it will allow you to work on either a scratch org or a sandbox, depending on your choices.

Under the hood, it can:

- Make **git pull** to be up to date with target branch
- Create **new git branch** with formatted name (you can override the choices using .sfdx-hardis.yml property **branchPrefixChoices**)
- Create and initialize a scratch org or a source-tracked sandbox (config can be defined using `config/.sfdx-hardis.yml`):
- (and for scratch org only for now):
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
sfdx hardis:work:task:new
```


