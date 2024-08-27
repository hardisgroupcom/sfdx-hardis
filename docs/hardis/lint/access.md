<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:lint:access

## Description

Check if elements(apex class and field) are at least in one permission set

## Parameters

| Name                   |  Type   | Description                                                         |  Default  | Required |                        Options                        |
|:-----------------------|:-------:|:--------------------------------------------------------------------|:---------:|:--------:|:-----------------------------------------------------:|
| apiversion             | option  | override the api version used for api requests made by this command |           |          |                                                       |
| debug<br/>-d           | boolean | Activate debug mode (more logs)                                     |           |          |                                                       |
| elementsignored<br/>-e | option  | Ignore specific elements separated by commas                        |           |          |                                                       |
| folder<br/>-f          | option  | Root folder                                                         | force-app |          |                                                       |
| ignorerights<br/>-i    | option  | Ignore permission sets or profiles                                  |           |          |                                                       |
| json                   | boolean | format output as json                                               |           |          |                                                       |
| loglevel               | option  | logging level for this command invocation                           |   warn    |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| outputfile<br/>-o      | option  | Force the path and name of output report file. Must end with .csv   |           |          |                                                       |
| skipauth               | boolean | Skip authentication check when a default username is required       |           |          |                                                       |
| targetusername<br/>-u  | option  | username or alias for the target org; overrides default target org  |           |          |                                                       |
| websocket              | option  | Websocket host:port for VsCode SFDX Hardis UI integration           |           |          |                                                       |

## Examples

```shell
sf hardis:lint:access
```

```shell
sf hardis:lint:access -e "ApexClass:ClassA, CustomField:Account.CustomField"
```

```shell
sf hardis:lint:access -i "PermissionSet:permissionSetA, Profile"
```


