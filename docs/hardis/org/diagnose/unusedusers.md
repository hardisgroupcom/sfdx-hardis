<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:unusedusers

## Description

Efficient user management is vital in Salesforce to ensure resources are optimized and costs are controlled. However, inactive or unused user accounts can often go unnoticed, leading to wasted licenses and potential security risks. This tool addresses this challenge by enabling administrators to identify users who haven't logged in within a specified period.

By analyzing user login activity and last login timestamps, this feature highlights inactive user accounts, allowing administrators to take appropriate action. Whether it's deactivating dormant accounts, freeing up licenses, or ensuring compliance with security policies, this functionality empowers administrators to maintain a lean and secure Salesforce environment.

licensetypes values are the following:

- all-crm: SFDC,AUL,AUL1,AULL_IGHT

- all-paying: SFDC,AUL,AUL1,AULL_IGHT,PID_Customer_Community,PID_Customer_Community_Login,PID_Partner_Community,PID_Partner_Community_Login

Note: You can see the full list of available license identifiers in [Salesforce Documentation](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_userlicense.htm)

Use --returnactiveusers to revert the command and retrieve active users that has logged in during the period.


## Parameters

| Name                      |  Type   | Description                                                                                                                                                                                                                            | Default | Required |                        Options                        |
|:--------------------------|:-------:|:---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion                | option  | override the api version used for api requests made by this command                                                                                                                                                                    |         |          |                                                       |
| days<br/>-t               | option  | Extracts the users that have been inactive for the amount of days specified. In CI, default is 180 days                                                                                                                                |         |          |                                                       |
| debug<br/>-d              | boolean | Activate debug mode (more logs)                                                                                                                                                                                                        |         |          |                                                       |
| json                      | boolean | format output as json                                                                                                                                                                                                                  |         |          |                                                       |
| licenseidentifiers<br/>-i | option  | Comma-separated list of license identifiers, in case licensetypes is not used.. Identifiers available at <https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_userlicense.htm> |         |          |                                                       |
| licensetypes<br/>-l       | option  | Type of licenses to check. If set, do not use licenseidentifiers option. In CI, default is all-crm                                                                                                                                     |         |          |            all<br/>all-crm<br/>all-paying             |
| loglevel                  | option  | logging level for this command invocation                                                                                                                                                                                              |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| outputfile<br/>-o         | option  | Force the path and name of output report file. Must end with .csv                                                                                                                                                                      |         |          |                                                       |
| returnactiveusers         | boolean | Inverts the command by returning the active users                                                                                                                                                                                      |         |          |                                                       |
| skipauth                  | boolean | Skip authentication check when a default username is required                                                                                                                                                                          |         |          |                                                       |
| targetusername<br/>-u     | option  | username or alias for the target org; overrides default target org                                                                                                                                                                     |         |          |                                                       |
| websocket                 | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                                                              |         |          |                                                       |

## Examples

```shell
sf hardis:org:diagnose:unusedusers
```

```shell
sf hardis:org:diagnose:unusedusers --days 365
```

```shell
sf hardis:org:diagnose:unusedusers --days 60 --licensetypes all-crm
```

```shell
sf hardis:org:diagnose:unusedusers --days 60 --licenseidentifiers SFDC,AUL,AUL1
```

```shell
sf hardis:org:diagnose:unusedusers --days 60 --licensetypes all-crm --returnactiveusers
```


