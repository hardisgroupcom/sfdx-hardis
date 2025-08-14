<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:audit:apiversion

## Description

This command identifies metadata with an apiVersion lower than the value specified in the --minimumapiversion parameter.

  It can also update the apiVersion to a specific value:
  - When --fix parameter is provided (updates to minimumapiversion)
  - When --newapiversion is specified (updates to that version)

  Example to handle [ApexClass / Trigger & ApexPage mandatory version upgrade](https://help.salesforce.com/s/articleView?id=sf.admin_locales_update_api.htm&type=5) :
   
   `sf hardis:project:audit:apiversion --metadatatype ApexClass,ApexTrigger,ApexPage --minimumapiversion 45 --newapiversion 50`
  

## Parameters

| Name                     |  Type   | Description                                                                                                          | Default | Required | Options |
|:-------------------------|:-------:|:---------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d             | boolean | Activate debug mode (more logs)                                                                                      |         |          |         |
| failiferror<br/>-f       | boolean | Fails (exit code 1) if an error is found                                                                             |         |          |         |
| fix                      | boolean | Automatically update API versions in files that are below the minimum version threshold to match the minimum version |         |          |         |
| flags-dir                | option  | undefined                                                                                                            |         |          |         |
| json                     | boolean | Format output as json.                                                                                               |         |          |         |
| metadatatype             | option  | Metadata Types to fix. Comma separated. Supported Metadata types: ApexClass, ApexTrigger, ApexPage                   |         |          |         |
| minimumapiversion<br/>-m | option  | Minimum allowed API version                                                                                          |   20    |          |         |
| newapiversion<br/>-n     | option  | Define an API version value to apply when updating files                                                             |         |          |         |
| skipauth                 | boolean | Skip authentication check when a default username is required                                                        |         |          |         |
| websocket                | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                            |         |          |         |

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

```shell
$ sf hardis:project:audit:apiversion --metadatatype ApexClass,ApexTrigger,ApexPage --minimumapiversion 45 --newapiversion 50
```


