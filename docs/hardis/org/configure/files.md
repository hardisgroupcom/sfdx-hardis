<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:configure:files

## Description

Configure export of file attachments from a Salesforce org

See article below

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)


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
sfdx hardis:org:configure:files
```


