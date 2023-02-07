<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:configure:data

## Description

Configure Data Export/Import with a [SFDX Data Loader](https://help.sfdmu.com/) Project

See article:

[![How to detect bad words in Salesforce records using SFDX Data Loader and sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-badwords.jpg)](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)


## Parameters

| Name         |  Type   | Description                                                   | Default | Required |                        Options                        |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |                                                       |
| json         | boolean | format output as json                                         |         |          |                                                       |
| loglevel     | option  | logging level for this command invocation                     |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |                                                       |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |                                                       |

## Examples

```shell
sfdx hardis:org:configure:data
```


