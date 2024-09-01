<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:references

## Description

Remove unwanted references within sfdx project sources

## Parameters

| Name          |  Type   | Description                                                   | Default | Required |                                                             Options                                                             |
|:--------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------------------------------------------------------------------------------------------------------------------------------:|
| config<br/>-c | option  | Path to a JSON config file or a destructiveChanges.xml file   |         |          |                                                                                                                                 |
| debug<br/>-d  | boolean | Activate debug mode (more logs)                               |         |          |                                                                                                                                 |
| flags-dir     | option  | undefined                                                     |         |          |                                                                                                                                 |
| json          | boolean | Format output as json.                                        |         |          |                                                                                                                                 |
| skipauth      | boolean | Skip authentication check when a default username is required |         |          |                                                                                                                                 |
| type<br/>-t   | option  | Cleaning type                                                 |         |          | all<br/>caseentitlement<br/>dashboards<br/>datadotcom<br/>destructivechanges<br/>localfields<br/>productrequest<br/>entitlement |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |                                                                                                                                 |

## Examples

```shell
sf hardis:project:clean:references
```

```shell
sf hardis:project:clean:references --type all
```

```shell
sf hardis:project:clean:references --config ./cleaning/myconfig.json
```

```shell
sf hardis:project:clean:references --config ./somefolder/myDestructivePackage.xml
```


