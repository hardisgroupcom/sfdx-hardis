<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:audit:apiversion

## Description

This command detects metadatas whose apiVersion is lower than parameter --minimumapiversion

  It can also fix the apiVersions with the latest one, if parameter --fix is sent

  Example to handle [ApexClass / Trigger & ApexPage mandatory version upgrade](https://help.salesforce.com/s/articleView?id=sf.admin_locales_update_api.htm&type=5) :
   
   `sf hardis:project:audit:apiversion --metadatatype ApexClass,ApexTrigger,ApexPage --minimumapiversion 45.0 --fix`
  

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|failiferror<br/>-f|boolean|Fails (exit code 1) if an error is found||||
|fix|boolean|Fix ApiVersion on specified Metadata Types.||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|metadatatype|option|Metadata Types to fix. Comma separated. Supported Metadata types: ApexClass, ApexTrigger, ApexPage||||
|minimumapiversion<br/>-m|option|Minimum allowed API version|20|||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:audit:apiversion
```

```shell
$ sf hardis:project:audit:apiversion --metadatatype ApexClass,ApexTrigger,ApexPage --minimumapiversion 45
```

```shell
$ sf hardis:project:audit:apiversion --metadatatype ApexClass,ApexTrigger,ApexPage --minimumapiversion 45 --fix
```


