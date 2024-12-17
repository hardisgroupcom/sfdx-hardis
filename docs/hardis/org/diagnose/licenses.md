<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:licenses

## Description

Mostly used for monitoring (Grafana) but you can also use it manually :)

## Parameters

| Name              |  Type   | Description                                                       |           Default            | Required | Options |
|:------------------|:-------:|:------------------------------------------------------------------|:----------------------------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                   |                              |          |         |
| flags-dir         | option  | undefined                                                         |                              |          |         |
| json              | boolean | Format output as json.                                            |                              |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv |                              |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required     |                              |          |         |
| target-org<br/>-o | option  | undefined                                                         | hardis@cityone.fr.intfluxne2 |          |         |
| usedonly<br/>-u   | boolean | Filter to have only used licenses                                 |                              |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |                              |          |         |

## Examples

```shell
sf hardis:org:diagnose:licenses
```


