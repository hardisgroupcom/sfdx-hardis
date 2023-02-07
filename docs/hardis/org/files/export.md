<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:files:export

## Description

Export file attachments from a Salesforce org

See article below

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)


## Parameters

| Name                    |  Type   | Description                                                         | Default | Required |                        Options                        |
|:------------------------|:-------:|:--------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion              | option  | override the api version used for api requests made by this command |         |          |                                                       |
| chunksize<br/>-c        | option  | Number of records to add in a chunk before it is processed          |  1000   |          |                                                       |
| debug<br/>-d            | boolean | Activate debug mode (more logs)                                     |         |          |                                                       |
| json                    | boolean | format output as json                                               |         |          |                                                       |
| loglevel                | option  | logging level for this command invocation                           |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| path<br/>-p             | option  | Path to the file export project                                     |         |          |                                                       |
| polltimeout<br/>-t      | option  | Timeout in MS for Bulk API calls                                    | 300000  |          |                                                       |
| skipauth                | boolean | Skip authentication check when a default username is required       |         |          |                                                       |
| startchunknumber<br/>-s | option  | Chunk number to start from                                          |         |          |                                                       |
| targetusername<br/>-u   | option  | username or alias for the target org; overrides default target org  |         |          |                                                       |
| websocket               | option  | Websocket host:port for VsCode SFDX Hardis UI integration           |         |          |                                                       |

## Examples

```shell
sfdx hardis:org:files:export
```


