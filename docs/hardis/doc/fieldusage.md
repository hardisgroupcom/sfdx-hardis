<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:fieldusage

## Description


    Retrieves custom field usage from metadata dependencies for specified sObjects.
    !["Find custom fields usage"](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/doc-fieldusage.png)
  

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|sObjects<br/>-s|option|Comma-separated list of sObjects to filter||||
|target-org<br/>-o|option|undefined||||

## Examples

```shell
$ sf hardis:doc:fieldusage
```

```shell
$ sf hardis:doc:fieldusage --sObjects Account,Contact,Opportunity
```

```shell
$ sf hardis:doc:fieldusage --target-org myOrgAlias --sObjects CustomObject__c
```


