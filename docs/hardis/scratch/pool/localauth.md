<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:pool:localauth

## Description

Calls the related storage service to request api keys and secrets that allows a local user to fetch a scratch org from scratch org pool

## Parameters

| Name                  |  Type   | Description                                                   | Default | Required | Options |
|:----------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d          | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir             | option  | undefined                                                     |         |          |         |
| json                  | boolean | Format output as json.                                        |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required |         |          |         |
| target-dev-hub<br/>-v | option  | undefined                                                     |         |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
sf hardis:scratch:pool:localauth
```


