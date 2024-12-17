<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:data:import

## Description

Import/Load data in an org using a [SFDX Data Loader](https://help.sfdmu.com/) Project

If you need to run this command in a production org, you need to either:

- Define **sfdmuCanModify** in your .sfdx-hardis.yml config file. (Example: `sfdmuCanModify: prod-instance.my.salesforce.com`)
- Define an environment variable SFDMU_CAN_MODIFY. (Example: `SFDMU_CAN_MODIFY=prod-instance.my.salesforce.com`)

See article:

[![How to detect bad words in Salesforce records using SFDX Data Loader and sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-badwords.jpg)](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| path<br/>-p       | option  | Path to the sfdmu workspace folder                            |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
sf hardis:org:data:import
```


