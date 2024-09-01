<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:package:version:promote

## Description

Promote package(s) version(s): convert it from beta to released

## Parameters

| Name                  |  Type   | Description                                                      |               Default               | Required | Options |
|:----------------------|:-------:|:-----------------------------------------------------------------|:-----------------------------------:|:--------:|:-------:|
| auto<br/>-d           | boolean | Auto-detect which versions of which packages need to be promoted |                                     |          |         |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                  |                                     |          |         |
| flags-dir             | option  | undefined                                                        |                                     |          |         |
| json                  | boolean | Format output as json.                                           |                                     |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required    |                                     |          |         |
| target-dev-hub<br/>-v | option  | undefined                                                        | <nicolas.vuillamy@cloudity-jdc.com> |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration        |                                     |          |         |

## Examples

```shell
sf hardis:package:version:promote
```

```shell
sf hardis:package:version:promote --auto
```


