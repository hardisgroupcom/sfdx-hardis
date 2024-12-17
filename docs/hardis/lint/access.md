<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:lint:access

## Description

Check if elements(apex class and field) are at least in one permission set
  
This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-missing-access/) and can output Grafana, Slack and MsTeams Notifications.


## Parameters

| Name                   |  Type   | Description                                                       |           Default            | Required | Options |
|:-----------------------|:-------:|:------------------------------------------------------------------|:----------------------------:|:--------:|:-------:|
| debug<br/>-d           | boolean | Activate debug mode (more logs)                                   |                              |          |         |
| elementsignored<br/>-e | option  | Ignore specific elements separated by commas                      |                              |          |         |
| flags-dir              | option  | undefined                                                         |                              |          |         |
| folder<br/>-f          | option  | Root folder                                                       |          force-app           |          |         |
| ignorerights<br/>-i    | option  | Ignore permission sets or profiles                                |                              |          |         |
| json                   | boolean | Format output as json.                                            |                              |          |         |
| outputfile<br/>-x      | option  | Force the path and name of output report file. Must end with .csv |                              |          |         |
| skipauth               | boolean | Skip authentication check when a default username is required     |                              |          |         |
| target-org<br/>-o      | option  | undefined                                                         | hardis@cityone.fr.intfluxne2 |          |         |
| websocket              | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |                              |          |         |

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


