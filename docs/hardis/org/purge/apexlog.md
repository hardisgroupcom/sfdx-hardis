<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:purge:apexlog

## Description

Purge apex logs in selected org

## Parameters

| Name              |  Type   | Description                                                        | Default | Required | Options |
|:------------------|:-------:|:-------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                    |         |          |         |
| flags-dir         | option  | undefined                                                          |         |          |         |
| json              | boolean | Format output as json.                                             |         |          |         |
| prompt<br/>-z     | boolean | Prompt for confirmation (true by default, use --no-prompt to skip) |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required      |         |          |         |
| target-org<br/>-o | option  | undefined                                                          |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration          |         |          |         |

## Examples

```shell
sf hardis:org:purge:apexlog
```

```shell
sf hardis:org:purge:apexlog --target-org nicolas.vuillamy@gmail.com
```


