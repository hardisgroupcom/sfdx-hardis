<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:files:export

## Description

Export file attachments from a Salesforce org

See article below

[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|chunksize<br/>-c|option|Number of records to add in a chunk before it is processed|1000|||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|path<br/>-p|option|Path to the file export project||||
|polltimeout<br/>-t|option|Timeout in MS for Bulk API calls|300000|||
|skipauth|boolean|Skip authentication check when a default username is required||||
|startchunknumber<br/>-s|option|Chunk number to start from||||
|target-org<br/>-o|option|undefined|hardis@cityone.fr.intfluxne2|||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:org:files:export
```


