<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:generate:packagexmlfull

## Description

Generates full org package.xml, including managed items

## Parameters

| Name                  |  Type   | Description                                                         | Default | Required |                        Options                        |
|:----------------------|:-------:|:--------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion            | option  | override the api version used for api requests made by this command |         |          |                                                       |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                     |         |          |                                                       |
| json                  | boolean | format output as json                                               |         |          |                                                       |
| loglevel              | option  | logging level for this command invocation                           |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| outputfile            | option  | Output package.xml file                                             |         |          |                                                       |
| skipauth              | boolean | Skip authentication check when a default username is required       |         |          |                                                       |
| targetusername<br/>-u | option  | username or alias for the target org; overrides default target org  |         |          |                                                       |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration           |         |          |                                                       |

## Examples

```shell
sfdx hardis:org:generate:packagexmlfull
```

```shell
sfdx hardis:org:generate:packagexmlfull --outputfile /tmp/packagexmlfull.xml
```

```shell
sfdx hardis:org:generate:packagexmlfull --targetusername nico@example.com
```


