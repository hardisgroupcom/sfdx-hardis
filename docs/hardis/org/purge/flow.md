<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:purge:flow

## Description

Purge Obsolete flow versions to avoid the 50 max versions limit. Filters on Status and Name

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|allowpurgefailure<br/>-f|boolean|Allows purges to fail without exiting with 1. Use --no-allowpurgefailure to disable||||
|apiversion|option|override the api version used for api requests made by this command||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|instanceurl<br/>-r|option|URL of org instance|https://login.salesforce.com|||
|json|boolean|format output as json||||
|loglevel|option|logging level for this command invocation|warn||trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal|
|name<br/>-n|option|Filter according to Name criteria||||
|prompt<br/>-z|boolean|Prompt for confirmation (true by default, use --no-prompt to skip)||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|status<br/>-s|option|Filter according to Status criteria||||
|targetusername<br/>-u|option|username or alias for the target org; overrides default target org||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sfdx hardis:org:purge:flow --no-prompt
```

```shell
$ sfdx hardis:org:purge:flow --targetusername nicolas.vuillamy@gmail.com
  Found 1 records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  Are you sure you want to delete this list of records (y/n)?: y
  Successfully deleted record: 30109000000kX7uAAE.
  Deleted the following list of records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  
```

```shell
$ sfdx hardis:org:purge:flow --targetusername nicolas.vuillamy@gmail.com --status "Obsolete,Draft,InvalidDraft --name TestFlow"
  Found 4 records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  30109000000kX8EAAU TestFlow    6             test flowwww InvalidDraft
  30109000000kX8AAAU TestFlow    5             test flowwww InvalidDraft
  30109000000kX89AAE TestFlow    4             test flowwww Draft
  Are you sure you want to delete this list of records (y/n)?: n
  No record deleted
  
```


