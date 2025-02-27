<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:user:freeze

## Description

Mass freeze users in org before a maintenance or go live

See user guide in the following article

<https://medium.com/@dimitrimonge/freeze-unfreeze-users-during-salesforce-deployment-8a1488bf8dd3>

[![How to freeze / unfreeze users during a Salesforce deployment](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-freeze.jpg)](https://medium.com/@dimitrimonge/freeze-unfreeze-users-during-salesforce-deployment-8a1488bf8dd3)

## Parameters

| Name                   |  Type   | Description                                                       | Default | Required | Options |
|:-----------------------|:-------:|:------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d           | boolean | Activate debug mode (more logs)                                   |         |          |         |
| excludeprofiles<br/>-e | option  | List of profiles that you want to NOT freeze, separated by commas |         |          |         |
| flags-dir              | option  | undefined                                                         |         |          |         |
| includeprofiles<br/>-p | option  | List of profiles that you want to freeze, separated by commas     |         |          |         |
| json                   | boolean | Format output as json.                                            |         |          |         |
| maxuserdisplay<br/>-m  | option  | Maximum users to display in logs                                  |   100   |          |         |
| name<br/>-n            | option  | Filter according to Name criteria                                 |         |          |         |
| skipauth               | boolean | Skip authentication check when a default username is required     |         |          |         |
| target-org<br/>-o      | option  | undefined                                                         |         |          |         |
| websocket              | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |         |          |         |

## Examples

```shell
sf hardis:org:user:freeze
```

```shell
sf hardis:org:user:freeze --target-org my-user@myorg.com
```

```shell
sf hardis:org:user:freeze --includeprofiles 'Standard'
```

```shell
sf hardis:org:user:freeze --excludeprofiles 'System Administrator,Some Other Profile'
```


