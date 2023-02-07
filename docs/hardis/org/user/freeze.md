<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:user:freeze

## Description

Mass freeze users in org before a maintenance or go live

See user guide in the following article

<https://medium.com/@dimitrimonge/freeze-unfreeze-users-during-salesforce-deployment-8a1488bf8dd3>

[![How to freeze / unfreeze users during a Salesforce deployment](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-freeze.jpg)](https://medium.com/@dimitrimonge/freeze-unfreeze-users-during-salesforce-deployment-8a1488bf8dd3)

## Parameters

| Name                   |  Type   | Description                                                         | Default | Required |                        Options                        |
|:-----------------------|:-------:|:--------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion             | option  | override the api version used for api requests made by this command |         |          |                                                       |
| debug<br/>-d           | boolean | Activate debug mode (more logs)                                     |         |          |                                                       |
| excludeprofiles<br/>-e | option  | List of profiles that you want to NOT freeze, separated by commas   |         |          |                                                       |
| includeprofiles<br/>-p | option  | List of profiles that you want to freeze, separated by commas       |         |          |                                                       |
| json                   | boolean | format output as json                                               |         |          |                                                       |
| loglevel               | option  | logging level for this command invocation                           |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| maxuserdisplay<br/>-m  | option  | Maximum users to display in logs                                    |   100   |          |                                                       |
| name<br/>-n            | option  | Filter according to Name criteria                                   |         |          |                                                       |
| skipauth               | boolean | Skip authentication check when a default username is required       |         |          |                                                       |
| targetusername<br/>-u  | option  | username or alias for the target org; overrides default target org  |         |          |                                                       |
| websocket              | option  | Websocket host:port for VsCode SFDX Hardis UI integration           |         |          |                                                       |

## Examples

```shell
$ sfdx hardis:org:user:freeze
```

```shell
$ sfdx hardis:org:user:freeze --targetusername myuser@myorg.com
```

```shell
$ sfdx hardis:org:user:freeze --includeprofiles 'Standard'
```

```shell
$ sfdx hardis:org:user:freeze --excludeprofiles 'System Administrator,Some Other Profile'
```


